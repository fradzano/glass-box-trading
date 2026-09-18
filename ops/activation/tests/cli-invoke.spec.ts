// One invocation end to end (unit 10), against the real ledger store on real files and
// the unit-6 simulator's world for the observations. The store is not faked on purpose:
// the orderings this unit is responsible for — the lease around everything, the owner's
// abort disabling *before* it waits for the lease, and the disarm that fails safe when
// the ledger cannot be read — are only real if the real lock is in the way.
//
// The action ports are null throughout, which is the state of the world until unit 13
// binds them (DECISIONS, 2026-09-14). That is itself a property worth pinning: an
// unbound action must never be recorded as applied.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { invoke } from "../cli/invoke.ts";
import type { InvocationDeps } from "../cli/invoke.ts";
import { stampFactory } from "../cli/schedule.ts";
import type { DeploymentFacts } from "../cli/schedule.ts";
import { parseInvocation } from "../cli/args.ts";
import type { ActivationInvocation } from "../cli/args.ts";
import { parseLedgerText } from "../core/ledger.ts";
import type { LedgerEntry } from "../core/types.ts";
import { currentLedgerLockOwner, withActivationLedger } from "../store/ledger-store.ts";
import { readActivationLedger } from "../store/ledger-store.ts";
import { ACCOUNT, HOST, freshWorld, localOf, observe, openAttempt, runUntil, scheduleFor, utcOf } from "./simulator.ts";
import type { SimWorld } from "./simulator.ts";



const ANCHOR = "2026-09-22";
const CERTIFICATE_DAY = "2026-09-21";
const roots: string[] = [];

async function root(): Promise<string> {
  const created = await mkdtemp(path.join(os.tmpdir(), "gbt-activation-cli-"));
  roots.push(created);
  return created;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async item => { await rm(item, { recursive: true, force: true }); }));
});

function factsFor(stateRoot: string): DeploymentFacts {
  return {
    repoRoot: "C:\\Users\\felix\\source\\repos\\glass-box-trading",
    activationRoot: stateRoot,
    longRunAccountMasked: ACCOUNT,
    coverageThroughDate: "2026-12-16",
    expectedHostPreconditions: HOST,
    minFreeDiskBytes: 10_000_000_000,
  };
}

interface Harness {
  readonly deps: InvocationDeps;
  readonly printed: string[];
  readonly world: SimWorld;
}

function harness(stateRoot: string, nowUtcMs: number, overrides: Partial<InvocationDeps> = {}): Harness {
  const world = freshWorld(nowUtcMs);
  const printed: string[] = [];
  const deps: InvocationDeps = {
    now: () => world.nowUtcMs,
    stampAt: stampFactory(localOf),
    toLocal: localOf,
    owner: currentLedgerLockOwner(),
    facts: factsFor(stateRoot),
    envFile: path.join(stateRoot, ".env"),
    observe: async () => Promise.resolve(observe(world)),
    actions: null,
    print: line => printed.push(line),
    readLedger: item => readActivationLedger(item),
    withLedger: withActivationLedger,
    ...overrides,
  };
  return { deps, printed, world };
}

function command(argv: readonly string[]): ActivationInvocation {
  const parsed = parseInvocation(argv);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.invocation;
}

async function entries(stateRoot: string): Promise<readonly LedgerEntry[]> {
  const text = await readFile(path.join(stateRoot, "ledger.jsonl"), "utf8").catch(() => "");
  return parseLedgerText(text).entries;
}

describe("run, on a ledger that holds no attempt", () => {
  it("opens one, records what it found, and does not act in the same invocation", async () => {
    const stateRoot = await root();
    const { deps, printed } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    const result = await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), deps);

    expect(result.outcome).toEqual({ kind: "opened", attempt: "2026-09-22.1", found: "LEDGER_ABSENT" });
    const written = await entries(stateRoot);
    expect(written).toHaveLength(1);
    expect(written[0]?.kind).toBe("note");
    expect(written[0]?.attempt).toBe("2026-09-22.1");
    expect(written[0]?.evidence["opened"]).toBe("LEDGER_ABSENT");
    expect(printed).toContain("would disable-tasks cycle, watchdog");
  });

  it("never records an unbound action as applied", async () => {
    const stateRoot = await root();
    const { deps } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    const result = await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), deps);

    expect(result.applied).toEqual([{ kind: "disable-tasks", applied: false, detail: null, reason: "NO_HOST_BINDINGS", completion: null }, { kind: "remove-certificate-line", applied: false, detail: null, reason: "NO_HOST_BINDINGS", completion: null }]);
    const teardown = (await entries(stateRoot))[0]?.evidence["teardown"];
    expect(teardown).toEqual([{ kind: "disable-tasks", applied: false, reason: "NO_HOST_BINDINGS" }, { kind: "remove-certificate-line", applied: false, reason: "NO_HOST_BINDINGS" }]);
  });

  it("writes nothing at all in a dry run, and says what it would have done", async () => {
    const stateRoot = await root();
    const { deps, printed } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    const result = await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR, "--dry-run"]), deps);

    expect(result.outcome.kind).toBe("opened");
    expect(await entries(stateRoot)).toHaveLength(0);
    expect(printed).toContain("would disable-tasks cycle, watchdog");
  });
});

