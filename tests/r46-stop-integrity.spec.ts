// R46: the findings of the third counter-gate on the P12 readiness set. All
// three of its class-A findings are one sentence said three ways — **a stop
// that cannot be recorded must still stop, and a stop that was recorded must
// be reported** — at three places that each had their own idea of it.
//
// The gate before this one closed the same rule at a third entry point
// (R45-A1). What made this round different is that the rule turned out to be
// narrower than the problem: it covered the two reasons `dispatchSafetyHalt`
// accepts, and every other halt — KILL above all — reached the journal by an
// ordinary append that marked nothing.
import { appendFileSync, chmodSync, existsSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createMutationGateway, NO_BROKER_PORT } from "../src/shell/mutation-gateway.js";
import { readEpochStore, setFencePending } from "../src/shell/epoch-store.js";
import { readHaltState, standingImpediment, writeHaltState } from "../src/shell/halt-state.js";
import { cleanupLifecycleDirs, lifecycleHarness, P5_BINDING, P5_NOW } from "./lifecycle-fixtures.js";
import type { StatePaths } from "../src/shell/state-dir.js";

function gatewayFor(paths: StatePaths, instanceId = "writer", nowMs: number = P5_NOW) {
  return createMutationGateway({ paths, secrets: [], clock: () => nowMs, brokerPort: NO_BROKER_PORT, instanceId, lockTakeoverBoundMs: 60_000, binding: P5_BINDING });
}

function makeJournalUnwritable(paths: StatePaths): void {
  if (!existsSync(paths.journal)) writeFileSync(paths.journal, "", "utf8");
  chmodSync(paths.journal, 0o444);
}

function makeJournalWritable(paths: StatePaths): void {
  if (existsSync(paths.journal)) chmodSync(paths.journal, 0o666);
}

describe("R46-A2 — every halt marks before it appends, not only the two the safety entry point accepts", () => {
  it("a KILL that cannot be journaled still fences the deployment, and names why", async () => {
    // The gate's moment: equity below KILL_EQUITY_THRESHOLD, journal
    // read-only, epoch store writable. `haltDurable` was false and nothing
    // durable existed, so after recovery and a new epoch the next cycle
    // opened a position with no human release. The KILL reaches the journal
    // through the ordinary append path, which is why the safety-halt marking
    // never applied to it.
    const harness = await lifecycleHarness();
    await harness.cycle();
    const gateway = gatewayFor(harness.paths, "kill-writer", P5_NOW + 120_000);
    const acquired = await gateway.acquireAuthority({ account: "unknown" });
    const epoch = acquired.kind === "WON" ? acquired.epoch : 1;

    makeJournalUnwritable(harness.paths);
    let dispatched: Awaited<ReturnType<typeof gateway.dispatch>>;
    try {
      dispatched = await gateway.dispatch({
        class: "authoritative",
        epoch,
        action: {
          kind: "journal_append",
          entry: { at: "2026-08-31T13:40:00.000Z", epoch, type: "HALT", reason: "KILL", detail: "equity below the kill threshold", sticky: true },
        },
      });
    } finally {
      makeJournalWritable(harness.paths);
    }

    expect(dispatched.ok, "the HALT could not be journaled").toBe(false);
    expect(readHaltState(harness.paths).halted, "and the journal carries no halt").toBe(false);

    const store = readEpochStore(harness.paths);
    expect(store.kind === "present" && store.fencePending, "but the durable mark stands").toBe(true);
    expect(store.kind === "present" ? store.fenceReason : null, "and it names the stop rather than mislabelling it as a credential rejection").toBe("KILL");

    // ...so the deployment reports itself stopped, under the right reason.
    expect(standingImpediment(harness.paths)).toMatchObject({ reason: "KILL", fencePending: true });
  });

  it("a halt that DOES land keeps the mark too: the release is one human step, not two", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    const gateway = gatewayFor(harness.paths, "kill-writer-2", P5_NOW + 120_000);
    const acquired = await gateway.acquireAuthority({ account: "unknown" });
    const epoch = acquired.kind === "WON" ? acquired.epoch : 1;

    const dispatched = await gateway.dispatch({
      class: "authoritative",
      epoch,
      action: {
        kind: "journal_append",
        entry: { at: "2026-08-31T13:41:00.000Z", epoch, type: "HALT", reason: "BROKER_PRICE_BREACH", detail: "a fill breached the journaled limit", sticky: false },
      },
    });
    expect(dispatched.ok).toBe(true);
    const store = readEpochStore(harness.paths);
    expect(store.kind === "present" && store.fencePending).toBe(true);
    // The journal is the authority for the REASON; the mark only has to survive.
    expect(standingImpediment(harness.paths)).toMatchObject({ reason: "BROKER_PRICE_BREACH" });
  });
});

