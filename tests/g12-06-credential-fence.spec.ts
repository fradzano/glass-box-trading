// S-G12-06 — the credential fence (AUS-3): a broker 401/403 mid-run is
// journaled as AUTH_FAILURE — a distinguishable state, not generic
// WORLD_UNREACHABLE — sets a durable halt, and blocks all orders until a
// human reconciles and un-halts. Driven through the real cycle runner, the
// real P2 gateway in a temporary STATE_DIR, and the fake broker's scripted
// HTTP failures.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { integerUnit } from "../src/core/domain.js";
import type { DecisionSnapshot } from "../src/core/domain.js";
import type { MarketObservation } from "../src/core/execution.js";
import { parseJournalText } from "../src/core/journal.js";
import type { JournalEntry } from "../src/core/journal.js";
import { classifyBrokerFailure } from "../src/core/startup.js";
import { BrokerHttpError, httpStatusOf } from "../src/shell/broker-errors.js";
import { runCycle } from "../src/shell/cycle-runner.js";
import type { CycleDependencies, CycleReport } from "../src/shell/cycle-runner.js";
import { createFakeBroker } from "../src/shell/fake-broker.js";
import type { FakeBroker } from "../src/shell/fake-broker.js";
import { readHaltState } from "../src/shell/halt-state.js";
import { createMutationGateway } from "../src/shell/mutation-gateway.js";
import { resolveStateDir } from "../src/shell/state-dir.js";
import type { StatePaths } from "../src/shell/state-dir.js";
import { TEST_ONLY_EXECUTION_CONFIG } from "./execution-fixtures.js";
import { TEST_ONLY_O5_CONFIG } from "./fixtures.js";
import { TEST_ONLY_ACCOUNT_ID, TEST_ONLY_AT, TEST_ONLY_AT_MS, TEST_ONLY_ORIGIN, journalSnapshot } from "./journal-fixtures.js";

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const BINDING = { profile: "dev", tradingOrigin: TEST_ONLY_ORIGIN, accountId: TEST_ONLY_ACCOUNT_ID } as const;
const NOW = TEST_ONLY_AT_MS + 60_000;

const calendar: DecisionSnapshot["calendar"] = {
  isTradingDay: true,
  opensAt: integerUnit(NOW - 3_600_000, "EpochMilliseconds"),
  closesAt: integerUnit(NOW + 3_600_000, "EpochMilliseconds"),
};

function emptyMarket(): Promise<MarketObservation> {
  return Promise.resolve({ quotesByContract: {}, contractsById: {}, spotCentsByUnderlying: { SPY: 50_000 } });
}

interface FenceHarness {
  readonly paths: StatePaths;
  readonly fake: FakeBroker;
  readonly analystCalls: { count: number };
  cycle(): Promise<CycleReport>;
  entries(): readonly JournalEntry[];
}

async function fenceHarness(): Promise<FenceHarness> {
  const directory = mkdtempSync(path.join(tmpdir(), "gbt-p4-fence-"));
  temporaryDirectories.push(directory);
  const resolved = resolveStateDir(directory);
  if (!resolved.ok) throw new Error(resolved.detail);
  const paths = resolved.value;
  const fake = createFakeBroker({ accountId: TEST_ONLY_ACCOUNT_ID, cashCents: 10_000_000, equityCents: 10_000_000, clock: () => NOW });
  const gateway = createMutationGateway({ paths, secrets: [], clock: () => NOW, brokerPort: fake.port, instanceId: "runner", lockTakeoverBoundMs: 60_000, binding: BINDING });
  const acquired = await gateway.acquireAuthority({ account: "virgin" });
  if (acquired.kind !== "WON") throw new Error(`fixture acquisition failed: ${JSON.stringify(acquired)}`);
  const bootstrap = { at: TEST_ONLY_AT, epoch: 1, type: "BOOTSTRAP", snapshot: journalSnapshot(), epochSeeded: true };
  const seeded = await gateway.dispatch({ class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: bootstrap } });
  if (!seeded.ok) throw new Error(`fixture seed append failed: ${seeded.reason}`);
  const analystCalls = { count: 0 };
  let cycleIndex = 1;
  const deps = (): CycleDependencies => ({
    gateway, epoch: 1, paths, binding: BINDING, broker: fake.read, market: emptyMarket,
    analyst: () => { analystCalls.count += 1; return Promise.resolve("{\"candidates\":[]}"); },
    analystTimeoutMs: 200, clock: () => NOW, calendar, tradingDay: "2026-08-31", cycleIndex: cycleIndex++, profile: "dev",
    decisionConfig: TEST_ONLY_O5_CONFIG, executionConfig: TEST_ONLY_EXECUTION_CONFIG,
  });
  return {
    paths, fake, analystCalls,
    cycle: () => runCycle(deps()),
    entries: () => (existsSync(paths.journal) ? parseJournalText(readFileSync(paths.journal, "utf8")).entries : []),
  };
}