describe("what a dry run shows", () => {
  it("prints every intended action of a step, not only the first", async () => {
    const stateRoot = await root();
    const { deps, printed } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 16, 0));
    await invoke(command(["abort", "--confirm", "--state-root", stateRoot, "--operator", "felix", "--dry-run"]), deps);

    // The owner's abort is four actions; a rehearsal that showed one of them would hide
    // three (spec §9: "prints every intended action").
    expect(printed).toEqual([
      "would disable-tasks cycle, watchdog",
      "would remove-certificate-line",
      "would delete-disarm",
      "would clear-checks",
    ]);
  });
});

describe("run, on a ledger that is damaged rather than empty", () => {
  it("reports a defect instead of opening an attempt on top of it", async () => {
    const stateRoot = await root();
    // A terminated line that is JSON but not a ledger entry: the history is a chain, and
    // nothing after the first corrupt link is trusted. There is no attempt to read here,
    // but this is not a fresh ledger either.
    await writeFile(path.join(stateRoot, "ledger.jsonl"), `{"seq":1}\n`);

    const { deps, printed } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    const result = await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), deps);

    // Today the store refuses first, at its own stage: nothing may be appended to a
    // corrupt history at all. What matters to the owner is the same either way — a
    // defect, not a new attempt written on top of the damage.
    expect(result.outcome.kind).toBe("ledger-defect");
    if (result.outcome.kind === "ledger-defect") expect(result.outcome.reason).toBe("HISTORY_CORRUPT");
    expect(printed).toEqual([]);
    expect(await entries(stateRoot)).toHaveLength(0);
  });

  it("does not open an attempt on a damaged ledger even if it is handed one", async () => {
    // The CLI's own guard, exercised where the store cannot reach it: a session whose
    // read returns damage and no attempt at all. Without the guard this is the case that
    // would start a fresh attempt on top of bytes nobody has judged yet.
    const stateRoot = await root();
    let appended = 0;
    const { deps } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35), {
      withLedger: async (_input, work) => ({
        kind: "completed",
        value: await work({
          read: async () => Promise.resolve({ state: "corrupt" as const, entries: [], damage: [], corrupt: [{ segment: 0, line: 1, reason: "SCHEMA" }] }),
          append: async () => { appended += 1; return Promise.resolve([]); },
        }),
        systemEntries: [],
      }),
    });

    const result = await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), deps);

    expect(result.outcome).toEqual({ kind: "ledger-defect", stage: "read-ledger", reason: "LEDGER_CORRUPT" });
    expect(appended).toBe(0);
  });

  it("recovers a torn tail through the store and lets the core judge what is left", async () => {
    const stateRoot = await root();
    // A first line that never got its terminator. Unit 9 answers this with a numbered
    // recovery segment and a correction; the CLI then decides against that, and the
    // damaged bytes stay where they are.
    await writeFile(path.join(stateRoot, "ledger.jsonl"), "{\"seq\":1,\"at\":\"2026-09-21T15:35:00.000+02:00\"");

    const { deps } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    const result = await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), deps);

    expect(result.outcome.kind).toBe("aborted");
    expect(await readFile(path.join(stateRoot, "ledger.jsonl"), "utf8"))
      .toBe("{\"seq\":1,\"at\":\"2026-09-21T15:35:00.000+02:00\"");
  });
});

