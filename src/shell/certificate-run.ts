// The supervised dev live-test driver (P7, S-ARM-01). It runs the exact
// P1–P6 artifact against the disposable dev paper account in market hours and
// collects broker-backed evidence for each certificate clause: entry cycles
// until a credit vertical is accepted and a defined-risk entry fills and
// reconciles; a flatten pass through the S-G11 deadline regime until the book
// is flat; the S-G12-06 credential-fence drill (a 401 read port, the
// journaled AUTH_FAILURE halt, the working-order check, the manual un-halt);
// a final fully paginated snapshot. The pure core turns the journal and these
// observations into the certificate; this driver only sequences and records.
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
}

export interface CertificateRunResult {
  readonly certificate: PreArmCertificate;
  readonly file: string;
  readonly cycles: readonly CycleReport[];
}

function entryIntentIds(entries: readonly JournalEntry[]): readonly string[] {
  return entries.filter(entry => entry.type === "INTENT" && (entry["action"] === "entry" || entry["action"] === undefined) && typeof entry["clientOrderId"] === "string").map(entry => entry["clientOrderId"] as string);
}

function filledEntryExists(entries: readonly JournalEntry[]): boolean {
  const intents = new Set(entryIntentIds(entries));
  return entries.some(entry => entry.type === "OUTCOME" && entry["status"] === "filled" && typeof entry["clientOrderId"] === "string" && intents.has(entry["clientOrderId"]));
}

export async function runCertificate(options: CertificateRunOptions): Promise<CertificateRunResult> {
  const { runtime, clock, log } = options;
  const startedAt = epochMsToUtcIso(clock());
  const observations: OrderObservation[] = [];
  const harnessCancels: string[] = [];
  const cycles: CycleReport[] = [];
  let cycleIndex = 0;

  async function observeOrders(): Promise<void> {
    const entries = (await runtime.gateway.openJournal()).entries;
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
    const report = await runtime.cycle(cycleIndex);
    cycles.push(report);
    log(`cycle ${String(cycleIndex)}: primary=${String(report.primary)} actions=${report.actions.map(action => `${action.clientOrderId}:${action.result}:${String(action.status)}`).join(" ")} vetoes=${report.lifecycleVetoes.map(v => v.code).join(",")} skip=${String(report.analystSkip)} blocked=${report.entriesBlocked.join(",")}`);
    await observeOrders();
    const entries = (await runtime.gateway.openJournal()).entries;
    if (filledEntryExists(entries)) {
      log("a defined-risk entry filled; one more cycle reconciles it through the snapshot");
      cycleIndex += 1;
      cycles.push(await runtime.cycle(cycleIndex));
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
    await options.sleep(options.entryIntervalMs);
  }

  // ---- phase B: flatten through the S-G11 deadline regime (FLATTEN_DATE = today for this supervised run) ----
  for (let attempt = 0; attempt < options.maxFlattenCycles; attempt += 1) {
    const [positions, openOrders] = await Promise.all([runtime.broker.read.positions(), runtime.broker.read.openOrders()]);
    if (positions.every(position => position.quantity === 0) && openOrders.every(order => !isWorkingBrokerStatus(order.status))) break;
    cycleIndex += 1;
    const report = await runtime.cycle(cycleIndex, { flattenDate: runtime.tradingDay, finalCycleOfSession: false });
    cycles.push(report);
    log(`flatten cycle ${String(cycleIndex)}: closes=${report.managementCloses.map(close => `${close.attemptId}@${String(close.limitPriceCents)}${close.atCap ? "(cap)" : ""}`).join(" ")} alarms=${report.alarmConditions.join(",")}`);
    await observeOrders();
    await options.sleep(options.flattenIntervalMs);
  }

  // ---- phase C: the credential-fence drill (S-G12-06) ----
  const badBroker = createAlpacaBroker({ credentials: { keyId: runtime.env["ALPACA_DEV_KEY_ID"] ?? "", secretKey: "INVALID-SECRET-FOR-FENCE-DRILL" }, tradingOrigin: runtime.config.binding.canonicalTradingOrigin, dataOrigin: MARKET_DATA_ORIGIN, clock });
  let fenceStatus = 0;
  try {
    await badBroker.read.account();
  } catch (error) {
    fenceStatus = httpStatusOf(error) ?? 0;
  }
  cycleIndex += 1;
  const fenceCycle = await runtime.cycle(cycleIndex, { broker: badBroker.read });
  cycles.push(fenceCycle);
  log(`fence cycle ${String(cycleIndex)}: http=${String(fenceStatus)} reasons=${fenceCycle.reasonCodes.join(",")} blocked=${fenceCycle.entriesBlocked.join(",")}`);
  // The runbook fact: a key rotation does not cancel working orders — the fence procedure ends with a working-order check/cancel.
  const working = (await runtime.broker.read.openOrders()).filter(order => isWorkingBrokerStatus(order.status)).map(order => order.clientOrderId);
  const canceledAtFence: string[] = [];
  for (const id of working) {
    const dispatched = await runtime.gateway.dispatch({ class: "authoritative", epoch: runtime.epoch, action: { kind: "broker_mutation", mutation: { kind: "cancel_order", clientOrderId: id, binding: runtime.binding } } });
    if (dispatched.ok) canceledAtFence.push(id);
  }
  const fence: FenceObservation = { httpStatus: fenceStatus, workingOrdersAtFence: working, canceledAtFence };
  const unhalt = await manualUnhalt({ paths: runtime.paths, operator: "certificate-driver", reason: `fence drill complete: HTTP ${String(fenceStatus)} observed, ${String(working.length)} working order(s) checked, ${String(canceledAtFence.length)} canceled, book reconciled`, clock, secrets: runtime.secrets, instanceId: "certificate-unhalt", lockTakeoverBoundMs: runtime.config.scheduling.lockTakeoverBoundMs });
  log(`manual un-halt: ${unhalt.ok ? "ok" : unhalt.reason}`);

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
    finalSnapshot: { at: snapshot.at, accountId: snapshot.account.accountId, cashCents: snapshot.account.cashCents, equityCents: snapshot.account.equityCents, positions: snapshot.positions, nonTerminalOrders: snapshot.nonTerminalOrders, orderPagesFetched: snapshot.orderPagesFetched, pagesComplete: snapshot.pagesComplete },
  });
  const directory = path.join(options.repoRoot, "evidence", "pre-arm");
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${endedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, `${JSON.stringify(certificate, null, 2)}\n`, "utf8");
  log(`certificate ${certificate.verdict} written to ${file}${certificate.failures.length > 0 ? `: ${certificate.failures.join(" | ")}` : ""}`);
  return { certificate, file, cycles };
}
