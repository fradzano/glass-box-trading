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
import { applyAll, invoke } from "../cli/invoke.ts";
import type { InvocationDeps } from "../cli/invoke.ts";
import { stampFactory } from "../cli/schedule.ts";
import type { DeploymentFacts } from "../cli/schedule.ts";
import { parseInvocation } from "../cli/args.ts";
import type { ActivationInvocation } from "../cli/args.ts";
import { parseLedgerText } from "../core/ledger.ts";
import { foldLedger } from "../core/fold.ts";
import { nextStep } from "../core/steps.ts";
import { outcomeLines } from "../cli/report.ts";
import { exitCodeFor, pages } from "../cli/plan.ts";
import { clearStopMark, quarantineStopMark, readStopMark, writeStopMark } from "../store/stop-mark.ts";
import type { StopMark } from "../core/stop.ts";
import type { LedgerEntry } from "../core/types.ts";
import { LedgerStoreError, currentLedgerLockOwner, withActivationLedger } from "../store/ledger-store.ts";
import { readActivationLedger } from "../store/ledger-store.ts";
import { ACCOUNT, ACTIVATION_ROOT, HOST, LONG_RUN, freshWorld, localOf, observe, openAttempt, runUntil, scheduleFor, utcOf } from "./simulator.ts";
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
    longRunStateDir: LONG_RUN,
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
    repoRoot: "C:\\Users\\felix\\source\\repos\\glass-box-trading",
    activationRoot: stateRoot,
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
    // Seven, not four: since the stop contract the rehearsal shows both passes — the four
    // actions the stop applies before it takes the lease, and the three it re-applies
    // under it (SC-4). A rehearsal that hid the second pass would rehearse a different
    // command from the one it stands for.
    expect(printed).toEqual([
      "would disable-tasks cycle, watchdog",
      "would remove-certificate-line",
      "would delete-disarm",
      "would clear-checks",
      "would disable-tasks cycle, watchdog",
      "would remove-certificate-line",
      "would delete-disarm",
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

describe("a safety command carries no prerequisite it does not consume", () => {
  // G-3. Both deployment files used to be read in a common prologue, one of them at
  // module scope above `main`'s reach, so a file that `status`, `abort` and `disarm`
  // consume nothing of could refuse all five commands alike — and a broken
  // `config/deployment.json` killed even `status` with a raw stack trace and exit 1, the
  // code this CLI reserves for "the attempt is over, teardown ran, the ledger says why".
  // `facts: null` here is exactly what the CLI passes when the host file is missing.
  it("status reports the ledger although the measured facts are missing, and projects no schedule", async () => {
    const stateRoot = await root();
    const { deps } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    const result = await invoke(command(["status", "--state-root", stateRoot]), { ...deps, facts: null });

    expect(result.outcome).toEqual({ kind: "reported" });
    expect(result.fold).not.toBeNull();
    expect(result.schedule).toBeNull();
  });

  it("the owner's abort still tears down and ends the attempt without the measured facts", async () => {
    const stateRoot = await root();
    const { deps } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), deps);

    const result = await invoke(command(["abort", "--confirm", "--state-root", stateRoot, "--operator", "felix"]), { ...deps, facts: null });

    expect(result.outcome.kind).toBe("aborted");
    expect(result.applied.map(report => report.kind)).toEqual([
      "disable-tasks", "remove-certificate-line", "delete-disarm", "clear-checks",
      "disable-tasks", "remove-certificate-line", "delete-disarm",
    ]);
  });

  it("the 15:05 disarm still disables without the measured facts, which is the whole point of it", async () => {
    const stateRoot = await root();
    const { deps, printed } = harness(stateRoot, utcOf(ANCHOR, 15, 5));
    const result = await invoke(command(["disarm", "--state-root", stateRoot, "--anchor-day", ANCHOR]), { ...deps, facts: null });

    expect(result.outcome.kind).toBe("aborted");
    expect(printed).toContain("would disable-tasks cycle, watchdog");
  });

  it("run and open do refuse without them, because they are what those two consume", async () => {
    const stateRoot = await root();
    const { deps } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));

    for (const argv of [["run", "--state-root", stateRoot, "--anchor-day", ANCHOR], ["open", "--state-root", stateRoot, "--anchor-day", ANCHOR, "--operator", "felix"]]) {
      const result = await invoke(command(argv), { ...deps, facts: null });
      expect(result.outcome.kind).toBe("refused");
    }
  });
});

