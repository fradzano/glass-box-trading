// The supervised dev live-test driver (P7, S-ARM-01). It runs the exact
// P1–P6 artifact against the disposable dev paper account in market hours and
// collects broker-backed evidence for each certificate clause: entry cycles
// until a credit vertical is accepted and a defined-risk entry fills and
// reconciles; a flatten pass through the S-G11 deadline regime until the book
// is flat; the S-G12-06 credential-fence drill (a 401 read port, the
// journaled AUTH_FAILURE halt, the working-order check, the manual un-halt);
// a final fully paginated snapshot. The pure core turns the journal and these
// observations into the certificate; this driver sequences and records, and
// any exceptional exit runs the same gateway-bound flatten regime before it
// returns the failure.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildCertificate } from "../core/certificate.js";
import type { FenceObservation, OrderObservation, PreArmCertificate } from "../core/certificate.js";
import { epochMsToUtcIso, isWorkingBrokerStatus, unresolvedEntryLifecycleIds } from "../core/execution.js";
import type { JournalEntry } from "../core/journal.js";
import type { AgentRuntime } from "./agent-runtime.js";
import { createAlpacaBroker } from "./alpaca-broker.js";
import { httpStatusOf } from "./broker-errors.js";
import type { CycleReport } from "./cycle-runner.js";
import { manualUnhalt } from "./manual-unhalt.js";
import { CANONICAL_PAPER_TRADING_ORIGIN } from "./startup.js";
import { MARKET_DATA_ORIGIN } from "./agent-runtime.js";

export interface CertificateRunOptions {
  readonly runtime: AgentRuntime;
  readonly repoRoot: string;
  readonly clock: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly log: (line: string) => void;
  /** Entry phase: cycles until a fill, spaced by `entryIntervalMs`; a resting credit is harness-canceled after `patienceCycles` cycles. */
  readonly maxEntryCycles: number;
  readonly entryIntervalMs: number;
  readonly patienceCycles: number;
  /** Flatten phase: ladder cycles spaced by `flattenIntervalMs`. */
  readonly maxFlattenCycles: number;
  readonly flattenIntervalMs: number;
  /** Human checkpoint after halted reconciliation. Returning null leaves the AUTH_FAILURE halt in place and aborts. */
  readonly approveFenceUnhalt: (facts: { readonly haltSeq: number; readonly httpStatus: number; readonly workingOrders: readonly string[]; readonly canceledOrders: readonly string[] }, signal: AbortSignal) => Promise<{ readonly operator: string; readonly reason: string } | null>;
}

export interface CertificateRunResult {
  readonly certificate: PreArmCertificate;
  readonly file: string;
  readonly cycles: readonly CycleReport[];
}

function entryIntentIds(entries: readonly JournalEntry[]): readonly string[] {
  return entries.filter(entry => entry.type === "INTENT" && (entry["action"] === "entry" || entry["action"] === undefined) && typeof entry["clientOrderId"] === "string").map(entry => entry["clientOrderId"] as string);
}

/** An entry lifecycle without a terminal OUTCOME: while one rests, the supervised run proposes nothing new (one structure at a time). */
function unresolvedEntryExists(entries: readonly JournalEntry[]): boolean {
  const terminal = new Set(entries.filter(entry => entry.type === "OUTCOME" && typeof entry["clientOrderId"] === "string" && ["filled", "rejected", "canceled", "expired"].includes(String(entry["status"]))).map(entry => entry["clientOrderId"] as string));
  return entryIntentIds(entries).some(id => !terminal.has(id));
}

function filledEntryExists(entries: readonly JournalEntry[]): boolean {
  const intents = new Set(entryIntentIds(entries));
  return entries.some(entry => entry.type === "OUTCOME" && entry["status"] === "filled" && typeof entry["clientOrderId"] === "string" && intents.has(entry["clientOrderId"]));
}

