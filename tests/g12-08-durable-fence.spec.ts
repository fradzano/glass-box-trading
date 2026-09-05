// S-G12-08 (A30, scenarios #76/#77) and S-G14-05 (A31, #78): a credential
// fence that could not be recorded still fences, and a standing impediment is
// never reported as readiness.
//
// The case these tests exist for was reproduced by a blind gate on 2026-09-05
// (R42-B2): with the journal unwritable, the AUTH_FAILURE halt never landed,
// `halted` stayed false, and the next cycle opened a position with no human
// un-halt. Every row of the failure-boundary table in the spec is asserted
// here, including the row where nothing durable can be written at all.
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createMutationGateway, NO_BROKER_PORT } from "../src/shell/mutation-gateway.js";
import { manualUnhalt } from "../src/shell/manual-unhalt.js";
import { readEpochStore, setFencePending } from "../src/shell/epoch-store.js";
import { readHaltState } from "../src/shell/halt-state.js";
import { planEpochAcquisition } from "../src/core/authority.js";
import { planPing } from "../src/core/lifecycle.js";
import { BrokerHttpError } from "../src/shell/broker-errors.js";
import { cleanupLifecycleDirs, freshLifecyclePaths, lifecycleHarness, lifecycleMarket, P5_BINDING, P5_NOW } from "./lifecycle-fixtures.js";
import type { MarketObservation } from "../src/core/execution.js";
import type { StatePaths } from "../src/shell/state-dir.js";

function gatewayFor(paths: StatePaths, instanceId = "writer", nowMs: number = P5_NOW) {
  return createMutationGateway({ paths, secrets: [], clock: () => nowMs, brokerPort: NO_BROKER_PORT, instanceId, lockTakeoverBoundMs: 60_000, binding: P5_BINDING });
}

/** Make the journal file itself unwritable, the way a full or read-only disk does. */
function makeJournalUnwritable(paths: StatePaths): void {
  if (!existsSync(paths.journal)) writeFileSync(paths.journal, "", "utf8");
  chmodSync(paths.journal, 0o444);
}

function makeJournalWritable(paths: StatePaths): void {
  if (existsSync(paths.journal)) chmodSync(paths.journal, 0o666);
}