// Axiom A4: an append that fails **is** an abort — disable both tasks, page, exit (ACT-44,
// ACT-60). The teardown that honours it was built and then measured by nothing: deleting the
// whole block left every test green, which is the state in which a repair returns silently.
describe("a result append that fails at the gate", () => {
  /**
   * A ledger whose result append at the gate throws — the one moment A4 is about. It is
   * selected by what the draft *is*, not by how many appends came before it, so the test
   * cannot drift into failing a different write when the order changes.
   */
  const failingResultAppend: typeof withActivationLedger = (options, work) => withActivationLedger(options, async session => await work({
    read: () => session.read(),
    append: async draft => {
      // The shape the store actually produces. A plain `Error` stood here and made this test
      // green on a branch production cannot take: every real failure inside `session.append`
      // leaves as a `LedgerStoreError` with a stage of its own, and `withActivationLedger`
      // rethrows it unchanged, so a genuine append failure ends as a `ledger-defect` and never
      // as the `work-failed` these expectations were written for. Injecting the real shape is
      // what turns that from an argument into a measurement. It is expected to be RED until the
      // reporting path is repaired, and that repair is not this test's to make.
      if (draft.kind === "result" && draft.step === "10-gate") throw new LedgerStoreError("write-ledger", "NO_SPACE");
      return await session.append(draft);
    },
  }));

  /** A world and a ledger that agree, driven to the invocation that has the gate in front of it. */
  async function atTheGate(): Promise<{ readonly stateRoot: string; readonly world: SimWorld }> {
    const stateRoot = await root();
    const world = freshWorld(utcOf(CERTIFICATE_DAY, 15, 0));
    openAttempt(world, "a1", ANCHOR);
    runUntil(world, scheduleFor(CERTIFICATE_DAY, ANCHOR), utcOf(ANCHOR, 14, 30));
    await writeFile(path.join(stateRoot, "ledger.jsonl"), world.ledgerText);
    const fold = foldLedger(parseLedgerText(world.ledgerText));
    expect(nextStep(fold)).toBe("10-gate");
    // The observations must come from the world this ledger was driven through, not from a
    // fresh one: a world that never ran steps 0 to 9 is a `WORLD_MISMATCH`, and the run
    // would abort before it ever reached the append this test is about.
    world.nowUtcMs = utcOf(ANCHOR, 14, 40);
    return { stateRoot, world };
  }

  it("tears down inside the lease when the result append throws, and tells the owner it did", async () => {
    const { stateRoot, world } = await atTheGate();
    const { deps, printed } = harness(stateRoot, world.nowUtcMs, {
      withLedger: failingResultAppend,
      now: () => world.nowUtcMs,
      observe: async () => Promise.resolve(observe(world)),
      // The disarm one-shot this world registered carries the simulator's activation root
      // in its argument line, and the core compares that line by value (spec §6). A schedule
      // built on the temporary ledger directory would red `disarm.arguments` and abort
      // before the gate — a world mismatch, not the append failure this test is about.
      facts: { ...factsFor(stateRoot), activationRoot: ACTIVATION_ROOT },
    });

    const result = await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), deps);

    // The intent landed, the certificate was written, the result append threw — and the
    // teardown ran before the failure left the session, where the lease is still held.
    expect(printed).toContain("would disable-tasks cycle, watchdog");
    expect(printed).toContain("would remove-certificate-line");
    expect(result.applied.map(report => report.kind)).toContain("disable-tasks");
    expect(result.applied.map(report => report.kind)).toContain("remove-certificate-line");

    // SC-7, and this is where R3-09 stood. The classification is still `ledger-defect`,
    // because that is what a failed append to the record is and the task history needs
    // its own number for it — but the teardown now travels with it, and the owner is told
    // in the same breath that both tasks were disabled and the certificate line removed.
    expect(result.outcome.kind).toBe("ledger-defect");
    expect(exitCodeFor(result.outcome)).toBe(3);
    expect(pages(result.outcome)).toBe(true);
    const lines = outcomeLines(result.outcome);
    expect(lines[0]).toContain("LEDGER DEFECT");
    expect(lines[1]).toContain("disable-tasks");
    expect(lines[1]).toContain("remove-certificate-line");
    expect(lines.at(-1)).toContain("the record itself cannot be trusted");
  });

  // The shapes the store really throws, one per stage it can fail at. The test that stood
  // here injected a plain `Error` — the one shape `session.append` can never produce — so
  // the branch it certified was one production cannot take. "Grün ≠ korrekt" in its exact
  // form, on the repair's own test.
  for (const stage of ["write-ledger", "sync-ledger", "close-ledger"] as const) {
    it(`carries the teardown out of a real ${stage} failure`, async () => {
      const { stateRoot, world } = await atTheGate();
      const failingAt: typeof withActivationLedger = (options, work) => withActivationLedger(options, async session => await work({
        read: () => session.read(),
        append: async draft => {
          if (draft.kind === "result" && draft.step === "10-gate") throw new LedgerStoreError(stage, "IO_ERROR");
          return await session.append(draft);
        },
      }));
      const { deps } = harness(stateRoot, world.nowUtcMs, {
        withLedger: failingAt,
        now: () => world.nowUtcMs,
        observe: async () => Promise.resolve(observe(world)),
        facts: { ...factsFor(stateRoot), activationRoot: ACTIVATION_ROOT },
      });

      const result = await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), deps);

      expect(result.outcome.kind).toBe("ledger-defect");
      if (result.outcome.kind !== "ledger-defect") throw new Error("the outcome carries the stage");
      expect(result.outcome.stage).toBe(stage);
      expect(result.outcome.teardown?.map(report => report.kind)).toContain("disable-tasks");
      expect(outcomeLines(result.outcome).join(" | ")).toContain("disable-tasks");
    });
  }
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

    expect(result.outcome).toEqual({ kind: "opened", attempt: "2026-09-22.2", found: "OWNER_OPENED", stopStanding: null });
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
  it("tears down first, confirms under the lease, and writes the terminal entry that names the operator", async () => {
    const stateRoot = await root();
    const first = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), first.deps);

    const { deps, printed } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 16, 0));
    const result = await invoke(command(["abort", "--confirm", "--state-root", stateRoot, "--operator", "felix"]), deps);

    if (result.outcome.kind !== "aborted") throw new Error(`the abort did not report an abort: ${result.outcome.kind}`);
    expect(result.outcome.reason).toBe("OWNER_ABORT");
    // Two passes: the four the stop owes before the lease, the three it re-applies under
    // it (SC-4). Nothing applied, because this deployment has no host bindings — and the
    // sentence the owner reads says exactly that rather than implying a teardown ran.
    expect(result.outcome.teardown.map(report => report.kind)).toEqual([
      "disable-tasks", "remove-certificate-line", "delete-disarm", "clear-checks",
      "disable-tasks", "remove-certificate-line", "delete-disarm",
    ]);
    expect(result.outcome.teardown.every(report => !report.applied && report.reason === "NO_HOST_BINDINGS")).toBe(true);
    expect(result.outcome.nextOwnerAction).toContain("the stop changed nothing, because this deployment has no host bindings");
    expect(printed).toEqual([
      "would disable-tasks cycle, watchdog", "would remove-certificate-line", "would delete-disarm", "would clear-checks",
      "would disable-tasks cycle, watchdog", "would remove-certificate-line", "would delete-disarm",
    ]);

    const last = (await entries(stateRoot)).at(-1);
    expect(last?.kind).toBe("abort");
    expect(last?.evidence["operator"]).toBe("felix");
    expect(last?.evidence["reason"]).toBe("OWNER_ABORT");
    // Both passes are in the record, separately: a reader a week later can tell a world
    // that was already safe from one a racing invocation had re-armed in between.
    expect((last?.evidence["actions"] as readonly unknown[]).length).toBe(4);
    expect((last?.evidence["confirming"] as readonly unknown[]).length).toBe(3);
  });

  it("writes the stop mark before it touches the world, so a racing invocation can see it", async () => {
    const stateRoot = await root();
    const order: string[] = [];
    const { deps } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 16, 0), {
      writeStopMark: async (targetRoot: string, mark: StopMark) => { order.push("mark"); await writeStopMark(targetRoot, mark); },
      print: (line: string) => order.push(line),
    });

    await invoke(command(["abort", "--confirm", "--state-root", stateRoot, "--operator", "felix"]), deps);

    expect(order[0]).toBe("mark");
    const state = await readStopMark(stateRoot);
    expect(state.kind).toBe("present");
    if (state.kind !== "present") throw new Error("the mark was not written");
    expect(state.mark.operator).toBe("felix");
    expect(state.mark.reason).toBe("OWNER_ABORT");
  });

  it("disarms anyway when the mark cannot be written, and refuses to call that a confirmed stop", async () => {
    const stateRoot = await root();
    const first = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), first.deps);
    const { deps, printed } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 16, 0), {
      writeStopMark: () => Promise.reject(new Error("EROFS: read-only file system")),
    });

    const result = await invoke(command(["abort", "--confirm", "--state-root", stateRoot, "--operator", "felix"]), deps);

    // SC-2: it still disarmed, it said so, and it is not reported as a durable stop.
    expect(printed[0]).toContain("the stop mark could not be written");
    expect(result.applied.map(report => report.kind)).toContain("disable-tasks");
    expect(result.outcome.kind).toBe("work-failed");
    expect(exitCodeFor(result.outcome)).toBe(4);
    expect(pages(result.outcome)).toBe(true);
    if (result.outcome.kind !== "work-failed") throw new Error("the outcome carries the reason");
    expect(result.outcome.reason).toContain("the stop mark could NOT be written");
  });

  it("still tears down when there is no attempt to end, and records that it did", async () => {
    const stateRoot = await root();
    const { deps, printed } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 16, 0));
    const result = await invoke(command(["abort", "--confirm", "--state-root", stateRoot, "--operator", "felix"]), deps);

    // It acted on the world, so it is an abort and not a refusal: exit 2 means "I did not
    // start", and this one did.
    expect(result.outcome.kind).toBe("aborted");
    expect(exitCodeFor(result.outcome)).toBe(1);
    expect(printed[0]).toBe("would disable-tasks cycle, watchdog");
    if (result.outcome.kind !== "aborted") throw new Error("the abort did not report an abort");
    expect(result.outcome.reason).toBe("OWNER_ABORT_NO_ATTEMPT");
    expect(result.outcome.nextOwnerAction).toContain("Check that this is the state root you meant");

    const written = await entries(stateRoot);
    expect(written).toHaveLength(1);
    expect(written[0]?.kind).toBe("note");
    expect(written[0]?.evidence["ownerAbort"]).toBe("NO_ATTEMPT_OPEN");
    expect(written[0]?.evidence["operator"]).toBe("felix");
    expect(written[0]?.evidence["actions"]).toEqual([
      { kind: "disable-tasks", applied: false, reason: "NO_HOST_BINDINGS" },
      { kind: "remove-certificate-line", applied: false, reason: "NO_HOST_BINDINGS" },
      { kind: "delete-disarm", applied: false, reason: "NO_HOST_BINDINGS" },
      { kind: "clear-checks", applied: false, reason: "NO_HOST_BINDINGS" },
    ]);
  });

  // R3-08, as the contract rather than as the defect. What stood here asserted that a
  // repeat appended nothing; what it left out was that the repeat had already applied
  // four actions and pinged three checks, exited 0, did not page, and printed "Nothing
  // was done."
  it("does not end an attempt twice, and still records what the repeat did to the world", async () => {
    const stateRoot = await root();
    const first = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), first.deps);
    const { deps } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 16, 0));
    await invoke(command(["abort", "--confirm", "--state-root", stateRoot, "--operator", "felix"]), deps);
    const after = await entries(stateRoot);

    const second = await invoke(command(["abort", "--confirm", "--state-root", stateRoot, "--operator", "felix"]), deps);

    // The attempt is ended once: the second stop writes a note, never a second abort.
    const written = await entries(stateRoot);
    expect(written).toHaveLength(after.length + 1);
    expect(written.filter(entry => entry.kind === "abort")).toHaveLength(after.filter(entry => entry.kind === "abort").length);
    expect(written.at(-1)?.kind).toBe("note");
    expect(written.at(-1)?.evidence["ownerAbort"]).toBe("ATTEMPT_ALREADY_ENDED");
    expect(written.at(-1)?.evidence["endedAtSeq"]).toBe(after.filter(entry => entry.kind === "abort").at(-1)?.seq);

    // And it is not reported as a no-op: it pages, it does not exit 0, and the line the
    // owner reads names the actions instead of "Nothing was done".
    expect(second.outcome.kind).toBe("aborted");
    expect(exitCodeFor(second.outcome)).toBe(1);
    expect(pages(second.outcome)).toBe(true);
    const lines = outcomeLines(second.outcome).join(" | ");
    expect(lines).toContain("OWNER_ABORT_REPEAT");
    expect(lines).not.toContain("Nothing was done");
    expect(second.applied.map(report => report.kind)).toContain("clear-checks");
  });

  it("comes back for the lease and records itself when the holder lets go", async () => {
    const stateRoot = await root();
    const first = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), first.deps);
    const before = (await entries(stateRoot)).length;

    // A tick holds the lease for a moment, the way one does while an action is being
    // applied, and lets go. The store answers a live holder with `contended` immediately
    // rather than waiting, so without the bounded rounds the owner's stop would disarm
    // the world and write nothing at all about it.
    let release = (): void => undefined;
    const held = new Promise<void>(resolve => { release = resolve; });
    const holder = withActivationLedger({
      root: stateRoot,
      owner: currentLedgerLockOwner(),
      makeSystemDraft: () => { throw new Error("the holder writes no system draft in this test"); },
    }, async () => { await held; return 1; });
    await new Promise(resolve => { setTimeout(resolve, 50); });
    setTimeout(() => { release(); }, 1_200);

    const { deps } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 16, 0));
    const result = await invoke(command(["abort", "--confirm", "--state-root", stateRoot, "--operator", "felix"]), deps);
    await holder;

    expect(result.outcome.kind).toBe("aborted");
    const written = await entries(stateRoot);
    expect(written.length).toBeGreaterThan(before);
    expect(written.at(-1)?.kind).toBe("abort");
    expect(written.at(-1)?.evidence["reason"]).toBe("OWNER_ABORT");
  }, 20_000);

  it("reports a stop it could neither confirm nor record when another invocation holds the lease", async () => {
    const stateRoot = await root();
    const first = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), first.deps);

    let release = (): void => undefined;
    const held = new Promise<void>(resolve => { release = resolve; });
    const holder = withActivationLedger({
      root: stateRoot,
      owner: currentLedgerLockOwner(),
      makeSystemDraft: () => { throw new Error("the holder writes no system draft in this test"); },
    }, async () => { await held; return 1; });
    await new Promise(resolve => { setTimeout(resolve, 50); });

    const result = await invoke(
      command(["abort", "--confirm", "--state-root", stateRoot, "--operator", "felix"]),
      harness(stateRoot, utcOf(CERTIFICATE_DAY, 16, 0), { withLedger: (options, work) => withActivationLedger({ ...options, contentionTimeoutMs: 100 }, work) }).deps,
    );
    release();
    await holder;

    // SC-4: it disarmed, and it says plainly that nothing confirmed or recorded it.
    expect(result.outcome.kind).toBe("work-failed");
    expect(exitCodeFor(result.outcome)).toBe(4);
    if (result.outcome.kind !== "work-failed") throw new Error("the outcome carries the reason");
    expect(result.outcome.reason).toContain("neither confirmed under the lease nor recorded");
    expect(result.outcome.teardown?.map(report => report.kind)).toContain("disable-tasks");
    // The mark stands even so, which is the half of the stop that does not need the lease.
    expect((await readStopMark(stateRoot)).kind).toBe("present");
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