describe("S-G12-06 / AUS-3 — a broker 401/403 is a credential fence, not world weather", () => {
  it("classifyBrokerFailure fences exactly 401 and 403", () => {
    expect(classifyBrokerFailure(401)).toBe("AUTH_FAILURE");
    expect(classifyBrokerFailure(403)).toBe("AUTH_FAILURE");
    expect(classifyBrokerFailure(500)).toBe("WORLD_DEGRADED");
    expect(classifyBrokerFailure(429)).toBe("WORLD_DEGRADED");
    expect(classifyBrokerFailure(null)).toBe("WORLD_DEGRADED");
    expect(httpStatusOf(new BrokerHttpError(401, "auth"))).toBe(401);
    expect(httpStatusOf(new Error("plain"))).toBe(null);
  });

  it("a 401 on the account read journals AUTH_FAILURE (SKIP + durable HALT), blocks entries, and sends no broker mutation", async () => {
    const harness = await fenceHarness();
    harness.fake.setReadHttpFailure(["account", "positions", "orders"], 401);
    const report = await harness.cycle();
    expect(report.reasonCodes).toEqual(["AUTH_FAILURE"]);
    expect(report.entriesBlocked).toContain("AUTH_FAILURE");
    expect(report.actions).toEqual([]);
    const skips = harness.entries().filter(entry => entry.type === "SKIP");
    expect(skips.at(-1)?.["reasonCodes"]).toEqual(["AUTH_FAILURE"]);
    const halts = harness.entries().filter(entry => entry.type === "HALT");
    expect(halts).toHaveLength(1);
    expect(halts[0]?.["reason"]).toBe("AUTH_FAILURE");
    expect(readHaltState(harness.paths)).toMatchObject({ halted: true, reason: "AUTH_FAILURE" });
    expect(harness.fake.mutations).toEqual([]);
  });

  it("a 403 on only one endpoint still fences — it never degrades to WORLD_PARTIAL", async () => {
    const harness = await fenceHarness();
    harness.fake.setReadHttpFailure(["positions"], 403);
    const report = await harness.cycle();
    expect(report.reasonCodes).toEqual(["AUTH_FAILURE"]);
    expect(harness.entries().filter(entry => entry.type === "HALT")).toHaveLength(1);
  });

  it("a plain outage stays in the S-CYC-02 world classes and sets no halt", async () => {
    const harness = await fenceHarness();
    harness.fake.failNextReads(["account", "positions", "orders"]);
    const report = await harness.cycle();
    // The market fetch survived, so the half-answer is WORLD_PARTIAL — the point here is: never AUTH_FAILURE, never a halt.
    expect(report.reasonCodes).toEqual(["WORLD_PARTIAL"]);
    expect(harness.entries().filter(entry => entry.type === "HALT")).toEqual([]);
    expect(readHaltState(harness.paths).halted).toBe(false);
  });

  it("after the credentials come back, the halt persists: the analyst is never consulted and no order leaves until a human un-halts", async () => {
    const harness = await fenceHarness();
    harness.fake.setReadHttpFailure(["account", "positions", "orders"], 401);
    await harness.cycle();
    harness.fake.setReadHttpFailure(["account", "positions", "orders"], null);
    const recovered = await harness.cycle();
    expect(recovered.primary).toBe("CYCLE");
    expect(recovered.actions).toEqual([]);
    expect(harness.analystCalls.count).toBe(0);
    expect(harness.fake.mutations).toEqual([]);
    // The fence journals exactly one HALT; the second cycle does not stack another.
    expect(harness.entries().filter(entry => entry.type === "HALT")).toHaveLength(1);
  });

  it("repeated fenced cycles journal each still-failing state without stacking halts", async () => {
    const harness = await fenceHarness();
    harness.fake.setReadHttpFailure(["account", "positions", "orders"], 403);
    await harness.cycle();
    const second = await harness.cycle();
    expect(second.reasonCodes).toEqual(["AUTH_FAILURE"]);
    expect(harness.entries().filter(entry => entry.type === "HALT")).toHaveLength(1);
    expect(harness.entries().filter(entry => entry.type === "SKIP")).toHaveLength(2);
  });
});