describe("run, with an attempt open", () => {
  async function opened(stateRoot: string, nowUtcMs: number): Promise<Harness> {
    const first = harness(stateRoot, nowUtcMs);
    await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), first.deps);
    return harness(stateRoot, nowUtcMs);
  }

  it("decides against the world and records what came of it", async () => {
    const stateRoot = await root();
    const { deps } = await opened(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    const result = await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), deps);

    expect(["acted", "waited", "recorded", "aborted"]).toContain(result.outcome.kind);
    const written = await entries(stateRoot);
    expect(written.length).toBeGreaterThanOrEqual(1);
    // Whatever it decided, the attempt it wrote into is the one the first invocation opened.
    for (const entry of written) expect(entry.attempt).toBe("2026-09-22.1");
  });

  it("does nothing once the attempt has been ended", async () => {
    const stateRoot = await root();
    const { deps } = await opened(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    await invoke(command(["abort", "--confirm", "--state-root", stateRoot, "--operator", "felix"]), deps);
    const before = await entries(stateRoot);

    const result = await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), deps);
    expect(result.outcome.kind).toBe("ended");
    expect(await entries(stateRoot)).toHaveLength(before.length);
  });

  it("yields to a live invocation with one note and no work of its own", async () => {
    const stateRoot = await root();
    await opened(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    const before = (await entries(stateRoot)).length;

    let release = (): void => undefined;
    const held = new Promise<void>(resolve => { release = resolve; });
    const holder = withActivationLedger({
      root: stateRoot,
      owner: currentLedgerLockOwner(),
      makeSystemDraft: () => { throw new Error("the holder writes no system draft in this test"); },
    }, async () => { await held; return 1; });

    // Give the holder time to take the lease before the competitor arrives.
    await new Promise(resolve => { setTimeout(resolve, 50); });
    const competitor = await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 36)).deps);
    release();
    await holder;

    expect(competitor.outcome.kind).toBe("yielded");
    const written = await entries(stateRoot);
    expect(written).toHaveLength(before + 1);
    expect(written.at(-1)?.evidence["kind"]).toBe("live-lock");
  });
});

describe("opening the next attempt", () => {
  it("opens a new attempt for a new anchor day by itself, because the day resets the steps", async () => {
    const stateRoot = await root();
    const first = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), first.deps);
    await invoke(command(["abort", "--confirm", "--state-root", stateRoot, "--operator", "felix"]), first.deps);

    const { deps } = harness(stateRoot, utcOf("2026-09-28", 15, 35));
    const result = await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", "2026-09-29"]), deps);

    expect(result.outcome).toEqual({ kind: "opened", attempt: "2026-09-29.1", found: "PREVIOUS_ATTEMPT_ENDED_2026-09-22" });
    expect((await entries(stateRoot)).at(-1)?.anchorDay).toBe("2026-09-29");
  });

  // A previous day's attempt that reached step 10 and then aborted at step 11 leaves the
  // fold reading `stepDone(fold, "10-gate") === true`. Asking `abortTeardown` there would
  // owe nothing at all, and the new anchor day would begin on top of the old day's
  // enabled tasks and certificate line. The opening path therefore owes the full teardown
  // unconditionally, for the same reason SCHEDULE_NOT_FOR_THIS_ATTEMPT does: the gate that
  // is done belongs to the attempt being left behind.
  it("opens a new anchor day with a clean sweep, although the previous day's gate was green", async () => {
    const stateRoot = await root();

    // Drive a whole activation to a green gate and then end it, so the ledger carries
    // exactly the shape the defect needed: 10-gate done, attempt ended, another day.
    const world = freshWorld(utcOf(CERTIFICATE_DAY, 15, 0));
    openAttempt(world, "a1", ANCHOR);
    runUntil(world, scheduleFor(CERTIFICATE_DAY, ANCHOR), utcOf(ANCHOR, 16, 5));
    await writeFile(path.join(stateRoot, "ledger.jsonl"), world.ledgerText);

    const before = parseLedgerText(world.ledgerText);
    expect(before.entries.some(entry => entry.step === "10-gate" && entry.kind === "result")).toBe(true);

    const { deps } = harness(stateRoot, utcOf("2026-09-28", 15, 35));
    await invoke(command(["abort", "--confirm", "--state-root", stateRoot, "--operator", "felix"]), deps);
    const result = await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", "2026-09-29"]), deps);

    expect(result.outcome.kind).toBe("opened");
    expect(result.applied.map(report => report.kind)).toEqual(["disable-tasks", "remove-certificate-line"]);
  });

  it("does not reopen the same anchor day on its own, so an abort at 22:30 survives the tick at 22:35", async () => {
    const stateRoot = await root();
    const { deps } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), deps);
    await invoke(command(["abort", "--confirm", "--state-root", stateRoot, "--operator", "felix"]), deps);
    const before = (await entries(stateRoot)).length;

    const result = await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), deps);
    expect(result.outcome.kind).toBe("ended");
    expect(await entries(stateRoot)).toHaveLength(before);
  });

  it("opens the same anchor day again when the owner types it, and says who did", async () => {
    const stateRoot = await root();
    const { deps } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), deps);
    await invoke(command(["abort", "--confirm", "--state-root", stateRoot, "--operator", "felix"]), deps);

    const result = await invoke(command(["open", "--state-root", stateRoot, "--anchor-day", ANCHOR, "--operator", "felix"]), deps);

    expect(result.outcome).toEqual({ kind: "opened", attempt: "2026-09-22.2", found: "OWNER_OPENED" });
    const last = (await entries(stateRoot)).at(-1);
    expect(last?.attempt).toBe("2026-09-22.2");
    expect(last?.evidence["operator"]).toBe("felix");
    expect(last?.evidence["previousAttempt"]).toBe("2026-09-22.1");
  });

  it("refuses to open a second attempt while one is still running", async () => {
    const stateRoot = await root();
    const { deps } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), deps);
    const before = (await entries(stateRoot)).length;

    const result = await invoke(command(["open", "--state-root", stateRoot, "--anchor-day", ANCHOR, "--operator", "felix"]), deps);

    expect(result.outcome.kind).toBe("refused");
    expect(await entries(stateRoot)).toHaveLength(before);
  });

  it("lets the reopened attempt run: the next tick decides again", async () => {
    const stateRoot = await root();
    const { deps } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), deps);
    await invoke(command(["abort", "--confirm", "--state-root", stateRoot, "--operator", "felix"]), deps);
    await invoke(command(["open", "--state-root", stateRoot, "--anchor-day", ANCHOR, "--operator", "felix"]), deps);

    const result = await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), deps);
    expect(result.outcome.kind).not.toBe("ended");
  });
});