// SC-3 and SC-8, against the real mark on the real disk: the harness binds no stop ports,
// so every read below goes through `readStopMark` to the file the abort wrote.
describe("what a standing stop does to every later invocation", () => {
  async function stopped(stateRoot: string): Promise<void> {
    const { deps } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 16, 0));
    await invoke(command(["abort", "--confirm", "--state-root", stateRoot, "--operator", "felix"]), deps);
  }

  it("refuses an arming action and names the stop, instead of applying it", async () => {
    const stateRoot = await root();
    await stopped(stateRoot);

    const printed: string[] = [];
    const reports = await applyAll(
      [{ kind: "enable-tasks", tasks: ["cycle", "watchdog"] }],
      {
        ports: null,
        context: { envFile: path.join(stateRoot, ".env"), repoRoot: stateRoot, activationRoot: stateRoot, anchorDay: ANCHOR, nodePath: "", taskUserId: "", taskUserSid: "", platform: process.platform },
        dryRun: false,
        print: line => printed.push(line),
        stopAtFirstFailure: true,
        readStop: () => readStopMark(stateRoot),
      },
    );

    expect(reports[0]?.applied).toBe(false);
    expect(reports[0]?.reason).toContain("STOPPED_BY_OWNER");
    // Not NO_HOST_BINDINGS: the stop is asked first, so the reason an operator reads is
    // the one that decided, not the one that would have decided next.
    expect(reports[0]?.reason).not.toContain("NO_HOST_BINDINGS");
    expect(printed[0]).toContain("refusing enable-tasks");
  });

  it("keeps refusing while the mark is merely unreadable, because absence has to be established", async () => {
    const stateRoot = await root();
    const reports = await applyAll(
      [{ kind: "enable-tasks", tasks: ["cycle", "watchdog"] }],
      {
        ports: null,
        context: { envFile: path.join(stateRoot, ".env"), repoRoot: stateRoot, activationRoot: stateRoot, anchorDay: ANCHOR, nodePath: "", taskUserId: "", taskUserSid: "", platform: process.platform },
        dryRun: false,
        print: () => undefined,
        stopAtFirstFailure: true,
        readStop: () => Promise.resolve({ kind: "unreadable" as const, reason: "stop.json: EACCES" }),
      },
    );

    expect(reports[0]?.reason).toContain("STOP_MARK_UNREADABLE");
  });

  it("is read again before every single action, so an invocation that decided earlier cannot arm later", async () => {
    const stateRoot = await root();
    let reads = 0;
    const reports = await applyAll(
      [{ kind: "disable-tasks", tasks: ["cycle"] }, { kind: "enable-tasks", tasks: ["cycle"] }, { kind: "delete-disarm" }],
      {
        ports: null,
        context: { envFile: path.join(stateRoot, ".env"), repoRoot: stateRoot, activationRoot: stateRoot, anchorDay: ANCHOR, nodePath: "", taskUserId: "", taskUserSid: "", platform: process.platform },
        dryRun: false,
        print: () => undefined,
        stopAtFirstFailure: false,
        // The stop lands between the first action and the second — the shape of R2-03.
        readStop: () => {
          reads += 1;
          return Promise.resolve(reads === 1 ? { kind: "absent" as const } : { kind: "present" as const, mark: { id: "stop-1", operator: "felix", at: "2026-09-21T22:31:00+02:00", atUtcMs: 1, reason: "OWNER_ABORT" } });
        },
      },
    );

    expect(reads).toBe(3);
    expect(reports[0]?.reason).toBe("NO_HOST_BINDINGS");
    expect(reports[1]?.reason).toContain("STOPPED_BY_OWNER");
    // The third is a disarming action and is let through although the stop now stands.
    expect(reports[2]?.reason).toBe("NO_HOST_BINDINGS");
  });

  it("is not lifted by a tick that opens a new anchor day", async () => {
    const stateRoot = await root();
    const first = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), first.deps);
    await stopped(stateRoot);

    const nextDay = harness(stateRoot, utcOf("2026-09-23", 15, 35));
    await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", "2026-09-23"]), nextDay.deps);

    expect((await readStopMark(stateRoot)).kind).toBe("present");
  });

  it("is lifted by the owner's own continuation, and by nothing else", async () => {
    const stateRoot = await root();
    const first = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), first.deps);
    await stopped(stateRoot);
    expect((await readStopMark(stateRoot)).kind).toBe("present");

    const { deps, printed } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 16, 30));
    const result = await invoke(command(["open", "--state-root", stateRoot, "--anchor-day", ANCHOR, "--operator", "felix"]), deps);

    expect(result.outcome.kind).toBe("opened");
    expect((await readStopMark(stateRoot)).kind).toBe("absent");
    expect(printed.join(" ")).toContain("stop mark was lifted");
    // The opening names the stop it was authorised to lift, and it is written before the
    // lift, so a failed append can no longer leave the mark gone and the record empty.
    const opening = (await entries(stateRoot)).at(-1);
    expect(opening?.evidence["opened"]).toBe("OWNER_OPENED");
    expect(String(opening?.evidence["liftsStop"])).toMatch(/^stop-\d+-[0-9a-f]{8}$/u);
  });

  it("is what status says first, because it changes what every line after it means", async () => {
    const stateRoot = await root();
    await stopped(stateRoot);

    const { deps, printed } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 16, 10));
    await invoke(command(["status", "--state-root", stateRoot]), deps);

    expect(printed[0]).toContain("STOPPED");
    expect(printed[0]).toContain("felix");
  });
});