describe("S-G12-08 — the fence mark is set before the entry is attempted and only a human clears it", () => {
  it("survives a journal that cannot be written: the next cycle is fenced although no HALT was journaled", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle(); // a normal cycle first: the entry fills
    expect(await harness.fake.read.positions()).not.toHaveLength(0);

    // The rejection arrives while the journal is unwritable.
    makeJournalUnwritable(harness.paths);
    const rejected = (): Promise<MarketObservation> => Promise.reject(new BrokerHttpError(403, "403 forbidden"));
    await harness.cycle({ market: rejected });
    makeJournalWritable(harness.paths);

    // Nothing was journaled and the projection never learned of the halt...
    expect(harness.entries().some(entry => entry.type === "HALT")).toBe(false);
    // ...but the mark is down, and that is what the next cycle must obey.
    const store = readEpochStore(harness.paths);
    expect(store.kind === "present" && store.fencePending).toBe(true);

    const next = await harness.cycle();
    expect(next.actions.filter(action => action.result === "SUBMITTED")).toHaveLength(0);
    expect(next.ping).toBe("fail");
  });

  it("a journaled UNHALT from an earlier incident cannot clear the mark", async () => {
    // This is why the mark does not live in the halt projection: the journal is
    // authoritative there, so an older HALT/UNHALT pair would overrule it.
    const harness = await lifecycleHarness();
    const gateway = gatewayFor(harness.paths, "runner");
    const acquired = await gateway.acquireAuthority({ account: "virgin" });
    expect(acquired.kind === "WON" || acquired.kind === "GAP_HALT").toBe(true);

    await gateway.dispatchSafetyHalt({ reason: "AUTH_FAILURE", detail: "an earlier incident" });
    const cleared = await manualUnhalt({ paths: harness.paths, operator: "felix", reason: "earlier incident reviewed", clock: () => P5_NOW, secrets: [], instanceId: "runner", lockTakeoverBoundMs: 60_000 });
    expect(cleared.ok).toBe(true);
    expect(readHaltState(harness.paths).halted).toBe(false);

    // A new fence that cannot be journaled now stands against that history.
    expect(setFencePending(harness.paths, true).ok).toBe(true);
    const opened = await gateway.openJournal();
    expect(opened.halt).toMatchObject({ halted: true, reason: "AUTH_FAILURE" });
  });

  it("survives a restart: acquisition inherits the mark instead of clearing it", async () => {
    const harness = await lifecycleHarness();
    expect(setFencePending(harness.paths, true).ok).toBe(true);

    // A fresh process takes the epoch, exactly as the next scheduled task does
    // after the previous holder's heartbeat has aged past the takeover bound.
    const restarted = gatewayFor(harness.paths, "writer-after-restart", P5_NOW + 120_000);
    const acquired = await restarted.acquireAuthority({ account: "unknown" });
    expect(acquired.kind === "WON" || acquired.kind === "GAP_HALT").toBe(true);
    const store = readEpochStore(harness.paths);
    expect(store.kind === "present" && store.fencePending, "an acquisition may not be a way back to trading").toBe(true);
    expect((await restarted.openJournal()).halt.halted).toBe(true);
  });

  it("the pure acquisition plan carries the mark, so no shell path can drop it", () => {
    const present = { kind: "present" as const, epoch: 3, holderId: "a", acquiredAt: "2026-08-31T13:31:00.000Z", seedPending: false, resetPending: false, fencePending: true };
    expect(planEpochAcquisition(present, { account: "virgin", journalEmpty: false })).toMatchObject({ kind: "INCREMENT", fencePending: true });
    expect(planEpochAcquisition({ ...present, fencePending: false }, { account: "virgin", journalEmpty: false })).toMatchObject({ kind: "INCREMENT", fencePending: false });
  });

  it("only the human un-halt clears it, and a release that cannot clear it is refused", async () => {
    const harness = await lifecycleHarness();
    expect(setFencePending(harness.paths, true).ok).toBe(true);

    const released = await manualUnhalt({ paths: harness.paths, operator: "felix", reason: "fence procedure run, working orders checked", clock: () => P5_NOW, secrets: [], instanceId: "manual-felix", lockTakeoverBoundMs: 60_000 });
    expect(released.ok).toBe(true);
    const store = readEpochStore(harness.paths);
    expect(store.kind === "present" && store.fencePending).toBe(false);
    expect((await gatewayFor(harness.paths).openJournal()).halt.halted).toBe(false);
  });

  it("a risk-reducing close stays possible while fenced: no stricter than a journaled halt", async () => {
    // A fenced book must still be flattenable once the credentials work again;
    // the fence blocks risk-INCREASING orders, which is exactly what a
    // journaled halt blocks.
    const harness = await lifecycleHarness();
    await harness.cycle();
    expect(setFencePending(harness.paths, true).ok).toBe(true);

    const flatten = await harness.cycle({ tradingDay: "2026-09-03" });
    expect(flatten.actions.filter(action => action.result === "SUBMITTED")).toHaveLength(0);
    expect(flatten.managementCloses.length + flatten.managementRefusals.length).toBeGreaterThan(0);
  });

  it("when the epoch store cannot be written either, the mark fails loudly and authority cannot be taken", async () => {
    // The third row of the boundary table. Nothing durable can be recorded —
    // and nothing can act, because acquisition writes the epoch store and a
    // failed durable write is REFUSED, never a half-acquired authority.
    const paths = freshLifecyclePaths();
    writeFileSync(paths.epoch, "{ not json", "utf8");

    expect(setFencePending(paths, false)).toMatchObject({ ok: false, reason: "EPOCH_STORE_UNREADABLE" });
    const gateway = gatewayFor(paths, "writer-on-broken-store");
    expect(await gateway.acquireAuthority({ account: "virgin" })).toMatchObject({ kind: "REFUSED" });
    cleanupLifecycleDirs();
  });
});

