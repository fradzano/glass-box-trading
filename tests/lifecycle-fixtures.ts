// Shared harness for the P5 suites: the real cycle runner over the real P2
// gateway in a temporary STATE_DIR, the deterministic fake broker, a
// recording ping port, and the lifecycle dependency record. Mirrors the P3
// harness in tests/cyc-runner.spec.ts and adds the P5 surface.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { integerUnit } from "../src/core/domain.js";
import type { DecisionSnapshot } from "../src/core/domain.js";
import type { MarketObservation } from "../src/core/execution.js";
import { parseJournalText } from "../src/core/journal.js";
import type { JournalEntry } from "../src/core/journal.js";
import { runCycle } from "../src/shell/cycle-runner.js";
import type { CycleDependencies, CycleReport, LifecycleDeps, PingPort } from "../src/shell/cycle-runner.js";
import { createFakeBroker } from "../src/shell/fake-broker.js";
import type { FakeBroker, FakeBrokerOptions } from "../src/shell/fake-broker.js";
import { createMutationGateway } from "../src/shell/mutation-gateway.js";
import type { MutationGateway } from "../src/shell/mutation-gateway.js";
import { resolveStateDir } from "../src/shell/state-dir.js";
import type { StatePaths } from "../src/shell/state-dir.js";
import { LONG_CALL, SHORT_CALL, TEST_ONLY_EXECUTION_CONFIG, creditVertical } from "./execution-fixtures.js";
import { TEST_ONLY_O5_CONFIG } from "./fixtures.js";
import { TEST_ONLY_ACCOUNT_ID, TEST_ONLY_AT, TEST_ONLY_AT_MS, TEST_ONLY_ORIGIN, journalSnapshot } from "./journal-fixtures.js";

export const P5_BINDING = { profile: "dev", tradingOrigin: TEST_ONLY_ORIGIN, accountId: TEST_ONLY_ACCOUNT_ID } as const;
export const P5_NOW = TEST_ONLY_AT_MS + 60_000;
export const FAR_CALL = "SPY260904C00510000";
export const FARFAR_CALL = "SPY260904C00515000";
export const CANDIDATE_JSON = JSON.stringify({ candidates: [creditVertical()] });

/** A second, independent credit vertical (510/515) so tests can hold two journaled structures at once. */
export function secondVertical() {
  return creditVertical({
    candidateId: "candidate-second-vertical",
    rationale: "SPY vertical_credit call spread 510/515 sells a second slice of income drift.",
    legs: [
      { ...creditVertical().legs[0]!, contractId: FAR_CALL, strikeCents: integerUnit(51_000, "StrikeCents"), side: "sell" },
      { ...creditVertical().legs[1]!, contractId: FARFAR_CALL, strikeCents: integerUnit(51_500, "StrikeCents"), side: "buy" },
    ],
    entryLimit: { kind: "credit", priceCents: integerUnit(20, "OptionPriceCents") },
  });
}

export const TWO_CANDIDATES_JSON = JSON.stringify({ candidates: [creditVertical(), secondVertical()] });

const temporaryDirectories: string[] = [];

export function cleanupLifecycleDirs(): void {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
}

export function freshLifecyclePaths(): StatePaths {
  const directory = mkdtempSync(path.join(tmpdir(), "gbt-p5-"));
  temporaryDirectories.push(directory);
  const paths = resolveStateDir(directory);
  if (!paths.ok) throw new Error(paths.reason);
  return paths.value;
}

export function entriesOf(paths: StatePaths): readonly JournalEntry[] {
  return existsSync(paths.journal) ? parseJournalText(readFileSync(paths.journal, "utf8")).entries : [];
}

export function entryTypes(paths: StatePaths): readonly string[] {
  return entriesOf(paths).map(entry => (entry["action"] === "close" ? `INTENT(close:${String(entry["route"])})` : entry.type));
}

export interface RecordedPing {
  readonly successes: number[];
  readonly failures: { readonly atMs: number; readonly conditions: readonly string[] }[];
}