describe("R46-A3 — the journal is the authority, the projection is a cache of it", () => {
  it("a journaled halt whose projection write failed is still reported, instead of reading as all-clear", async () => {
    // The gate's moment: a real `HALT KILL` lands, the projection write then
    // fails, and readiness sends success and exits 0. Repeated success pings
    // also suppress the external silence alarm, so the single signal that
    // should have carried the stop was the one saying everything was fine.
    const harness = await lifecycleHarness();
    await harness.cycle();
    const gateway = gatewayFor(harness.paths, "projection-writer", P5_NOW + 120_000);
    const acquired = await gateway.acquireAuthority({ account: "unknown" });
    const epoch = acquired.kind === "WON" ? acquired.epoch : 1;
    expect((await gateway.dispatch({
      class: "authoritative",
      epoch,
      action: { kind: "journal_append", entry: { at: "2026-08-31T13:42:00.000Z", epoch, type: "HALT", reason: "KILL", detail: "equity below the kill threshold", sticky: true } },
    })).ok).toBe(true);

    // Simulate the failed projection write: the file says nothing stands. The
    // durable mark is cleared too, so ONLY the journal can carry the halt --
    // without this the test passes on the mark and measures nothing about the
    // journal, which is how the mutation probe caught it.
    writeHaltState(harness.paths, { halted: false, reason: null, sticky: false });
    expect(setFencePending(harness.paths, false)).toEqual({ ok: true });
    expect(readHaltState(harness.paths).halted, "the cache is now wrong, which is the whole premise").toBe(false);

    const impediment = standingImpediment(harness.paths);
    expect(impediment, "the journal still says the deployment is halted").not.toBeNull();
    expect(impediment?.reason).toBe("KILL");
  });

  it("and an empty journal with a clean projection is still all-clear, so the check has not simply become a constant", async () => {
    const harness = await lifecycleHarness();
    writeHaltState(harness.paths, { halted: false, reason: null, sticky: false });
    expect(standingImpediment(harness.paths)).toBeNull();
    cleanupLifecycleDirs();
  });
});

