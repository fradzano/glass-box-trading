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
import { readEpochStore, setFencePending, writeEpochStore } from "../src/shell/epoch-store.js";
import { readHaltState } from "../src/shell/halt-state.js";
import { planEpochAcquisition } from "../src/core/authority.js";
import { readinessDelivery } from "../src/shell/agent-runtime.js";
import { planPing } from "../src/core/lifecycle.js";
import { BrokerHttpError } from "../src/shell/broker-errors.js";
import { cleanupLifecycleDirs, freshLifecyclePaths, lifecycleHarness, lifecycleMarket, P5_BINDING, P5_NOW } from "./lifecycle-fixtures.js";
import { creditVertical } from "./execution-fixtures.js";
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

  it("a release that cannot clear the mark is refused, never half-applied", async () => {
    // The operator must not walk away believing they lifted a fence that will
    // still be standing at the next cycle.
    const harness = await lifecycleHarness();
    expect(setFencePending(harness.paths, true).ok).toBe(true);
    chmodSync(harness.paths.epoch, 0o444);
    try {
      const refused = await manualUnhalt({ paths: harness.paths, operator: "felix", reason: "attempted release", clock: () => P5_NOW, secrets: [], instanceId: "manual-felix", lockTakeoverBoundMs: 60_000 });
      expect(refused.ok).toBe(false);
      expect((refused as { readonly reason: string }).reason).toContain("FENCE_NOT_CLEARED");
    } finally {
      chmodSync(harness.paths.epoch, 0o666);
    }
    // Still fenced afterwards, which is the whole point of refusing.
    const store = readEpochStore(harness.paths);
    expect(store.kind === "present" && store.fencePending).toBe(true);
  });

  it("R43-A1: a release refused by the CAS check does not take the fence with it", async () => {
    // Until 2026-09-05 the mark was cleared BEFORE the halt CAS check and
    // before the UNHALT append, so a refused release still freed the
    // deployment: the operator saw a failure and the next cycle could trade.
    const harness = await lifecycleHarness();
    expect(setFencePending(harness.paths, true).ok).toBe(true);

    const refused = await manualUnhalt({
      paths: harness.paths, operator: "felix", reason: "release against a stale expectation",
      clock: () => P5_NOW, secrets: [], instanceId: "manual-felix", lockTakeoverBoundMs: 60_000,
      expectedHaltSeq: 99, expectedHaltReason: "AUTH_FAILURE",
    });
    expect(refused).toMatchObject({ ok: false, reason: "HALT_CHANGED_SINCE_RECONCILIATION" });

    const store = readEpochStore(harness.paths);
    expect(store.kind === "present" && store.fencePending, "a refused release may not clear the fence").toBe(true);
    expect((await gatewayFor(harness.paths).openJournal()).halt.halted).toBe(true);
    expect(harness.entries().some(entry => entry.type === "UNHALT")).toBe(false);
  });

  it("R43-A1: a release whose UNHALT append cannot land does not take the fence with it", async () => {
    const harness = await lifecycleHarness();
    expect(setFencePending(harness.paths, true).ok).toBe(true);
    makeJournalUnwritable(harness.paths);
    try {
      const outcome = await manualUnhalt({ paths: harness.paths, operator: "felix", reason: "release onto a read-only journal", clock: () => P5_NOW, secrets: [], instanceId: "manual-felix", lockTakeoverBoundMs: 60_000 })
        .then(result => ({ kind: "returned" as const, result }), (error: unknown) => ({ kind: "threw" as const, error }));
      // Either shape is acceptable; what may NOT happen is a cleared fence.
      if (outcome.kind === "returned") expect(outcome.result.ok).toBe(false);
    } finally {
      makeJournalWritable(harness.paths);
    }
    const store = readEpochStore(harness.paths);
    expect(store.kind === "present" && store.fencePending, "an undurable release may not clear the fence").toBe(true);
    expect((await gatewayFor(harness.paths).openJournal()).halt.halted).toBe(true);
  });

  it("R43-A1: the successful release clears it, and only after the UNHALT is durable", async () => {
    const harness = await lifecycleHarness();
    expect(setFencePending(harness.paths, true).ok).toBe(true);
    const released = await manualUnhalt({ paths: harness.paths, operator: "felix", reason: "fence procedure run", clock: () => P5_NOW, secrets: [], instanceId: "manual-felix", lockTakeoverBoundMs: 60_000 });
    expect(released.ok).toBe(true);

    const entries = harness.entries();
    const unhalt = entries.find(entry => entry.type === "UNHALT");
    expect(unhalt, "the release is journaled before the mark is lifted").toBeDefined();
    const store = readEpochStore(harness.paths);
    expect(store.kind === "present" && store.fencePending).toBe(false);
  });

  it("R43-A1: a mark that outlives a journaled release keeps the deployment fenced, and a second release recovers", () => {
    // The window the ordering deliberately accepts: the UNHALT is durable but
    // the clear did not happen (a process death between the two writes, or a
    // store that briefly refused). Fail-closed -- still fenced -- and the
    // operator simply releases again.
    return (async () => {
      const harness = await lifecycleHarness();
      expect(setFencePending(harness.paths, true).ok).toBe(true);
      const first = await manualUnhalt({ paths: harness.paths, operator: "felix", reason: "durable release", clock: () => P5_NOW, secrets: [], instanceId: "manual-felix", lockTakeoverBoundMs: 60_000 });
      expect(first.ok).toBe(true);
      expect(harness.entries().some(entry => entry.type === "UNHALT")).toBe(true);

      // Re-mark: a later fence whose HALT could not be journaled, standing
      // against a journal whose last transition is that UNHALT.
      expect(setFencePending(harness.paths, true).ok).toBe(true);
      expect((await gatewayFor(harness.paths).openJournal()).halt.halted, "a journaled release does not override a standing mark").toBe(true);

      const second = await manualUnhalt({ paths: harness.paths, operator: "felix", reason: "second release after the interruption", clock: () => P5_NOW, secrets: [], instanceId: "manual-felix", lockTakeoverBoundMs: 60_000 });
      expect(second.ok).toBe(true);
      const store = readEpochStore(harness.paths);
      expect(store.kind === "present" && store.fencePending).toBe(false);
    })();
  });

  it("R43-B2: completing a bootstrap does not erase the mark", async () => {
    // The store is rewritten at acquisition, at bootstrap promotion and at reset
    // completion. One of them forgetting the field silently freed a fenced
    // deployment, and the bootstrap path did exactly that. Preservation now
    // lives in writeEpochStore itself, so no caller can forget it.
    const harness = await lifecycleHarness();
    expect(setFencePending(harness.paths, true).ok).toBe(true);
    const before = readEpochStore(harness.paths);
    if (before.kind !== "present") throw new Error("fixture store missing");

    // A write that says nothing about the fence must inherit it.
    writeEpochStore(harness.paths, { epoch: before.epoch, holderId: "someone-else", acquiredAt: before.acquiredAt, seedPending: true, resetPending: false });
    const after = readEpochStore(harness.paths);
    expect(after.kind === "present" && after.fencePending, "an omitted fencePending inherits, never defaults to false").toBe(true);
    expect(after.kind === "present" && after.seedPending).toBe(true);

    // Only an explicit false clears it.
    writeEpochStore(harness.paths, { epoch: before.epoch, holderId: "someone-else", acquiredAt: before.acquiredAt, seedPending: false, resetPending: false, fencePending: false });
    const cleared = readEpochStore(harness.paths);
    expect(cleared.kind === "present" && cleared.fencePending).toBe(false);
  });

  it("R43-B3: a credential fence raised at startup marks too, not only one raised inside a cycle", async () => {
    // The startup account and calendar reads fence through dispatchSafetyHalt,
    // not through the runner, and used to halt without marking -- so a 401
    // during startup left nothing behind once the journal recovered.
    const harness = await lifecycleHarness();
    const gateway = gatewayFor(harness.paths, "startup", P5_NOW + 120_000);
    const acquired = await gateway.acquireAuthority({ account: "virgin" });
    expect(acquired.kind === "WON" || acquired.kind === "GAP_HALT").toBe(true);

    const halted = await gateway.dispatchSafetyHalt({ reason: "AUTH_FAILURE", detail: "account read rejected at startup (HTTP 401)" });
    expect(halted.ok).toBe(true);
    const store = readEpochStore(harness.paths);
    expect(store.kind === "present" && store.fencePending).toBe(true);
  });

  it("R44-A1: an account-binding halt marks too -- a refused halt must not evaporate when the journal recovers", async () => {
    // Until R44 this reason deliberately left no mark, on the argument that a
    // foreign account answering is not a credential rejection. The gate
    // executed what that costs: with the journal read-only the HALT never
    // landed, and once the journal recovered the same epoch submitted a
    // risk-increasing order with no human release. The taxonomy was right and
    // irrelevant -- both reasons this entry point accepts are refusals to
    // trade until a human looks.
    const harness = await lifecycleHarness();
    const gateway = gatewayFor(harness.paths, "startup", P5_NOW + 120_000);
    const acquired = await gateway.acquireAuthority({ account: "virgin" });
    expect(acquired.kind === "WON" || acquired.kind === "GAP_HALT").toBe(true);

    makeJournalUnwritable(harness.paths);
    let halted: Awaited<ReturnType<typeof gateway.dispatchSafetyHalt>>;
    try {
      halted = await gateway.dispatchSafetyHalt({ reason: "ACCOUNT_BINDING_MISMATCH", detail: "a foreign account answered" });
    } finally {
      makeJournalWritable(harness.paths);
    }
    expect(halted.ok, "the HALT could not be journaled, so the dispatch reports failure").toBe(false);

    // The journal is writable again and carries no HALT at all...
    const store = readEpochStore(harness.paths);
    expect(store.kind === "present" && store.fencePending, "...but the mark stands, so the deployment is still fenced").toBe(true);
    expect(readHaltState(harness.paths).halted).toBe(false);

    // ...and that is enough to stop the writer that is still holding this
    // epoch -- the gate's own moment was a risk-increasing order in the SAME
    // epoch after the journal came back.
    const epoch = acquired.kind === "WON" ? acquired.epoch : 1;
    const dispatched = await gateway.dispatch({
      class: "authoritative",
      epoch,
      action: {
        kind: "broker_mutation",
        mutation: {
          kind: "submit_order",
          clientOrderId: "r44-a1-probe",
          binding: P5_BINDING,
          payload: { legs: creditVertical().legs, quantity: 1, limit: { kind: "credit", priceCents: 198 }, intent: "open" },
        },
      },
    });
    expect(dispatched.ok, "a fenced deployment writes nothing further without a human release").toBe(false);
    expect(!dispatched.ok && dispatched.reason, "and it refuses for the fence, not for some unrelated reason").toMatch(/HALT|FENCE/);
  });

  it("R45-A1: the account-bound port's own halt marks too -- the third entry point that used to write nothing", async () => {
    // Written from a blind gate's reproduction. R44-A1 made dispatchSafetyHalt
    // mark for both its reasons; this is the OTHER halt path -- the one the
    // account-bound broker port takes from inside dispatch when the broker
    // answers with a foreign account. With the journal read-only it appended
    // nothing and marked nothing, and after recovery and a restart the same
    // deployment submitted a risk-increasing order with no human release.
    // Three findings on one rule is a duty spread over three call sites, so
    // the marking now lives in one helper that both paths call.
    const harness = await lifecycleHarness();
    const gateway = gatewayFor(harness.paths, "binding-writer", P5_NOW + 120_000);
    const acquired = await gateway.acquireAuthority({ account: "virgin" });
    expect(acquired.kind === "WON" || acquired.kind === "GAP_HALT").toBe(true);
    const epoch = acquired.kind === "WON" ? acquired.epoch : 1;

    // The port rejects the binding, and the journal cannot record the halt.
    makeJournalUnwritable(harness.paths);
    let rejected: Awaited<ReturnType<typeof gateway.dispatch>>;
    try {
      rejected = await gateway.dispatch({
        class: "authoritative",
        epoch,
        action: {
          kind: "broker_mutation",
          mutation: {
            kind: "submit_order",
            clientOrderId: "r45-a1-probe",
            binding: { ...P5_BINDING, accountId: "a-foreign-account" },
            payload: { legs: creditVertical().legs, quantity: 1, limit: { kind: "credit", priceCents: 198 }, intent: "open" },
          },
        },
      });
    } finally {
      makeJournalWritable(harness.paths);
    }
    expect(rejected.ok, "the mutation is refused").toBe(false);

    // The journal carries no HALT -- it could not -- and that is exactly when
    // the mark has to be the thing that survives.
    expect(readHaltState(harness.paths).halted).toBe(false);
    const store = readEpochStore(harness.paths);
    expect(store.kind === "present" && store.fencePending, "the fence mark stands after the journal recovers").toBe(true);
  });

  it("R43-B1: a cycle whose state cannot be recorded blocks entries before touching the broker, but still reduces risk", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    const positionsBefore = await harness.fake.read.positions();
    expect(positionsBefore).not.toHaveLength(0);
    const mutationsBefore = harness.fake.mutations.length;

    makeJournalUnwritable(harness.paths);
    try {
      const report = await harness.cycle();
      expect(report.entriesBlocked).toContain("STATE_NOT_DURABLE");
      expect(report.alarmConditions.some(condition => condition.startsWith("STATE_NOT_DURABLE"))).toBe(true);
      expect(report.ping).toBe("fail");
      // No new risk was taken on a state that could not have fenced it...
      const submits = harness.fake.mutations.slice(mutationsBefore).filter(mutation => mutation.kind === "submit_order" && (mutation.payload as { intent?: string }).intent !== "close");
      expect(submits).toHaveLength(0);
    } finally {
      makeJournalWritable(harness.paths);
    }
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

  it("the delivery carries the readiness conditions, not the cycle's own alarms", () => {
    // The binding this replaces shipped exactly that defect once.
    expect(readinessDelivery({ ping: "success", pingConditions: [] })).toEqual({ kind: "success" });
    expect(readinessDelivery({ ping: "fail", pingConditions: ["HALT_STANDING:AUTH_FAILURE", "CREDENTIAL_FENCE_UNRELEASED"] }))
      .toEqual({ kind: "fail", conditions: ["HALT_STANDING:AUTH_FAILURE", "CREDENTIAL_FENCE_UNRELEASED"] });
    expect(readinessDelivery({ ping: "fail", pingConditions: [] })).toEqual({ kind: "fail", conditions: [] });
    expect(readinessDelivery({ ping: "none", pingConditions: [] })).toBeNull();
    expect(readinessDelivery({ ping: null, pingConditions: [] })).toBeNull();
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