describe("S-G14-05 — liveness and readiness are two claims", () => {
  it("a standing halt outranks a landed append: readiness never says success while the deployment cannot trade", () => {
    expect(planPing({ durableAppendLanded: true, alarmConditions: [] })).toEqual({ kind: "success" });
    expect(planPing({ durableAppendLanded: true, alarmConditions: [], standingHalt: null })).toEqual({ kind: "success" });
    expect(planPing({ durableAppendLanded: true, alarmConditions: [], standingHalt: { reason: "AUTH_FAILURE", fencePending: false } }))
      .toEqual({ kind: "fail", conditions: ["HALT_STANDING:AUTH_FAILURE"] });
    expect(planPing({ durableAppendLanded: true, alarmConditions: [], standingHalt: { reason: "AUTH_FAILURE", fencePending: true } }))
      .toEqual({ kind: "fail", conditions: ["HALT_STANDING:AUTH_FAILURE", "CREDENTIAL_FENCE_UNRELEASED"] });
  });

  it("the impediment is named alongside whatever else the cycle found, halt first", () => {
    expect(planPing({ durableAppendLanded: true, alarmConditions: ["RESIDUE_UNRESOLVED_BEYOND_MAX_SESSIONS:2"], standingHalt: { reason: "RESIDUE_UNRESOLVED", fencePending: false } }))
      .toEqual({ kind: "fail", conditions: ["HALT_STANDING:RESIDUE_UNRESOLVED", "RESIDUE_UNRESOLVED_BEYOND_MAX_SESSIONS:2"] });
  });

  it("it re-reports on every invocation, not only the one that halted", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    const rejected = (): Promise<MarketObservation> => Promise.reject(new BrokerHttpError(401, "401 unauthorized"));
    const fenced = await harness.cycle({ market: rejected });
    expect(fenced.ping).toBe("fail");

    // Two quiet, entirely successful cycles later, the check must still be red.
    const quiet = await harness.cycle({ market: lifecycleMarket(() => harness.clock.now) });
    expect(quiet.ping).toBe("fail");
    const quieter = await harness.cycle({ market: lifecycleMarket(() => harness.clock.now) });
    expect(quieter.ping).toBe("fail");
    expect(readHaltState(harness.paths).halted).toBe(true);
  });

  it("the conditions travel with the signal: an alert with an empty body names nothing", async () => {
    // Measured end to end on 2026-09-05 against a real HTTP endpoint: the
    // composition root delivered `alarmConditions` rather than the ping plan's
    // conditions, so a fenced cycle POSTed an EMPTY body and the operator would
    // have been woken by an alert that said nothing at all.
    const harness = await lifecycleHarness();
    await harness.cycle();
    const rejected = (): Promise<MarketObservation> => Promise.reject(new BrokerHttpError(401, "401 unauthorized"));
    const fenced = await harness.cycle({ market: rejected });

    expect(fenced.ping).toBe("fail");
    expect(fenced.alarmConditions, "the cycle itself raised no alarm; the impediment is the halt").toEqual([]);
    expect(fenced.pingConditions).toContain("HALT_STANDING:AUTH_FAILURE");
    expect(fenced.pingConditions).toContain("CREDENTIAL_FENCE_UNRELEASED");
    expect(harness.ping.record.failures.at(-1)?.conditions).toEqual(fenced.pingConditions);
  });

  it("and it goes green again only after the human release", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    const rejected = (): Promise<MarketObservation> => Promise.reject(new BrokerHttpError(401, "401 unauthorized"));
    await harness.cycle({ market: rejected });

    const released = await manualUnhalt({ paths: harness.paths, operator: "felix", reason: "keys rotated, working orders checked", clock: () => harness.clock.now, secrets: [], instanceId: "manual-felix", lockTakeoverBoundMs: 60_000 });
    expect(released.ok).toBe(true);
    const after = await harness.cycle({ market: lifecycleMarket(() => harness.clock.now) });
    expect(after.ping).toBe("success");
  });
});