describe("R47 — the marking may not depend on a second file, and a marker keeps its strength", () => {
  it("R47-A1: a HALT whose journal cannot even be READ still leaves the mark", async () => {
    // The fifth place this rule was missing, and the first where the journal
    // was unreadable rather than unwritable: the mark used to be set after
    // `loadJournal()`, so anything that made the read fail -- a Windows handle
    // with FileShare.None, in the gate's own probe -- skipped the marking with
    // every other line after it, and once the journal came back the same
    // writer accepted a risk-increasing order. The mark is a claim about the
    // EPOCH STORE, and it may not be conditional on a second file.
    const harness = await lifecycleHarness();
    await harness.cycle();
    const gateway = gatewayFor(harness.paths, "unreadable-journal", P5_NOW + 120_000);
    const acquired = await gateway.acquireAuthority({ account: "unknown" });
    const epoch = acquired.kind === "WON" ? acquired.epoch : 1;

    // A journal the loader refuses is the portable stand-in for one it cannot
    // open: both make `loadJournal` fail before anything downstream runs.
    appendFileSync(harness.paths.journal, "this line is not a journal entry\n", "utf8");

    const dispatched = await gateway.dispatch({
      class: "authoritative",
      epoch,
      action: { kind: "journal_append", entry: { at: "2026-08-31T13:44:00.000Z", epoch, type: "HALT", reason: "KILL", detail: "equity below the kill threshold", sticky: true } },
    });
    expect(dispatched.ok, "the HALT cannot land on a journal that will not load").toBe(false);
    expect(!dispatched.ok && dispatched.reason).toContain("JOURNAL_CORRUPT");

    const store = readEpochStore(harness.paths);
    expect(store.kind === "present" && store.fencePending, "and the mark is there anyway").toBe(true);
    expect(store.kind === "present" ? store.fenceReason : null).toBe("KILL");
  });

  it("R47-A2: a marker-only KILL is as irreversible as a journaled one", async () => {
    // R46 let a KILL set the mark; the mapping of a marker-only state to
    // `AUTH_FAILURE, sticky: false` was already there. Together they
    // downgraded the strongest stop in the system: after a sticky KILL whose
    // append failed, a softer halt could land on top and an ordinary manual
    // release cleared both.
    const harness = await lifecycleHarness();
    await harness.cycle();
    expect(setFencePending(harness.paths, true, "KILL")).toEqual({ ok: true });
    expect(readHaltState(harness.paths).halted, "nothing is journaled: the mark is all there is").toBe(false);

    const gateway = gatewayFor(harness.paths, "post-kill", P5_NOW + 180_000);
    const released = await gateway.dispatchManualUnhalt({ operator: "felix", reason: "probe: releasing a marker-only kill" });
    expect(released.ok, "an ordinary release may not clear a kill").toBe(false);

    const store = readEpochStore(harness.paths);
    expect(store.kind === "present" && store.fencePending, "the mark stands").toBe(true);
  });

  it("...while a marker-only credential fence stays releasable, so the distinction is real", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    expect(setFencePending(harness.paths, true, "AUTH_FAILURE")).toEqual({ ok: true });
    const gateway = gatewayFor(harness.paths, "post-auth", P5_NOW + 180_000);
    const released = await gateway.dispatchManualUnhalt({ operator: "felix", reason: "probe: credentials checked and replaced" });
    expect(released.ok, "a credential fence is exactly what the manual release is for").toBe(true);
    const store = readEpochStore(harness.paths);
    expect(store.kind === "present" && store.fencePending).toBe(false);
    cleanupLifecycleDirs();
  });
});