export function recordingPing(clock: () => number): PingPort & { readonly record: RecordedPing } {
  const record: RecordedPing = { successes: [], failures: [] };
  return {
    record,
    success: () => { record.successes.push(clock()); return Promise.resolve(); },
    fail: conditions => { record.failures.push({ atMs: clock(), conditions: [...conditions] }); return Promise.resolve(); },
  };
}

/** The default market: the three SPY calls plus the SPY equity pseudo-contract for share-residue closes (P5 decision). */
export function lifecycleMarket(clock: () => number, overrides: { readonly quotes?: Record<string, unknown>; readonly contracts?: Record<string, unknown> } = {}): () => Promise<MarketObservation> {
  return () => Promise.resolve({
    quotesByContract: {
      [SHORT_CALL]: { bidCents: 300, askCents: 302, bidSize: 20, askSize: 20, quotedAtMs: clock(), brokerQuotedAt: "2026-08-31T13:30:59.871234567Z" },
      [LONG_CALL]: { bidCents: 100, askCents: 102, bidSize: 20, askSize: 20, quotedAtMs: clock(), brokerQuotedAt: "2026-08-31T13:30:59.871234567Z" },
      [FAR_CALL]: { bidCents: 50, askCents: 52, bidSize: 20, askSize: 20, quotedAtMs: clock(), brokerQuotedAt: "2026-08-31T13:30:59.871234567Z" },
      [FARFAR_CALL]: { bidCents: 40, askCents: 41, bidSize: 20, askSize: 20, quotedAtMs: clock(), brokerQuotedAt: "2026-08-31T13:30:59.871234567Z" },
      SPY: { bidCents: 49_990, askCents: 50_010, bidSize: 100, askSize: 100, quotedAtMs: clock(), brokerQuotedAt: "2026-08-31T13:30:59.871234567Z" },
      ...(overrides.quotes ?? {}),
    },
    contractsById: {
      [SHORT_CALL]: { contractId: SHORT_CALL, underlying: "SPY", expiry: "2026-09-04", strikeCents: 50_000, right: "call" },
      [LONG_CALL]: { contractId: LONG_CALL, underlying: "SPY", expiry: "2026-09-04", strikeCents: 50_500, right: "call" },
      [FAR_CALL]: { contractId: FAR_CALL, underlying: "SPY", expiry: "2026-09-04", strikeCents: 51_000, right: "call" },
      [FARFAR_CALL]: { contractId: FARFAR_CALL, underlying: "SPY", expiry: "2026-09-04", strikeCents: 51_500, right: "call" },
      SPY: { contractId: "SPY", underlying: "SPY", expiry: "1970-01-01", strikeCents: 0, right: "call" },
      ...(overrides.contracts ?? {}),
    },
    spotCentsByUnderlying: { SPY: 50_000, QQQ: 60_000 },
  });
}

export function lifecycleCalendar(nowMs: number): DecisionSnapshot["calendar"] {
  return {
    isTradingDay: true,
    opensAt: integerUnit(nowMs - 3_600_000, "EpochMilliseconds"),
    closesAt: integerUnit(nowMs + 3_600_000, "EpochMilliseconds"),
  };
}

export function defaultLifecycleDeps(overrides: Partial<LifecycleDeps> = {}): LifecycleDeps {
  return {
    flattenDate: "2026-09-03",
    nextTradingDay: "2026-09-01",
    residueMaxSessions: 1,
    closeEscalationStepCents: 2,
    finalCycleOfSession: false,
    ...overrides,
  };
}

export interface LifecycleHarness {
  readonly paths: StatePaths;
  readonly gateway: MutationGateway;
  readonly fake: FakeBroker;
  readonly clock: { now: number };
  readonly ping: PingPort & { readonly record: RecordedPing };
  readonly analystCalls: { count: number };
  cycle(overrides?: Partial<CycleDependencies> & { readonly cycleIndex?: number }): Promise<CycleReport>;
  entries(): readonly JournalEntry[];
}