describe("the owner's own abort", () => {
  it("tears down first, then writes the terminal entry that names the operator", async () => {
    const stateRoot = await root();
    const first = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), first.deps);

    const { deps, printed } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 16, 0));
    const result = await invoke(command(["abort", "--confirm", "--state-root", stateRoot, "--operator", "felix"]), deps);

    expect(result.outcome).toEqual({
      kind: "aborted",
      step: null,
      reason: "OWNER_ABORT",
      teardown: [{ kind: "disable-tasks", applied: false, detail: null, reason: "NO_HOST_BINDINGS", completion: null }, { kind: "remove-certificate-line", applied: false, detail: null, reason: "NO_HOST_BINDINGS", completion: null }, { kind: "delete-disarm", applied: false, detail: null, reason: "NO_HOST_BINDINGS", completion: null }, { kind: "clear-checks", applied: false, detail: null, reason: "NO_HOST_BINDINGS", completion: null }],
      nextOwnerAction: "The attempt is ended. Open a new one when the run is to continue.",
    });
    expect(printed).toEqual(["would disable-tasks cycle, watchdog", "would remove-certificate-line", "would delete-disarm", "would clear-checks"]);
    const last = (await entries(stateRoot)).at(-1);
    expect(last?.kind).toBe("abort");
    expect(last?.evidence["operator"]).toBe("felix");
    expect(last?.evidence["reason"]).toBe("OWNER_ABORT");
  });

  it("still tears down when there is no attempt to end, and says so", async () => {
    const stateRoot = await root();
    const { deps, printed } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 16, 0));
    const result = await invoke(command(["abort", "--confirm", "--state-root", stateRoot, "--operator", "felix"]), deps);

    expect(result.outcome.kind).toBe("refused");
    expect(printed[0]).toBe("would disable-tasks cycle, watchdog");
    expect(await entries(stateRoot)).toHaveLength(0);
  });

  it("does not end an attempt twice", async () => {
    const stateRoot = await root();
    const first = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), first.deps);
    const { deps } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 16, 0));
    await invoke(command(["abort", "--confirm", "--state-root", stateRoot, "--operator", "felix"]), deps);
    const after = (await entries(stateRoot)).length;

    const second = await invoke(command(["abort", "--confirm", "--state-root", stateRoot, "--operator", "felix"]), deps);
    expect(second.outcome.kind).toBe("ended");
    expect(await entries(stateRoot)).toHaveLength(after);
  });
});