describe("R48 — the strongest stop wins, whatever order the reasons arrive in", () => {
  it("a KILL whose append fails upgrades a standing AUTH_FAILURE mark instead of hiding behind it", async () => {
    // The counter-example, executed: an AUTH_FAILURE halt is journaled and
    // marked; a KILL is then requested and its append fails.
    // `markFenceBeforeHalt` returned early because a mark was already there, so
    // the mark still said AUTH_FAILURE, `effectiveHaltState` preferred the
    // journaled soft halt, and an ordinary manual release cleared both. The
    // strongest stop in the system was erased by the order the reasons
    // happened to arrive in.
    const harness = await lifecycleHarness();
    await harness.cycle();
    const gateway = gatewayFor(harness.paths, "escalating", P5_NOW + 120_000);
    const acquired = await gateway.acquireAuthority({ account: "unknown" });
    const epoch = acquired.kind === "WON" ? acquired.epoch : 1;

    // 1. a soft halt that lands, and marks
    expect((await gateway.dispatchSafetyHalt({ reason: "AUTH_FAILURE", detail: "credentials rejected" })).ok).toBe(true);
    const afterSoft = readEpochStore(harness.paths);
    expect(afterSoft.kind === "present" && afterSoft.fenceReason).toBe("AUTH_FAILURE");

    // 2. a KILL that cannot be journaled
    makeJournalUnwritable(harness.paths);
    try {
      const killed = await gateway.dispatch({
        class: "authoritative",
        epoch,
        action: { kind: "journal_append", entry: { at: "2026-08-31T13:50:00.000Z", epoch, type: "HALT", reason: "KILL", detail: "equity below the kill threshold", sticky: true } },
      });
      expect(killed.ok, "the KILL could not be journaled").toBe(false);
    } finally {
      makeJournalWritable(harness.paths);
    }

    // 3. the mark must now carry the STRONGER reason, not the older one
    const afterKill = readEpochStore(harness.paths);
    expect(afterKill.kind === "present" && afterKill.fencePending).toBe(true);
    expect(afterKill.kind === "present" ? afterKill.fenceReason : null, "the mark records the strongest stop it has seen").toBe("KILL");

    // 4. ...and an ordinary release must not clear it, even though the JOURNAL
    //    only knows about the soft halt.
    const released = await gateway.dispatchManualUnhalt({ operator: "felix", reason: "probe: releasing the soft halt" });
    expect(released.ok, "a kill hidden behind a soft halt is still a kill").toBe(false);
    expect(!released.ok && released.reason).toBe("HALT_IS_STICKY");
    const afterRelease = readEpochStore(harness.paths);
    expect(afterRelease.kind === "present" && afterRelease.fencePending).toBe(true);
  });

  it("and the other order too: a marker-only KILL is not hidden by a soft halt that lands afterwards", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    expect(setFencePending(harness.paths, true, "KILL")).toEqual({ ok: true });

    const gateway = gatewayFor(harness.paths, "soft-after-kill", P5_NOW + 120_000);
    const acquired = await gateway.acquireAuthority({ account: "unknown" });
    expect(acquired.kind === "WON" || acquired.kind === "GAP_HALT").toBe(true);
    // A soft safety halt lands on top of the marker-only kill.
    await gateway.dispatchSafetyHalt({ reason: "AUTH_FAILURE", detail: "credentials rejected after the kill" });

    const released = await gateway.dispatchManualUnhalt({ operator: "felix", reason: "probe: releasing the soft halt" });
    expect(released.ok, "the journal's softer halt may not shadow the marker's kill").toBe(false);
    expect(!released.ok && released.reason).toBe("HALT_IS_STICKY");
  });

  it("readiness reports the STRONGER stop, not the one the journal happens to know", async () => {
    // Found by the mutation probe, not by reading: reverting
    // `standingImpediment` to "journal first, mark only if the journal is
    // clear" changed no test at all. The operator would then have been told a
    // releasable AUTH_FAILURE stands while the deployment actually carried an
    // irreversible KILL -- the same defect as the gateway's, one layer out.
    const harness = await lifecycleHarness();
    await harness.cycle();
    const gateway = gatewayFor(harness.paths, "readiness-merge", P5_NOW + 120_000);
    const acquired = await gateway.acquireAuthority({ account: "unknown" });
    expect(acquired.kind === "WON" || acquired.kind === "GAP_HALT").toBe(true);
    expect((await gateway.dispatchSafetyHalt({ reason: "AUTH_FAILURE", detail: "credentials rejected" })).ok).toBe(true);
    // The journal knows only the soft halt; the mark carries the kill.
    expect(setFencePending(harness.paths, true, "KILL")).toEqual({ ok: true });

    expect(standingImpediment(harness.paths)).toMatchObject({ reason: "KILL", fencePending: true });
  });

  it("a soft mark under a soft journaled halt still releases, so the rule is about strength and not about refusing everything", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    const gateway = gatewayFor(harness.paths, "soft-only", P5_NOW + 120_000);
    const acquired = await gateway.acquireAuthority({ account: "unknown" });
    expect(acquired.kind === "WON" || acquired.kind === "GAP_HALT").toBe(true);
    expect((await gateway.dispatchSafetyHalt({ reason: "AUTH_FAILURE", detail: "credentials rejected" })).ok).toBe(true);

    const released = await gateway.dispatchManualUnhalt({ operator: "felix", reason: "probe: credentials replaced" });
    expect(released.ok, "this is exactly what the manual release exists for").toBe(true);
    const store = readEpochStore(harness.paths);
    expect(store.kind === "present" && store.fencePending).toBe(false);
    cleanupLifecycleDirs();
  });
});
