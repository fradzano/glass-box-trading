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
import { epochMsToUtcIso, isWorkingBrokerStatus } from "../core/execution.js";
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
  readonly approveFenceUnhalt: (facts: { readonly haltSeq: number; readonly httpStatus: number; readonly workingOrders: readonly string[]; readonly canceledOrders: readonly string[] }) => Promise<{ readonly operator: string; readonly reason: string } | null>;
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
  const unresolved = new Set<string>();
  for (const entry of entries) {
    if (entry.type === "INTENT" && entry["action"] !== "close" && typeof entry["clientOrderId"] === "string") {
      unresolved.add(entry["clientOrderId"]);
      continue;
    }
    if (entry.type === "OUTCOME" && typeof entry["clientOrderId"] === "string") {
      const status = entry["status"];
      // OUTCOME `partially_filled` is emitted only from a broker-terminal
      // canceled/expired order: its remainder cannot fill, while the filled
      // portion still has to disappear from the final flat snapshot.
      if (status === "filled" || status === "partially_filled" || status === "rejected" || status === "canceled" || status === "expired") unresolved.delete(entry["clientOrderId"]);
      else if (status === "confirmation_unclear") unresolved.add(entry["clientOrderId"]);
      continue;
    }
    if (entry.type !== "RECONCILIATION" || !Array.isArray(entry["items"])) continue;
    for (const item of entry["items"]) {
      if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
      const record = item as Readonly<Record<string, unknown>>;
      if (record["kind"] === "entry_order" && record["classification"] === "REVALIDATION_VOID" && typeof record["clientOrderId"] === "string") unresolved.delete(record["clientOrderId"]);
    }
  }
  return [...unresolved].sort();
}