// R4-01 and R4-02, from the owner-commissioned review of 2026-09-19, as contract rather
// than as defect. Both were executed against the previous commit before they were booked:
// an older continuation erased a newer stop and the concurrent abort still reported "the
// stop is confirmed"; and an opening whose append failed left the mark gone with nothing
// on the record.
describe("a stop has an identity, and a continuation may lift only the one it read", () => {
  async function stoppedWithAttempt(stateRoot: string): Promise<void> {
    const first = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), first.deps);
    const { deps } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 16, 0));
    await invoke(command(["abort", "--confirm", "--state-root", stateRoot, "--operator", "felix"]), deps);
  }

  it("leaves a newer stop standing when one is typed while the continuation works", async () => {
    const stateRoot = await root();
    await stoppedWithAttempt(stateRoot);
    const older = await readStopMark(stateRoot);
    if (older.kind !== "present") throw new Error("the first stop did not land");

    // The interleaving the review executed, made deterministic: the newer stop lands in
    // the instant between the continuation's read and its compare-and-delete.
    const { deps, printed } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 16, 30), {
      clearStopMark: async (targetRoot: string, expectedId: string) => {
        await writeStopMark(targetRoot, { id: "stop-newer-1", operator: "felix", at: "2026-09-21T16:29:00+02:00", atUtcMs: utcOf(CERTIFICATE_DAY, 16, 29), reason: "OWNER_ABORT" });
        return await clearStopMark(targetRoot, expectedId);
      },
    });
    const result = await invoke(command(["open", "--state-root", stateRoot, "--anchor-day", ANCHOR, "--operator", "felix"]), deps);

    // The attempt is open — that part the owner asked for — and the newer stop survived.
    expect(result.outcome.kind).toBe("opened");
    const standing = await readStopMark(stateRoot);
    expect(standing.kind).toBe("present");
    if (standing.kind !== "present") throw new Error("the newer stop was erased");
    expect(standing.mark.id).toBe("stop-newer-1");

    // And it is not silent: the console says it, the ledger says it, and a recovery file
    // beside the mark says it for whoever looks at the state root first.
    expect(printed.join(" ")).toContain("NOT lifted");
    const last = (await entries(stateRoot)).at(-1);
    expect(last?.evidence["stopLift"]).toBe("superseded");
    expect(last?.nextOwnerAction).toContain("run `open` again");
    expect(await readFile(path.join(stateRoot, "stop.json.lift-failed"), "utf8")).toContain("superseded");
  });

  it("leaves the stop standing when the opening itself cannot be recorded", async () => {
    const stateRoot = await root();
    await stoppedWithAttempt(stateRoot);
    const before = await readStopMark(stateRoot);
    if (before.kind !== "present") throw new Error("the stop did not land");

    const failingOpen: typeof withActivationLedger = (options, work) => withActivationLedger(options, async session => await work({
      read: () => session.read(),
      append: async draft => {
        if (draft.evidence["opened"] === "OWNER_OPENED") throw new LedgerStoreError("write-ledger", "NO_SPACE");
        return await session.append(draft);
      },
    }));
    const { deps } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 16, 30), { withLedger: failingOpen });
    const result = await invoke(command(["open", "--state-root", stateRoot, "--anchor-day", ANCHOR, "--operator", "felix"]), deps);

    expect(result.outcome.kind).toBe("ledger-defect");
    // The old order lifted the stop first, so this exact case left the deployment armable
    // with no continuation on the record. The mark outlives a failed opening now.
    const after = await readStopMark(stateRoot);
    expect(after.kind).toBe("present");
    if (after.kind !== "present") throw new Error("the stop was lifted by a failed opening");
    expect(after.mark.id).toBe(before.mark.id);
  });

  it("refuses to call a stop confirmed when its own mark did not survive it", async () => {
    const stateRoot = await root();
    const first = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), first.deps);

    // Something lifted the mark while the stop was working — which is what the review
    // executed, and what the previous version reported as "the stop is confirmed".
    const { deps, printed } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 16, 0), {
      readStopMark: () => Promise.resolve({ kind: "absent" as const }),
    });
    const result = await invoke(command(["abort", "--confirm", "--state-root", stateRoot, "--operator", "felix"]), deps);

    expect(result.outcome.kind).toBe("work-failed");
    expect(exitCodeFor(result.outcome)).toBe(4);
    if (result.outcome.kind !== "work-failed") throw new Error("the outcome carries the reason");
    expect(result.outcome.reason).toContain("gone again");
    expect(printed.join(" ")).toContain("WARNING");
  });
});