describe("the disarm one-shot", () => {
  it("disables both tasks when the ledger shows no green gate", async () => {
    const stateRoot = await root();
    const first = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), first.deps);

    const { deps, printed } = harness(stateRoot, utcOf(ANCHOR, 15, 5));
    const result = await invoke(command(["disarm", "--state-root", stateRoot, "--anchor-day", ANCHOR]), deps);

    expect(result.outcome.kind).toBe("aborted");
    expect(printed).toContain("would disable-tasks cycle, watchdog");
    expect((await entries(stateRoot)).at(-1)?.evidence["disarm"]).toBe("NO_GREEN_GATE");
  });

  it("leaves the tasks alone when the gate went green for this anchor day", async () => {
    const stateRoot = await root();
    const first = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), first.deps);
    // The gate's own result, written the way `run` would have written it.
    await withActivationLedger({
      root: stateRoot,
      owner: currentLedgerLockOwner(),
      makeSystemDraft: () => { throw new Error("no system draft expected"); },
    }, async session => {
      const stamp = stampFactory(localOf)(utcOf(ANCHOR, 14, 40));
      await session.append({ at: stamp.at, atUtcMs: stamp.atUtcMs, attempt: "2026-09-22.1", anchorDay: ANCHOR, step: "10-gate", kind: "result", outcome: "ok", evidence: {}, nextOwnerAction: null });
    });

    const { deps, printed } = harness(stateRoot, utcOf(ANCHOR, 15, 5));
    const result = await invoke(command(["disarm", "--state-root", stateRoot, "--anchor-day", ANCHOR]), deps);

    expect(result.outcome.kind).toBe("recorded");
    expect(printed).toEqual([]);
    expect((await entries(stateRoot)).at(-1)?.evidence["disarm"]).toBe("GATE_GREEN");
  });

  it("disables both tasks when the ledger cannot be read at all (residual G1)", async () => {
    const stateRoot = await root();
    const first = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), first.deps);
    // The exact residual: a 0-byte lock left by a kill inside the create window. Every
    // later invocation fails `read-lock:LOCK_INVALID` until a human deletes it.
    await writeFile(path.join(stateRoot, "ledger.lock"), "");

    const { deps, printed } = harness(stateRoot, utcOf(ANCHOR, 15, 5));
    const result = await invoke(command(["disarm", "--state-root", stateRoot, "--anchor-day", ANCHOR]), deps);

    expect(result.outcome.kind).toBe("aborted");
    if (result.outcome.kind === "aborted") {
      expect(result.outcome.reason).toContain("DISARMED_LEDGER_UNREADABLE");
      expect(result.outcome.teardown.map(report => report.kind)).toEqual(["disable-tasks", "remove-certificate-line"]);
    }
    expect(printed).toContain("would disable-tasks cycle, watchdog");
  }, 15_000);

  it("disables although the gate is green, when that gate is another day's", async () => {
    const stateRoot = await root();
    const first = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), first.deps);
    await withActivationLedger({
      root: stateRoot,
      owner: currentLedgerLockOwner(),
      makeSystemDraft: () => { throw new Error("no system draft expected"); },
    }, async session => {
      const stamp = stampFactory(localOf)(utcOf(ANCHOR, 14, 40));
      await session.append({ at: stamp.at, atUtcMs: stamp.atUtcMs, attempt: "2026-09-22.1", anchorDay: ANCHOR, step: "10-gate", kind: "result", outcome: "ok", evidence: {}, nextOwnerAction: null });
    });

    const { deps, printed } = harness(stateRoot, utcOf("2026-09-29", 15, 5));
    const result = await invoke(command(["disarm", "--state-root", stateRoot, "--anchor-day", "2026-09-29"]), deps);

    expect(result.outcome.kind).toBe("aborted");
    expect(printed).toContain("would disable-tasks cycle, watchdog");
  });

  it("refuses to be run for a day the open attempt is not about", async () => {
    const stateRoot = await root();
    const first = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), first.deps);

    const { deps, printed } = harness(stateRoot, utcOf("2026-09-29", 15, 5));
    const result = await invoke(command(["disarm", "--state-root", stateRoot, "--anchor-day", "2026-09-29"]), deps);

    // A one-shot registered for another day must still disable: the gate it would be
    // protecting is not this attempt's.
    expect(result.outcome.kind).toBe("aborted");
    expect(printed).toContain("would disable-tasks cycle, watchdog");
  });
});

describe("status", () => {
  it("reads without taking the lease and appends nothing", async () => {
    const stateRoot = await root();
    const first = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), first.deps);
    const before = await entries(stateRoot);

    const { deps } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 16, 0));
    const result = await invoke(command(["status", "--state-root", stateRoot]), deps);

    expect(result.outcome).toEqual({ kind: "reported" });
    expect(result.fold?.currentAttempt?.id).toBe("2026-09-22.1");
    expect(result.schedule?.certificateDay).toBe(CERTIFICATE_DAY);
    expect(await entries(stateRoot)).toHaveLength(before.length);
  });

  it("reports an empty state root instead of failing", async () => {
    const stateRoot = await root();
    const { deps } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 16, 0));
    const result = await invoke(command(["status", "--state-root", stateRoot]), deps);

    expect(result.outcome).toEqual({ kind: "reported" });
    expect(result.fold?.currentAttempt).toBeNull();
    expect(result.schedule).toBeNull();
  });
});