export interface LifecycleHarnessOptions {
  readonly broker?: Partial<FakeBrokerOptions>;
  readonly analyst?: CycleDependencies["analyst"];
  /** `null` skips the seed BOOTSTRAP: the journal starts empty (S-CYC-09 scenarios). */
  readonly seedEntries?: readonly Record<string, unknown>[] | null;
  readonly lifecycle?: Partial<LifecycleDeps>;
  readonly profile?: "dev" | "competition";
  readonly tradingDay?: string;
  readonly acquisitionAccount?: "virgin" | "non_virgin" | "unknown";
}

export async function lifecycleHarness(options: LifecycleHarnessOptions = {}): Promise<LifecycleHarness> {
  const paths = freshLifecyclePaths();
  const clock = { now: P5_NOW };
  const fake = createFakeBroker({ accountId: TEST_ONLY_ACCOUNT_ID, cashCents: 10_000_000, equityCents: 10_000_000, clock: () => clock.now, ...options.broker });
  const binding = { ...P5_BINDING, profile: options.profile ?? "dev" };
  const gateway = createMutationGateway({ paths, secrets: ["TEST_ONLY_SECRET_KEY"], clock: () => clock.now, brokerPort: fake.port, instanceId: "runner", lockTakeoverBoundMs: 60_000, binding });
  const acquired = await gateway.acquireAuthority({ account: options.acquisitionAccount ?? "virgin" });
  if (acquired.kind !== "WON" && acquired.kind !== "GAP_HALT") throw new Error(`fixture acquisition failed: ${JSON.stringify(acquired)}`);
  if (options.seedEntries !== null) {
    const priorSample = { bidCents: 99, askCents: 101, bidSize: 20, askSize: 20, quotedAt: TEST_ONLY_AT, brokerQuotedAt: "2026-08-31T13:29:59.871234567Z" };
    const bootstrap = {
      at: TEST_ONLY_AT,
      epoch: acquired.epoch,
      type: "BOOTSTRAP",
      snapshot: journalSnapshot({ quoteSamples: { SPY: { [SHORT_CALL]: priorSample, [LONG_CALL]: priorSample, [FAR_CALL]: { ...priorSample, bidCents: 49, askCents: 51 }, [FARFAR_CALL]: { ...priorSample, bidCents: 39, askCents: 40 }, SPY: { ...priorSample, bidCents: 49_980, askCents: 50_000 } } } }),
      epochSeeded: true,
    };
    for (const draft of [bootstrap, ...(options.seedEntries ?? [])]) {
      const result = await gateway.dispatch({ class: "authoritative", epoch: acquired.epoch, action: { kind: "journal_append", entry: draft } });
      if (!result.ok) throw new Error(`fixture seed append failed: ${result.reason} for ${JSON.stringify(draft)}`);
    }
  }
  const ping = recordingPing(() => clock.now);
  const analystCalls = { count: 0 };
  const analyst: CycleDependencies["analyst"] = options.analyst ?? (() => Promise.resolve(CANDIDATE_JSON));
  const lifecycle = defaultLifecycleDeps(options.lifecycle ?? {});
  let cycleIndex = 1;
  return {
    paths, gateway, fake, clock, ping, analystCalls,
    entries: () => entriesOf(paths),
    cycle: overrides => {
      const index = overrides?.cycleIndex ?? cycleIndex++;
      return runCycle({
        gateway, epoch: acquired.epoch, paths, binding, broker: fake.read, market: lifecycleMarket(() => clock.now),
        analyst: input => { analystCalls.count += 1; return (overrides?.analyst ?? analyst)(input); },
        analystTimeoutMs: 200, clock: () => clock.now, calendar: lifecycleCalendar(clock.now),
        tradingDay: options.tradingDay ?? "2026-08-31", profile: options.profile ?? "dev",
        decisionConfig: TEST_ONLY_O5_CONFIG, executionConfig: TEST_ONLY_EXECUTION_CONFIG,
        lifecycle, ping,
        ...overrides,
        cycleIndex: index,
      });
    },
  };
}