// R4-03: SC-7 was true at one exit and claimed at all of them.
describe("every exit after effects carries what those effects were", () => {
  it("carries the opening run's teardown out of a failed note append", async () => {
    const stateRoot = await root();
    const failingOpening: typeof withActivationLedger = (options, work) => withActivationLedger(options, async session => await work({
      read: () => session.read(),
      append: async draft => {
        if (typeof draft.evidence["opened"] === "string") throw new LedgerStoreError("write-ledger", "NO_SPACE");
        return await session.append(draft);
      },
    }));
    const { deps } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35), { withLedger: failingOpening });

    const result = await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), deps);

    // The branch applies a full teardown before it appends. Measured before this fix:
    // `teardown: []` and `applied: []` while the ports had really disabled both tasks.
    expect(result.outcome.kind).toBe("ledger-defect");
    if (result.outcome.kind !== "ledger-defect") throw new Error("the outcome carries the teardown");
    expect(result.outcome.teardown?.map(report => report.kind)).toEqual(["disable-tasks", "remove-certificate-line"]);
    expect(result.applied.map(report => report.kind)).toContain("disable-tasks");
    expect(outcomeLines(result.outcome).join(" | ")).toContain("disable-tasks");
  });
});

// Two mechanisms an independent gate could remove on 2026-09-20 while the whole suite
// stayed green. A mechanism no test can kill is a mechanism nobody is holding.
describe("the stop's own failure reporting, where the suite was silent", () => {
  it("carries the teardown out of a store failure on the stop's own path", async () => {
    const stateRoot = await root();
    const first = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), first.deps);

    // The shapes the store really throws, at each stage it can fail at. The `run` path had
    // this covered; the command the contract is actually about did not.
    for (const stage of ["write-ledger", "sync-ledger", "close-ledger", "release-lock"] as const) {
      const failing: typeof withActivationLedger = (options, work) => withActivationLedger(options, async session => {
        await work({ read: () => session.read(), append: () => { throw new LedgerStoreError(stage, "IO_ERROR"); } });
        throw new LedgerStoreError(stage, "IO_ERROR");
      });
      const { deps } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 16, 0), { withLedger: failing });

      const result = await invoke(command(["abort", "--confirm", "--state-root", stateRoot, "--operator", "felix"]), deps);

      expect(["ledger-defect", "work-failed"]).toContain(result.outcome.kind);
      const carried = result.outcome.kind === "ledger-defect" || result.outcome.kind === "work-failed" ? result.outcome.teardown ?? [] : [];
      expect(carried.map(report => report.kind)).toContain("disable-tasks");
      expect(outcomeLines(result.outcome).join(" | ")).toContain("disable-tasks");
      expect(exitCodeFor(result.outcome)).not.toBe(0);
    }
  }, 30_000);

  it("does not swallow a mark it could not write, even where the read-back would notice", async () => {
    const stateRoot = await root();
    const first = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), first.deps);

    // The write fails and the mark is absent afterwards — but the point of this case is
    // the *first* mechanism, not the read-back: the failure must reach the verdict from
    // the catch that saw it. A mutation that set `markFailure = null` there used to leave
    // the whole suite green, because the read-back happened to catch the same state.
    const printed: string[] = [];
    const { deps } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 16, 0), {
      writeStopMark: () => Promise.reject(new Error("EROFS: read-only file system")),
      // The read-back says a mark stands, so only the write failure can decide.
      readStopMark: () => Promise.resolve({ kind: "present" as const, mark: { id: "stop-elsewhere", operator: "felix", at: "x", atUtcMs: 1, reason: "OWNER_ABORT" } }),
      print: line => printed.push(line),
    });

    const result = await invoke(command(["abort", "--confirm", "--state-root", stateRoot, "--operator", "felix"]), deps);

    expect(result.outcome.kind).toBe("work-failed");
    if (result.outcome.kind !== "work-failed") throw new Error("the outcome carries the reason");
    expect(result.outcome.reason).toContain("could NOT be written");
    expect(printed.join(" ")).toContain("read-only file system");
  }, 30_000);

  it("does not report success when it opened an attempt and could not lift the stop", async () => {
    const stateRoot = await root();
    const first = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), first.deps);
    const { deps: stopDeps } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 16, 0));
    await invoke(command(["abort", "--confirm", "--state-root", stateRoot, "--operator", "felix"]), stopDeps);

    const { deps } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 16, 30), {
      clearStopMark: () => Promise.resolve({ kind: "locked" as const, reason: "another invocation holds the stop mark's lock" }),
    });
    const result = await invoke(command(["open", "--state-root", stateRoot, "--anchor-day", ANCHOR, "--operator", "felix"]), deps);

    // The attempt is open and nothing will arm. A task history that shows only the exit
    // code may not read that as success.
    expect(result.outcome.kind).toBe("opened");
    expect(exitCodeFor(result.outcome)).toBe(4);
    expect(pages(result.outcome)).toBe(true);
    expect(outcomeLines(result.outcome).join(" | ")).toContain("NOT lifted");
  }, 30_000);
});