/** Cycle indices are global journal identity, not process-local attempt slots. */
export function nextCertificateCycleIndex(entries: readonly JournalEntry[]): number {
  const indices = entries.map(entry => entry["cycleIndex"]).filter((value): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
  return (indices.length === 0 ? 0 : Math.max(...indices)) + 1;
}

/**
 * Recovery may release an entry reservation only on broker-authoritative
 * terminal evidence. A `NOT_AT_BROKER` observation is not terminal after a
 * lost acknowledgement: the original request can still appear remotely.
 */
export function unresolvedRecoveryEntryIds(entries: readonly JournalEntry[]): readonly string[] {
  return unresolvedEntryLifecycleIds(entries);
}

function latestHaltSeq(entries: readonly JournalEntry[]): number | null {
  const halt = [...entries].reverse().find(entry => entry.type === "HALT");
  if (halt === undefined) return null;
  return entries.some(entry => entry.seq > halt.seq && entry["actor"] === "human") ? null : halt.seq;
}

function terminalHaltTransitionSeq(entries: readonly JournalEntry[]): number | null {
  return [...entries].reverse().find(entry => entry.type === "HALT" || entry["actor"] === "human")?.seq ?? null;
}

function terminalJournalSeq(entries: readonly JournalEntry[]): number {
  return entries.at(-1)?.seq ?? 0;
}

async function runCertificateAttempt(options: CertificateRunOptions): Promise<CertificateRunResult> {
  const { runtime, clock, log } = options;
  const startedAt = epochMsToUtcIso(clock());
  const observations: OrderObservation[] = [];
  const harnessCancels: string[] = [];
  const cycles: CycleReport[] = [];
  let cycleIndex = nextCertificateCycleIndex((await runtime.gateway.openJournal()).entries) - 1;

  const inCurrentWindow = (entries: readonly JournalEntry[]): readonly JournalEntry[] => entries.filter(entry => entry.at >= startedAt);

  function operationDeadlineMs(): number {
    const budget = Math.min(runtime.config.scheduling.cycleWalltimeBudgetMs, runtime.config.scheduling.lockTakeoverBoundMs - 1);
    if (!Number.isSafeInteger(budget) || budget < 1) throw new Error("certificate operation deadline is not below the writer takeover bound");
    return clock() + budget;
  }

  async function awaitHumanApproval<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (!await runtime.gateway.heartbeat()) throw new Error("certificate lost writer authority before human checkpoint");
    const controller = new AbortController();
    const pending = operation(controller.signal).then(
      value => ({ kind: "done" as const, value }),
      (error: unknown) => ({ kind: "error" as const, error }),
    );
    const interval = Math.min(60_000, Math.max(1, Math.floor(runtime.config.scheduling.lockTakeoverBoundMs / 3)));
    for (;;) {
      const outcome = await Promise.race([pending, options.sleep(interval).then(() => ({ kind: "tick" as const }))]);
      if (outcome.kind === "done") {
        if (!await runtime.gateway.heartbeat()) throw new Error("certificate lost writer authority as the human checkpoint completed");
        return outcome.value;
      }
      if (outcome.kind === "error") throw outcome.error;
      if (!await runtime.gateway.heartbeat()) {
        controller.abort();
        throw new Error("certificate lost writer authority during human checkpoint");
      }
    }
  }

  async function keepAliveSleep(ms: number): Promise<void> {
    let remaining = ms;
    const interval = Math.min(60_000, Math.max(1, Math.floor(runtime.config.scheduling.lockTakeoverBoundMs / 3)));
    while (remaining > 0) {
      const slice = Math.min(remaining, interval);
      await options.sleep(slice);
      remaining -= slice;
      if (!await runtime.gateway.heartbeat()) throw new Error("certificate lost writer authority while waiting");
    }
  }

  async function runLiveCycle(overrides: Parameters<AgentRuntime["cycle"]>[1] = {}): Promise<CycleReport> {
    if (!await runtime.gateway.heartbeat()) throw new Error("certificate lost writer authority before cycle");
    const report = await runtime.cycle(cycleIndex, overrides);
    if (!await runtime.gateway.heartbeat()) throw new Error("certificate lost writer authority after cycle");
    return report;
  }

  async function observeOrders(): Promise<void> {
    const entries = inCurrentWindow((await runtime.gateway.openJournal()).entries);
    const deadlineAtMs = operationDeadlineMs();
    for (const clientOrderId of new Set(entryIntentIds(entries))) {
      try {
        const order = await runtime.broker.read.orderByClientId(clientOrderId, deadlineAtMs);
        if (order !== null) observations.push({ observedAt: epochMsToUtcIso(clock()), order });
      } catch (error) {
        log(`observation of ${clientOrderId} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // ---- phase A: entries until one defined-risk entry fills and reconciles ----
  const restingSince = new Map<string, number>();
  for (let attempt = 0; attempt < options.maxEntryCycles; attempt += 1) {
    cycleIndex += 1;
    const holdProposals = unresolvedEntryExists(inCurrentWindow((await runtime.gateway.openJournal()).entries));
    if (holdProposals) log("an entry lifecycle is unresolved; the analyst is handed an empty batch this cycle");
    const report = await runLiveCycle(holdProposals ? { analyst: () => Promise.resolve("{\"candidates\":[]}") } : {});
    cycles.push(report);
    log(`cycle ${String(cycleIndex)}: primary=${String(report.primary)} actions=${report.actions.map(action => `${action.clientOrderId}:${action.result}:${String(action.status)}`).join(" ")} vetoes=${report.lifecycleVetoes.map(v => v.code).join(",")} skip=${String(report.analystSkip)} blocked=${report.entriesBlocked.join(",")}`);
    await observeOrders();
    const entries = inCurrentWindow((await runtime.gateway.openJournal()).entries);
    if (filledEntryExists(entries)) {
      log("a defined-risk entry filled; one more cycle reconciles it through the snapshot");
      cycleIndex += 1;
      cycles.push(await runLiveCycle({ analyst: () => Promise.resolve("{\"candidates\":[]}") }));
      await observeOrders();
      break;
    }
    // A credit that rests too long is harness-canceled (recorded), so the certificate can still show acceptance + terminal state.
    for (const observation of observations) {
      const id = observation.order.clientOrderId;
      if (!isWorkingBrokerStatus(observation.order.status)) {
        restingSince.delete(id);
        continue;
      }
      restingSince.set(id, restingSince.get(id) ?? cycleIndex);
    }
    for (const [id, since] of restingSince) {
      if (cycleIndex - since >= options.patienceCycles && !harnessCancels.includes(id)) {
        log(`harness cancel of resting entry ${id}`);
        const deadlineAtMs = operationDeadlineMs();
        const dispatched = await runtime.gateway.dispatch({ class: "authoritative", epoch: runtime.epoch, deadlineAtMs, action: { kind: "broker_mutation", mutation: { kind: "cancel_order", clientOrderId: id, binding: runtime.binding, notAfterMs: deadlineAtMs } } });
        if (dispatched.ok) harnessCancels.push(id);
      }
    }
    await keepAliveSleep(options.entryIntervalMs);
  }

  // ---- phase B: flatten through the S-G11 deadline regime (FLATTEN_DATE = today for this supervised run) ----
  for (let attempt = 0; attempt < options.maxFlattenCycles; attempt += 1) {
    const deadlineAtMs = operationDeadlineMs();
    const [positions, openOrders] = await Promise.all([runtime.broker.read.positions(deadlineAtMs), runtime.broker.read.openOrders(deadlineAtMs)]);
    if (positions.every(position => position.quantity === 0) && openOrders.every(order => !isWorkingBrokerStatus(order.status))) break;
    cycleIndex += 1;
    const report = await runLiveCycle({ flattenDate: runtime.tradingDay, finalCycleOfSession: false, analyst: () => Promise.resolve("{\"candidates\":[]}") });
    cycles.push(report);
    log(`flatten cycle ${String(cycleIndex)}: closes=${report.managementCloses.map(close => `${close.attemptId}@${String(close.limitPriceCents)}${close.atCap ? "(cap)" : ""}`).join(" ")} alarms=${report.alarmConditions.join(",")}`);
    await observeOrders();
    await keepAliveSleep(options.flattenIntervalMs);
  }

  const beforeFenceBarrier = await runtime.gateway.openJournalAsWriter(runtime.epoch);
  if (beforeFenceBarrier === null) throw new Error("refusing fence drill: writer authority was lost before the stable-flat proof");
  const unresolvedBeforeFence = unresolvedEntryLifecycleIds(beforeFenceBarrier.entries);
  if (unresolvedBeforeFence.length > 0) throw new Error(`refusing fence drill: unresolved entry lifecycle(s): ${unresolvedBeforeFence.join(",")}`);
  const beforeFenceBarrierSeq = terminalJournalSeq(beforeFenceBarrier.entries);
  const beforeFenceSnapshot = await runtime.broker.fullSnapshot(operationDeadlineMs());
  if (!beforeFenceSnapshot.pagesComplete || beforeFenceSnapshot.consistentReads < 2 || beforeFenceSnapshot.account.accountId !== runtime.binding.accountId
    || beforeFenceSnapshot.positions.some(position => position.quantity !== 0) || beforeFenceSnapshot.nonTerminalOrders.length > 0) {
    throw new Error("refusing fence drill: account is not stably flat after the flatten phase");
  }
  const beforeFenceJournal = await runtime.gateway.openJournalAsWriter(runtime.epoch);
  if (beforeFenceJournal === null) throw new Error("refusing fence drill: writer authority was lost after the stable-flat proof");
  const unresolvedAfterFlat = unresolvedEntryLifecycleIds(beforeFenceJournal.entries);
  if (unresolvedAfterFlat.length > 0) throw new Error(`refusing fence drill: entry lifecycle changed during the stable-flat proof: ${unresolvedAfterFlat.join(",")}`);
  if (terminalJournalSeq(beforeFenceJournal.entries) !== beforeFenceBarrierSeq) throw new Error("refusing fence drill: journal truth changed during the stable-flat proof");
  if (beforeFenceJournal.halt.halted) throw new Error(`refusing fence drill: a pre-existing halt is active (${String(beforeFenceJournal.halt.reason)})`);
  const beforeFenceSeq = beforeFenceJournal.entries.at(-1)?.seq ?? 0;

  // ---- phase C: the credential-fence drill (S-G12-06) ----
  const badBroker = createAlpacaBroker({ credentials: { keyId: runtime.env["ALPACA_DEV_KEY_ID"] ?? "", secretKey: "INVALID-SECRET-FOR-FENCE-DRILL" }, tradingOrigin: runtime.config.binding.canonicalTradingOrigin, dataOrigin: MARKET_DATA_ORIGIN, clock, requestTimeoutMs: Math.min(runtime.config.scheduling.cycleWalltimeBudgetMs, 30_000) });
  let fenceStatus = 0;
  try {
    await badBroker.read.account(operationDeadlineMs());
  } catch (error) {
    fenceStatus = httpStatusOf(error) ?? 0;
  }
  cycleIndex += 1;
  const fenceCycle = await runLiveCycle({ broker: badBroker.read, analyst: () => Promise.resolve("{\"candidates\":[]}") });
  cycles.push(fenceCycle);
  log(`fence cycle ${String(cycleIndex)}: http=${String(fenceStatus)} reasons=${fenceCycle.reasonCodes.join(",")} blocked=${fenceCycle.entriesBlocked.join(",")}`);
  // The runbook fact: a key rotation does not cancel working orders — the fence procedure ends with a working-order check/cancel.
  const fenceOrderDeadlineMs = operationDeadlineMs();
  const working = (await runtime.broker.read.openOrders(fenceOrderDeadlineMs)).filter(order => isWorkingBrokerStatus(order.status)).map(order => order.clientOrderId);
  const canceledAtFence: string[] = [];
  for (const id of working) {
    const dispatched = await runtime.gateway.dispatch({ class: "authoritative", epoch: runtime.epoch, deadlineAtMs: fenceOrderDeadlineMs, action: { kind: "broker_mutation", mutation: { kind: "cancel_order", clientOrderId: id, binding: runtime.binding, notAfterMs: fenceOrderDeadlineMs } } });
    if (!dispatched.ok) throw new Error(`fence cancel of ${id} failed: ${dispatched.reason}`);
    let confirmed = false;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const observed = await runtime.broker.read.orderByClientId(id, fenceOrderDeadlineMs);
      if (observed?.status === "canceled") {
        confirmed = true;
        break;
      }
      if (observed !== null && !isWorkingBrokerStatus(observed.status)) throw new Error(`fence cancel of ${id} ended as ${observed.status}, not canceled`);
      await keepAliveSleep(500);
    }
    if (!confirmed) throw new Error(`fence cancel of ${id} was not terminally confirmed`);
    canceledAtFence.push(id);
  }
  if (fenceStatus !== 401 && fenceStatus !== 403) throw new Error(`fence drill did not observe 401/403 (got ${String(fenceStatus)})`);
  const haltedBeforeReconciliation = await runtime.gateway.openJournalAsWriter(runtime.epoch);
  const authHalt = [...(haltedBeforeReconciliation?.entries ?? [])].reverse().find(entry => entry.seq > beforeFenceSeq && entry.type === "HALT" && entry["reason"] === "AUTH_FAILURE");
  if (haltedBeforeReconciliation === null || authHalt === undefined || !haltedBeforeReconciliation.halt.halted || haltedBeforeReconciliation.halt.reason !== "AUTH_FAILURE") throw new Error("fence drill did not create its own active AUTH_FAILURE halt under writer authority");
  const reconciliationJournalSeq = terminalJournalSeq(haltedBeforeReconciliation.entries);
  const reconciledWhileHalted = await runtime.broker.fullSnapshot(operationDeadlineMs());
  if (!reconciledWhileHalted.pagesComplete || reconciledWhileHalted.consistentReads < 2 || reconciledWhileHalted.account.accountId !== runtime.binding.accountId
    || reconciledWhileHalted.positions.some(position => position.quantity !== 0) || reconciledWhileHalted.nonTerminalOrders.length > 0) {
    throw new Error("fence reconciliation is not stably flat; AUTH_FAILURE halt remains active");
  }
  const haltedAfterReconciliation = await runtime.gateway.openJournalAsWriter(runtime.epoch);
  if (haltedAfterReconciliation === null || !haltedAfterReconciliation.halt.halted || haltedAfterReconciliation.halt.reason !== "AUTH_FAILURE"
    || terminalHaltTransitionSeq(haltedAfterReconciliation.entries) !== authHalt.seq || terminalJournalSeq(haltedAfterReconciliation.entries) !== reconciliationJournalSeq) {
    throw new Error("fence journal or writer authority changed during stable-flat reconciliation");
  }
  const approval = await awaitHumanApproval(signal => options.approveFenceUnhalt({ haltSeq: authHalt.seq, httpStatus: fenceStatus, workingOrders: working, canceledOrders: canceledAtFence }, signal));
  if (approval === null) throw new Error("human fence un-halt approval was not provided; AUTH_FAILURE halt remains active");
  const approvedJournalBeforeSnapshot = await runtime.gateway.openJournalAsWriter(runtime.epoch);
  if (approvedJournalBeforeSnapshot === null || !approvedJournalBeforeSnapshot.halt.halted || approvedJournalBeforeSnapshot.halt.reason !== "AUTH_FAILURE"
    || terminalHaltTransitionSeq(approvedJournalBeforeSnapshot.entries) !== authHalt.seq || terminalJournalSeq(approvedJournalBeforeSnapshot.entries) !== reconciliationJournalSeq) {
    throw new Error("fence journal or writer authority changed before manual un-halt");
  }
  const approvedSnapshot = await runtime.broker.fullSnapshot(operationDeadlineMs());
  if (!approvedSnapshot.pagesComplete || approvedSnapshot.consistentReads < 2 || approvedSnapshot.account.accountId !== runtime.binding.accountId
    || approvedSnapshot.positions.some(position => position.quantity !== 0) || approvedSnapshot.nonTerminalOrders.length > 0) {
    throw new Error("fence reconciliation is no longer stably flat after human approval; AUTH_FAILURE halt remains active");
  }
  const approvedJournal = await runtime.gateway.openJournalAsWriter(runtime.epoch);
  if (approvedJournal === null || !approvedJournal.halt.halted || approvedJournal.halt.reason !== "AUTH_FAILURE"
    || terminalHaltTransitionSeq(approvedJournal.entries) !== authHalt.seq || terminalJournalSeq(approvedJournal.entries) !== reconciliationJournalSeq) {
    throw new Error("fence journal or writer authority changed during the post-approval stable-flat proof");
  }
  const unhalt = await manualUnhalt({ paths: runtime.paths, operator: approval.operator, reason: approval.reason, clock, secrets: runtime.secrets, instanceId: "certificate-unhalt", lockTakeoverBoundMs: runtime.config.scheduling.lockTakeoverBoundMs, expectedHaltSeq: authHalt.seq, expectedHaltReason: "AUTH_FAILURE", expectedEpoch: runtime.epoch, expectedHolderId: runtime.instanceId, expectedJournalSeq: reconciliationJournalSeq });
  log(`manual un-halt: ${unhalt.ok ? "ok" : unhalt.reason}`);
  if (!unhalt.ok) throw new Error(`manual fence un-halt refused: ${unhalt.reason}`);
  if (!("seq" in unhalt)) throw new Error("manual fence un-halt returned no journal sequence");
  const unhaltSeq = unhalt.seq;
  const fence: FenceObservation = { httpStatus: fenceStatus, haltSeq: authHalt.seq, unhaltSeq, workingOrdersAtFence: working, canceledAtFence };

  // ---- phase D: the final fully paginated snapshot and the certificate ----
  const beforeFinal = await runtime.gateway.openJournalAsWriter(runtime.epoch);
  if (beforeFinal === null || beforeFinal.halt.halted || terminalHaltTransitionSeq(beforeFinal.entries) !== unhaltSeq || unresolvedEntryLifecycleIds(beforeFinal.entries).length > 0) {
    throw new Error("refusing final snapshot: writer authority, exact fence un-halt transition, or entry-lifecycle terminality changed");
  }
  const beforeFinalSeq = terminalJournalSeq(beforeFinal.entries);
  const snapshot = await runtime.broker.fullSnapshot(operationDeadlineMs());
  // End the historical claim before the final atomic writer read. That read
  // catches every halt through endedAt; a later transition is outside the
  // certificate window instead of being silently included without evidence.
  const endedAt = epochMsToUtcIso(clock());
  const afterFinal = await runtime.gateway.openJournalAsWriter(runtime.epoch);
  if (afterFinal === null || afterFinal.halt.halted || terminalHaltTransitionSeq(afterFinal.entries) !== unhaltSeq || unresolvedEntryLifecycleIds(afterFinal.entries).length > 0 || terminalJournalSeq(afterFinal.entries) !== beforeFinalSeq) {
    throw new Error("refusing certificate: writer authority, halt transition, journal truth, or entry-lifecycle terminality changed during the final snapshot");
  }
  const journal = afterFinal.entries;
  const certificate = buildCertificate({
    accountId: runtime.binding.accountId,
    tradingOrigin: runtime.binding.tradingOrigin,
    canonicalTradingOrigin: CANONICAL_PAPER_TRADING_ORIGIN,
    window: { startedAt, endedAt },
    runtimeDigest: runtime.runtimeDigest,
    policyDigest: runtime.policyDigest,
    mcpInventoryAccepted: runtime.mcpInventory.length > 0,
    journal,
    orderObservations: observations,
    harnessCancels,
    fence,
    finalSnapshot: { at: snapshot.at, accountId: snapshot.account.accountId, cashCents: snapshot.account.cashCents, equityCents: snapshot.account.equityCents, positions: snapshot.positions, nonTerminalOrders: snapshot.nonTerminalOrders, orderPagesFetched: snapshot.orderPagesFetched, pagesComplete: snapshot.pagesComplete, consistentReads: snapshot.consistentReads },
  });
  const directory = path.join(options.repoRoot, "evidence", "pre-arm");
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${endedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, `${JSON.stringify(certificate, null, 2)}\n`, "utf8");
  log(`certificate ${certificate.verdict} written to ${file}${certificate.failures.length > 0 ? `: ${certificate.failures.join(" | ")}` : ""}`);
  return { certificate, file, cycles };
}

/**
 * A certificate is allowed to fail, but not to abandon its disposable-account
 * exposure. Retry broker truth and drive the existing S-G11 flatten regime;
 * every close still passes through the normal authority/account/halt gateway.
 */
export async function recoverCertificateAfterFailure(options: CertificateRunOptions): Promise<boolean> {
  const { runtime, log } = options;
  const operationDeadlineMs = (): number => {
    const budget = Math.min(runtime.config.scheduling.cycleWalltimeBudgetMs, runtime.config.scheduling.lockTakeoverBoundMs - 1);
    if (!Number.isSafeInteger(budget) || budget < 1) throw new Error("certificate recovery deadline is not below the writer takeover bound");
    return options.clock() + budget;
  };
  try {
    await runtime.ping.fail(["CERTIFICATE_ABORTED"]);
  } catch {
    // Recovery continues even when the external alarm cannot be delivered.
  }
  for (let attempt = 0; attempt < options.maxFlattenCycles; attempt += 1) {
    let quiescent = false;
    let bracketHaltSeq: number | null = null;
    let bracketJournalSeq: number | null = null;
    let opened: Awaited<ReturnType<AgentRuntime["gateway"]["openJournal"]>>;
    try {
      // Fence every exceptional run before attempting to prove flatness. The
      // HALT is journal-authoritative and remains for a human to clear before
      // another certificate attempt; close/cancel recovery remains available.
      const authoritative = await runtime.gateway.openJournalAsWriter(runtime.epoch);
      if (authoritative === null) throw new Error("certificate recovery lost writer authority before flat proof");
      opened = authoritative;
      if (!opened.halt.halted || latestHaltSeq(opened.entries) === null) {
        const halted = await runtime.gateway.dispatch({ class: "authoritative", epoch: runtime.epoch, action: { kind: "journal_append", entry: { at: epochMsToUtcIso(options.clock()), epoch: runtime.epoch, type: "HALT", reason: "MANUAL", detail: "certificate aborted; reconcile every uncertain lifecycle and prove the bound account flat before human un-halt", sticky: false } } });
        if (!halted.ok) throw new Error(`certificate recovery halt failed: ${halted.reason}`);
        const haltedJournal = await runtime.gateway.openJournalAsWriter(runtime.epoch);
        if (haltedJournal === null) throw new Error("certificate recovery lost writer authority after halt");
        opened = haltedJournal;
      }
      if (!opened.halt.halted) throw new Error("certificate recovery halt is not durable");
      bracketHaltSeq = latestHaltSeq(opened.entries);
      if (bracketHaltSeq === null) throw new Error("certificate recovery halt has no journal transition");
      bracketJournalSeq = terminalJournalSeq(opened.entries);
      const unresolved = unresolvedRecoveryEntryIds(opened.entries);
      if (unresolved.length > 0) log(`certificate recovery unresolved entries ${String(attempt + 1)}: ${unresolved.join(",")}`);
      quiescent = unresolved.length === 0;
    } catch (error) {
      log("certificate recovery barrier " + String(attempt + 1) + " failed: " + (error instanceof Error ? error.message : String(error)));
    }
    try {
      if (quiescent) {
        const snapshot = await runtime.broker.fullSnapshot(operationDeadlineMs());
        if (snapshot.account.accountId === runtime.binding.accountId
          && snapshot.pagesComplete && snapshot.consistentReads >= 2
          && snapshot.positions.every(position => position.quantity === 0)
          && snapshot.nonTerminalOrders.length === 0) {
          const after = await runtime.gateway.openJournalAsWriter(runtime.epoch);
          if (after === null) throw new Error("certificate recovery lost writer authority after flat snapshot");
          if (after.halt.halted && latestHaltSeq(after.entries) === bracketHaltSeq && terminalJournalSeq(after.entries) === bracketJournalSeq && unresolvedRecoveryEntryIds(after.entries).length === 0) return true;
        }
      }
    } catch (error) {
      log("certificate recovery snapshot " + String(attempt + 1) + " failed: " + (error instanceof Error ? error.message : String(error)));
    }
    try {
      if (!await runtime.gateway.heartbeat()) throw new Error("certificate recovery lost writer authority");
      const entries = (await runtime.gateway.openJournal()).entries;
      const cycleIndex = nextCertificateCycleIndex(entries);
      await runtime.cycle(cycleIndex, { flattenDate: runtime.tradingDay, finalCycleOfSession: false, analyst: () => Promise.resolve("{\"candidates\":[]}") });
      if (!await runtime.gateway.heartbeat()) throw new Error("certificate recovery lost writer authority after flatten cycle");
    } catch (error) {
      log("certificate recovery flatten " + String(attempt + 1) + " failed: " + (error instanceof Error ? error.message : String(error)));
    }
    if (attempt + 1 < options.maxFlattenCycles) await options.sleep(options.flattenIntervalMs);
  }
  try {
    await runtime.ping.fail(["CERTIFICATE_EXPOSURE_UNRESOLVED"]);
  } catch {
    // The caller still receives the failed recovery result.
  }
  return false;
}

export async function runCertificate(options: CertificateRunOptions): Promise<CertificateRunResult> {
  try {
    return await runCertificateAttempt(options);
  } catch (error) {
    const recovered = await recoverCertificateAfterFailure(options);
    if (!recovered) throw new AggregateError([error, new Error("certificate recovery could not prove a flat account")], "certificate aborted and exposure recovery failed", { cause: error });
    throw error;
  }
}