async function runCertificateAttempt(options: CertificateRunOptions): Promise<CertificateRunResult> {
  const { runtime, clock, log } = options;
  const startedAt = epochMsToUtcIso(clock());
  const observations: OrderObservation[] = [];
  const harnessCancels: string[] = [];
  const cycles: CycleReport[] = [];
  let cycleIndex = nextCertificateCycleIndex((await runtime.gateway.openJournal()).entries) - 1;

  const inCurrentWindow = (entries: readonly JournalEntry[]): readonly JournalEntry[] => entries.filter(entry => entry.at >= startedAt);

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
    for (const clientOrderId of new Set(entryIntentIds(entries))) {
      try {
        const order = await runtime.broker.read.orderByClientId(clientOrderId);
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
        const dispatched = await runtime.gateway.dispatch({ class: "authoritative", epoch: runtime.epoch, action: { kind: "broker_mutation", mutation: { kind: "cancel_order", clientOrderId: id, binding: runtime.binding } } });
        if (dispatched.ok) harnessCancels.push(id);
      }
    }
    await keepAliveSleep(options.entryIntervalMs);
  }

  // ---- phase B: flatten through the S-G11 deadline regime (FLATTEN_DATE = today for this supervised run) ----
  for (let attempt = 0; attempt < options.maxFlattenCycles; attempt += 1) {
    const [positions, openOrders] = await Promise.all([runtime.broker.read.positions(), runtime.broker.read.openOrders()]);
    if (positions.every(position => position.quantity === 0) && openOrders.every(order => !isWorkingBrokerStatus(order.status))) break;
    cycleIndex += 1;
    const report = await runLiveCycle({ flattenDate: runtime.tradingDay, finalCycleOfSession: false, analyst: () => Promise.resolve("{\"candidates\":[]}") });
    cycles.push(report);
    log(`flatten cycle ${String(cycleIndex)}: closes=${report.managementCloses.map(close => `${close.attemptId}@${String(close.limitPriceCents)}${close.atCap ? "(cap)" : ""}`).join(" ")} alarms=${report.alarmConditions.join(",")}`);
    await observeOrders();
    await keepAliveSleep(options.flattenIntervalMs);
  }

  const beforeFenceSnapshot = await runtime.broker.fullSnapshot();
  if (!beforeFenceSnapshot.pagesComplete || beforeFenceSnapshot.consistentReads < 2 || beforeFenceSnapshot.account.accountId !== runtime.binding.accountId
    || beforeFenceSnapshot.positions.some(position => position.quantity !== 0) || beforeFenceSnapshot.nonTerminalOrders.length > 0) {
    throw new Error("refusing fence drill: account is not stably flat after the flatten phase");
  }
  const beforeFenceJournal = await runtime.gateway.openJournal();
  if (beforeFenceJournal.halt.halted) throw new Error(`refusing fence drill: a pre-existing halt is active (${String(beforeFenceJournal.halt.reason)})`);
  const beforeFenceSeq = beforeFenceJournal.entries.at(-1)?.seq ?? 0;

  // ---- phase C: the credential-fence drill (S-G12-06) ----
  const badBroker = createAlpacaBroker({ credentials: { keyId: runtime.env["ALPACA_DEV_KEY_ID"] ?? "", secretKey: "INVALID-SECRET-FOR-FENCE-DRILL" }, tradingOrigin: runtime.config.binding.canonicalTradingOrigin, dataOrigin: MARKET_DATA_ORIGIN, clock, requestTimeoutMs: Math.min(runtime.config.scheduling.cycleWalltimeBudgetMs, 30_000) });
  let fenceStatus = 0;
  try {
    await badBroker.read.account();
  } catch (error) {
    fenceStatus = httpStatusOf(error) ?? 0;
  }
  cycleIndex += 1;
  const fenceCycle = await runLiveCycle({ broker: badBroker.read, analyst: () => Promise.resolve("{\"candidates\":[]}") });
  cycles.push(fenceCycle);
  log(`fence cycle ${String(cycleIndex)}: http=${String(fenceStatus)} reasons=${fenceCycle.reasonCodes.join(",")} blocked=${fenceCycle.entriesBlocked.join(",")}`);
  // The runbook fact: a key rotation does not cancel working orders — the fence procedure ends with a working-order check/cancel.
  const working = (await runtime.broker.read.openOrders()).filter(order => isWorkingBrokerStatus(order.status)).map(order => order.clientOrderId);
  const canceledAtFence: string[] = [];
  for (const id of working) {
    const dispatched = await runtime.gateway.dispatch({ class: "authoritative", epoch: runtime.epoch, action: { kind: "broker_mutation", mutation: { kind: "cancel_order", clientOrderId: id, binding: runtime.binding } } });
    if (!dispatched.ok) throw new Error(`fence cancel of ${id} failed: ${dispatched.reason}`);
    let confirmed = false;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const observed = await runtime.broker.read.orderByClientId(id);
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
  const fence: FenceObservation = { httpStatus: fenceStatus, workingOrdersAtFence: working, canceledAtFence };
  if (fenceStatus !== 401 && fenceStatus !== 403) throw new Error(`fence drill did not observe 401/403 (got ${String(fenceStatus)})`);
  const halted = await runtime.gateway.openJournal();
  const authHalt = [...halted.entries].reverse().find(entry => entry.seq > beforeFenceSeq && entry.type === "HALT" && entry["reason"] === "AUTH_FAILURE");
  if (authHalt === undefined || !halted.halt.halted || halted.halt.reason !== "AUTH_FAILURE") throw new Error("fence drill did not create its own active AUTH_FAILURE halt");
  const reconciledWhileHalted = await runtime.broker.fullSnapshot();
  if (!reconciledWhileHalted.pagesComplete || reconciledWhileHalted.consistentReads < 2 || reconciledWhileHalted.account.accountId !== runtime.binding.accountId
    || reconciledWhileHalted.positions.some(position => position.quantity !== 0) || reconciledWhileHalted.nonTerminalOrders.length > 0) {
    throw new Error("fence reconciliation is not stably flat; AUTH_FAILURE halt remains active");
  }
  const approval = await options.approveFenceUnhalt({ haltSeq: authHalt.seq, httpStatus: fenceStatus, workingOrders: working, canceledOrders: canceledAtFence });
  if (approval === null) throw new Error("human fence un-halt approval was not provided; AUTH_FAILURE halt remains active");
  const unhalt = await manualUnhalt({ paths: runtime.paths, operator: approval.operator, reason: approval.reason, clock, secrets: runtime.secrets, instanceId: "certificate-unhalt", lockTakeoverBoundMs: runtime.config.scheduling.lockTakeoverBoundMs, expectedHaltSeq: authHalt.seq, expectedHaltReason: "AUTH_FAILURE" });
  log(`manual un-halt: ${unhalt.ok ? "ok" : unhalt.reason}`);
  if (!unhalt.ok) throw new Error(`manual fence un-halt refused: ${unhalt.reason}`);

  // ---- phase D: the final fully paginated snapshot and the certificate ----
  const snapshot = await runtime.broker.fullSnapshot();
  const journal = (await runtime.gateway.openJournal()).entries;
  const endedAt = epochMsToUtcIso(clock());
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
  try {
    await runtime.ping.fail(["CERTIFICATE_ABORTED"]);
  } catch {
    // Recovery continues even when the external alarm cannot be delivered.
  }
  for (let attempt = 0; attempt < options.maxFlattenCycles; attempt += 1) {
    let quiescent = false;
    let opened: Awaited<ReturnType<AgentRuntime["gateway"]["openJournal"]>>;
    try {
      // Fence every exceptional run before attempting to prove flatness. The
      // HALT is journal-authoritative and remains for a human to clear before
      // another certificate attempt; close/cancel recovery remains available.
      const authoritative = await runtime.gateway.openJournalAsWriter(runtime.epoch);
      if (authoritative === null) throw new Error("certificate recovery lost writer authority before flat proof");
      opened = authoritative;
      if (!opened.halt.halted) {
        const halted = await runtime.gateway.dispatch({ class: "authoritative", epoch: runtime.epoch, action: { kind: "journal_append", entry: { at: epochMsToUtcIso(options.clock()), epoch: runtime.epoch, type: "HALT", reason: "MANUAL", detail: "certificate aborted; reconcile every uncertain lifecycle and prove the bound account flat before human un-halt", sticky: false } } });
        if (!halted.ok) throw new Error(`certificate recovery halt failed: ${halted.reason}`);
        const haltedJournal = await runtime.gateway.openJournalAsWriter(runtime.epoch);
        if (haltedJournal === null) throw new Error("certificate recovery lost writer authority after halt");
        opened = haltedJournal;
      }
      if (!opened.halt.halted) throw new Error("certificate recovery halt is not durable");
      const unresolved = unresolvedRecoveryEntryIds(opened.entries);
      if (unresolved.length > 0) log(`certificate recovery unresolved entries ${String(attempt + 1)}: ${unresolved.join(",")}`);
      quiescent = unresolved.length === 0;
    } catch (error) {
      log("certificate recovery barrier " + String(attempt + 1) + " failed: " + (error instanceof Error ? error.message : String(error)));
    }
    try {
      if (quiescent) {
        const snapshot = await runtime.broker.fullSnapshot();
        if (snapshot.account.accountId === runtime.binding.accountId
          && snapshot.pagesComplete && snapshot.consistentReads >= 2
          && snapshot.positions.every(position => position.quantity === 0)
          && snapshot.nonTerminalOrders.length === 0) {
          const after = await runtime.gateway.openJournalAsWriter(runtime.epoch);
          if (after === null) throw new Error("certificate recovery lost writer authority after flat snapshot");
          if (after.halt.halted && unresolvedRecoveryEntryIds(after.entries).length === 0) return true;
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