// SC-8a's gap, measured by a gate on 2026-09-20: an unreadable mark made the one command
// that lifts a stop refuse outright, while every arming action refused because the mark
// stood. The deployment could neither arm nor be released, and no output named the way
// out. This is also the upgrade path: a `stop.json` written before the mark had an id
// reads as unreadable to this code.
describe("a mark nobody can read is not a deployment nobody can release", () => {
  it("leaves the unreadable stop standing when the opening cannot be recorded", async () => {
    const stateRoot = await root();
    const first = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), first.deps);
    await writeFile(path.join(stateRoot, "stop.json"), JSON.stringify({ operator: "felix", at: "2026-09-21T22:31:00+02:00", atUtcMs: 1, reason: "OWNER_ABORT" }), "utf8");

    let quarantineCalls = 0;
    const failingOpen: typeof withActivationLedger = (options, work) => withActivationLedger(options, async session => await work({
      read: () => session.read(),
      append: async draft => {
        if (draft.evidence["opened"] === "OWNER_OPENED") throw new LedgerStoreError("write-ledger", "NO_SPACE");
        return await session.append(draft);
      },
    }));
    const { deps } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 16, 30), {
      withLedger: failingOpen,
      quarantineStopMark: async targetRoot => {
        quarantineCalls += 1;
        return await quarantineStopMark(targetRoot);
      },
    });

    const result = await invoke(command(["open", "--state-root", stateRoot, "--anchor-day", ANCHOR, "--operator", "felix"]), deps);

    expect(result.outcome.kind).toBe("ledger-defect");
    expect(quarantineCalls).toBe(0);
    expect((await readStopMark(stateRoot)).kind).toBe("unreadable");
  });

  it("does not quarantine a newer readable stop written while OWNER_OPENED becomes durable", async () => {
    const stateRoot = await root();
    const first = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), first.deps);
    await writeFile(path.join(stateRoot, "stop.json"), JSON.stringify({ operator: "felix", at: "2026-09-21T22:31:00+02:00", atUtcMs: 1, reason: "OWNER_ABORT" }), "utf8");

    const replacement: StopMark = { id: "stop-typed-during-open", operator: "felix", at: "2026-09-21T16:29:00+02:00", atUtcMs: utcOf(CERTIFICATE_DAY, 16, 29), reason: "OWNER_ABORT" };
    const interleavedOpen: typeof withActivationLedger = (options, work) => withActivationLedger(options, async session => await work({
      read: () => session.read(),
      append: async draft => {
        const appended = await session.append(draft);
        if (draft.evidence["opened"] === "OWNER_OPENED") await writeStopMark(stateRoot, replacement);
        return appended;
      },
    }));
    const { deps } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 16, 30), { withLedger: interleavedOpen });

    const result = await invoke(command(["open", "--state-root", stateRoot, "--anchor-day", ANCHOR, "--operator", "felix"]), deps);

    const standing = await readStopMark(stateRoot);
    expect(standing.kind).toBe("present");
    if (standing.kind !== "present") throw new Error("the newer stop was quarantined");
    expect(standing.mark.id).toBe(replacement.id);
    expect(result.outcome.kind).toBe("opened");
    if (result.outcome.kind !== "opened") throw new Error("the opening outcome carries the stop state");
    expect(result.outcome.stopStanding).toBe("present");
  });

  it("sets it aside, opens the attempt, and says where the bytes went", async () => {
    const stateRoot = await root();
    const first = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), first.deps);
    // The exact shape the previous version wrote: no id at all.
    await writeFile(path.join(stateRoot, "stop.json"), JSON.stringify({ operator: "felix", at: "2026-09-21T22:31:00+02:00", atUtcMs: 1, reason: "OWNER_ABORT" }), "utf8");
    expect((await readStopMark(stateRoot)).kind).toBe("unreadable");

    const { deps, printed } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 16, 30));
    const result = await invoke(command(["open", "--state-root", stateRoot, "--anchor-day", ANCHOR, "--operator", "felix"]), deps);

    expect(result.outcome.kind).toBe("opened");
    expect(exitCodeFor(result.outcome)).toBe(0);
    expect((await readStopMark(stateRoot)).kind).toBe("absent");
    expect(printed.join(" ")).toContain("preserved as");
    const recorded = await entries(stateRoot);
    const opening = recorded.find(entry => entry.evidence["opened"] === "OWNER_OPENED");
    expect(opening?.evidence["unreadableStopMark"]).toBeTruthy();
    const quarantine = recorded.find(entry => typeof entry.evidence["quarantinedUnreadableMark"] === "string");
    expect(String(quarantine?.evidence["quarantinedUnreadableMark"])).toContain("unreadable-");
    // The bytes survive, because they are the only evidence of whatever wrote them.
    const aside = String(quarantine?.evidence["quarantinedUnreadableMark"]);
    expect(await readFile(aside, "utf8")).toContain("OWNER_ABORT");
  });

  it("reports the quarantine effect when its follow-up ledger note cannot be written", async () => {
    const stateRoot = await root();
    const first = harness(stateRoot, utcOf(CERTIFICATE_DAY, 15, 35));
    await invoke(command(["run", "--state-root", stateRoot, "--anchor-day", ANCHOR]), first.deps);
    await writeFile(path.join(stateRoot, "stop.json"), JSON.stringify({ operator: "felix", at: "2026-09-21T22:31:00+02:00", atUtcMs: 1, reason: "OWNER_ABORT" }), "utf8");

    const failingNote: typeof withActivationLedger = (options, work) => withActivationLedger(options, async session => await work({
      read: () => session.read(),
      append: async draft => {
        if (draft.evidence["quarantine"] === "quarantined") throw new LedgerStoreError("write-ledger", "NO_SPACE");
        return await session.append(draft);
      },
    }));
    const { deps } = harness(stateRoot, utcOf(CERTIFICATE_DAY, 16, 30), { withLedger: failingNote });

    const result = await invoke(command(["open", "--state-root", stateRoot, "--anchor-day", ANCHOR, "--operator", "felix"]), deps);

    expect(result.outcome.kind).toBe("ledger-defect");
    if (result.outcome.kind !== "ledger-defect") throw new Error("the failed note was not classified as a ledger defect");
    expect(result.outcome.effects?.join(" | ")).toContain("unreadable stop preserved at");
    expect(outcomeLines(result.outcome).join(" | ")).toContain("effect before the ledger failed");
    expect((await readStopMark(stateRoot)).kind).toBe("absent");
  });
});
