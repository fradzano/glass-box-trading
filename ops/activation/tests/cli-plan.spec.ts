// What one invocation writes, and how it ends (unit 10). Three properties carry the
// weight here: a restart must not write its own result, a repeated wait must not bury the
// evidence under identical lines, and the store's `callback` / `WORK_FAILED` must never be
// read as a defect in the ledger — that last one is review residual G2, closed on
// 2026-09-16 before this code existed, so it is pinned from both sides.
import { describe, expect, it } from "vitest";
import {
  abortDraft,
  classifyStoreFailure,
  exitCodeFor,
  intentDraft,
  monotonicStamp,
  nextAttemptId,
  observationPlanFor,
  openingDraft,
  ownerAbortDraft,
  pages,
  recordDraft,
  resultDraft,
  systemDraftFactory,
  waitNoteDraft,
} from "../cli/plan.ts";
import type { ActionReport, InvocationOutcome, Stamp } from "../cli/plan.ts";
import { foldLedger, foldLedgerSnapshot } from "../core/fold.ts";
import { parseLedgerText, planLedgerAppend } from "../core/ledger.ts";
import type { LedgerDraft, LedgerTail } from "../core/ledger.ts";
import type { Decision, LedgerEntry, StepId } from "../core/types.ts";

const ANCHOR = "2026-09-22";
const ATTEMPT = "2026-09-22.1";
const BASE_MS = 1_790_000_000_000;

function stampAt(utcMs: number): Stamp {
  return { at: new Date(utcMs + 2 * 60 * 60 * 1_000).toISOString().replace("Z", "+02:00"), atUtcMs: utcMs };
}

const STAMP = stampAt(BASE_MS);

type Line = Pick<LedgerDraft, "attempt" | "anchorDay" | "kind"> & Partial<LedgerDraft>;

function ledgerText(lines: readonly Line[]): string {
  let text = "";
  let tail: LedgerTail = { lastSeq: 0, lastAtUtcMs: null };
  let clock = BASE_MS - 3_600_000;
  for (const line of lines) {
    clock += 60_000;
    const planned = planLedgerAppend(tail, { ...stampAt(clock), step: null, outcome: null, evidence: {}, nextOwnerAction: null, ...line });
    if (!planned.ok) throw new Error(planned.reason);
    text += planned.line;
    tail = { lastSeq: planned.entry.seq, lastAtUtcMs: planned.entry.atUtcMs };
  }
  return text;
}

function foldOf(lines: readonly Line[]) {
  return foldLedger(parseLedgerText(ledgerText(lines)));
}

function done(step: StepId): readonly Line[] {
  return [
    { attempt: ATTEMPT, anchorDay: ANCHOR, kind: "intent", step },
    { attempt: ATTEMPT, anchorDay: ANCHOR, kind: "result", step, outcome: "ok" },
  ];
}

/** Every draft this module produces must be a line the codec accepts; otherwise it is a refusal at append time. */
function accepted(draft: LedgerDraft): LedgerEntry {
  const planned = planLedgerAppend({ lastSeq: 7, lastAtUtcMs: BASE_MS - 1_000 }, draft);
  if (!planned.ok) throw new Error(planned.reason);
  return planned.entry;
}

describe("the observation plan of one invocation", () => {
  it("takes the preflight while the attempt is still before the certificate", () => {
    expect(observationPlanFor(foldOf([{ attempt: ATTEMPT, anchorDay: ANCHOR, kind: "note" }])))
      .toEqual({ preflight: true, analystProbe: true, devAccount: false });
  });

  it("spends the live-token probe at step 0 and at the gate, and nowhere else", () => {
    const beforeStep1 = foldOf([...done("0-preflight")]);
    expect(observationPlanFor(beforeStep1)).toEqual({ preflight: true, analystProbe: false, devAccount: false });

    const beforeGate = foldOf([
      ...done("0-preflight"), ...done("1-install"), ...done("2-certificate"), ...done("3-flat"),
      ...done("4-enable"), ...done("5a-watchdog-disable"), ...done("5b-watchdog-down"), ...done("5c-watchdog-reenable"),
      ...done("5d-watchdog-up"), ...done("6a-silence-disable"), ...done("6b-silence-down"), ...done("6c-silence-clear"),
      ...done("8-reboot"), ...done("7-rearm"), ...done("9-proof"),
    ]);
    expect(observationPlanFor(beforeGate)).toEqual({ preflight: true, analystProbe: true, devAccount: false });
  });

  it("reads the dev account's book only at step 3", () => {
    const beforeFlat = foldOf([...done("0-preflight"), ...done("1-install"), ...done("2-certificate")]);
    expect(observationPlanFor(beforeFlat)).toEqual({ preflight: true, analystProbe: false, devAccount: true });
  });

  it("keeps taking the preflight after step 2, because the core compares digests from then on", () => {
    const afterFlat = foldOf([...done("0-preflight"), ...done("1-install"), ...done("2-certificate"), ...done("3-flat")]);
    expect(observationPlanFor(afterFlat).preflight).toBe(true);
  });
});

describe("an act writes its intent and then its result", () => {
  const decision: Extract<Decision, { kind: "act" }> = {
    kind: "act",
    step: "4-enable",
    actions: [{ kind: "enable-tasks", tasks: ["cycle", "watchdog"] }, { kind: "register-disarm", at: { date: ANCHOR, minute: 905 } }],
    evidence: { window: "22:05-22:20" },
  };

  function report(kind: ActionReport["kind"], applied: boolean, extra: Partial<ActionReport> = {}): ActionReport {
    return { kind, applied, detail: applied ? {} : null, reason: applied ? null : "TASK_NOT_FOUND", completion: applied ? "record-result" : null, ...extra };
  }

  it("names the actions it is about to apply in the intent", () => {
    const entry = accepted(intentDraft(decision, ATTEMPT, ANCHOR, STAMP));
    expect(entry.kind).toBe("intent");
    expect(entry.step).toBe("4-enable");
    expect(entry.outcome).toBeNull();
    expect(entry.evidence["actions"]).toEqual(["enable-tasks", "register-disarm"]);
    expect(entry.evidence["window"]).toBe("22:05-22:20");
  });

  it("closes ok when every action applied", () => {
    const drafted = resultDraft(decision, [report("enable-tasks", true), report("register-disarm", true)], ATTEMPT, ANCHOR, STAMP);
    expect(drafted).not.toBeNull();
    const entry = accepted(drafted as LedgerDraft);
    expect(entry.outcome).toBe("ok");
    expect(entry.evidence["actions"]).toEqual([
      { kind: "enable-tasks", applied: true, detail: {} },
      { kind: "register-disarm", applied: true, detail: {} },
    ]);
  });

  it("closes failed when an action did not apply, and carries its credential-free reason", () => {
    const drafted = resultDraft(decision, [report("enable-tasks", true), report("register-disarm", false)], ATTEMPT, ANCHOR, STAMP);
    const entry = accepted(drafted as LedgerDraft);
    expect(entry.outcome).toBe("failed");
    expect(entry.evidence["actions"]).toEqual([
      { kind: "enable-tasks", applied: true, detail: {} },
      { kind: "register-disarm", applied: false, reason: "TASK_NOT_FOUND" },
    ]);
  });

  it("closes failed when the run stopped at the first failure and never reported the rest", () => {
    const drafted = resultDraft(decision, [report("enable-tasks", false)], ATTEMPT, ANCHOR, STAMP);
    expect((drafted as LedgerDraft).outcome).toBe("failed");
  });

  it("reports fewer actions than were decided as a failure, never as a complete step", () => {
    // `applyAll` stops at the first failure, so a short report list is itself the
    // evidence that the step did not finish — counting only what came back would read
    // an interrupted run as a clean one.
    const drafted = resultDraft(decision, [report("enable-tasks", true)], ATTEMPT, ANCHOR, STAMP);
    expect((drafted as LedgerDraft).outcome).toBe("failed");
  });

  it("still writes a result when a restart applied but a later action failed", () => {
    const both: Extract<Decision, { kind: "act" }> = {
      kind: "act",
      step: "8-reboot",
      actions: [{ kind: "restart" }, { kind: "enable-tasks", tasks: ["cycle"] }],
      evidence: {},
    };
    const drafted = resultDraft(both, [report("restart", true, { completion: "await-post-boot" }), report("enable-tasks", false)], ATTEMPT, ANCHOR, STAMP);
    expect(drafted).not.toBeNull();
    expect((drafted as LedgerDraft).outcome).toBe("failed");
  });

  it("writes no result at all for a restart, which the machine is about to interrupt", () => {
    const restart: Extract<Decision, { kind: "act" }> = { kind: "act", step: "8-reboot", actions: [{ kind: "restart" }], evidence: {} };
    expect(resultDraft(restart, [report("restart", true, { completion: "await-post-boot" })], ATTEMPT, ANCHOR, STAMP)).toBeNull();
  });

  it("does write a result when the restart itself failed, because nothing is going down", () => {
    const restart: Extract<Decision, { kind: "act" }> = { kind: "act", step: "8-reboot", actions: [{ kind: "restart" }], evidence: {} };
    const drafted = resultDraft(restart, [report("restart", false)], ATTEMPT, ANCHOR, STAMP);
    expect((drafted as LedgerDraft).outcome).toBe("failed");
  });
});

describe("the other decisions", () => {
  it("records an outcome without touching anything", () => {
    const entry = accepted(recordDraft({ kind: "record", step: "9-proof", outcome: "already_in_target_state", evidence: { firing: "14:02" } }, ATTEMPT, ANCHOR, STAMP));
    expect(entry.kind).toBe("result");
    expect(entry.outcome).toBe("already_in_target_state");
  });

  it("ends the attempt with an abort that always names the owner's next action", () => {
    const entry = accepted(abortDraft({ kind: "abort", step: "10-gate", reason: "WORLD_MISMATCH", teardown: true, nextOwnerAction: "Read the gate evidence.", evidence: { red: ["tasks.cycle"] } }, ATTEMPT, ANCHOR, STAMP));
    expect(entry.kind).toBe("abort");
    expect(entry.nextOwnerAction).toBe("Read the gate evidence.");
    expect(entry.evidence["reason"]).toBe("WORLD_MISMATCH");
    expect(entry.evidence["teardown"]).toBe(true);
  });

  it("writes the owner's own abort as a deliberate stop, not as a crash", () => {
    const entry = accepted(ownerAbortDraft("felix", ATTEMPT, ANCHOR, STAMP, { disabled: ["cycle", "watchdog"] }));
    expect(entry.kind).toBe("abort");
    expect(entry.step).toBeNull();
    expect(entry.evidence["reason"]).toBe("OWNER_ABORT");
    expect(entry.evidence["operator"]).toBe("felix");
    expect(entry.nextOwnerAction).toContain("open a new attempt");
  });

  it("notes a wait the first time its reason appears", () => {
    const fold = foldOf([{ attempt: ATTEMPT, anchorDay: ANCHOR, kind: "note" }]);
    const drafted = waitNoteDraft("STEP_4_WINDOW_NOT_OPEN", fold, ATTEMPT, ANCHOR, STAMP);
    expect((drafted as LedgerDraft).evidence).toEqual({ waiting: "STEP_4_WINDOW_NOT_OPEN" });
  });

  it("stays silent while the same reason repeats, so five-minute ticks do not bury the evidence", () => {
    const fold = foldOf([{ attempt: ATTEMPT, anchorDay: ANCHOR, kind: "note", evidence: { waiting: "STEP_4_WINDOW_NOT_OPEN" } }]);
    expect(waitNoteDraft("STEP_4_WINDOW_NOT_OPEN", fold, ATTEMPT, ANCHOR, STAMP)).toBeNull();
  });

  it("speaks again as soon as the reason changes", () => {
    const fold = foldOf([{ attempt: ATTEMPT, anchorDay: ANCHOR, kind: "note", evidence: { waiting: "STEP_4_WINDOW_NOT_OPEN" } }]);
    expect(waitNoteDraft("STEP_5_AWAITING_FIRING", fold, ATTEMPT, ANCHOR, STAMP)).not.toBeNull();
  });

  it("opens an attempt with a first entry that says what was found", () => {
    const entry = accepted(openingDraft("LEDGER_EMPTY", ATTEMPT, ANCHOR, STAMP, { tasksDisabled: true }));
    expect(entry.kind).toBe("note");
    expect(entry.evidence["opened"]).toBe("LEDGER_EMPTY");
    expect(entry.evidence["tasksDisabled"]).toBe(true);
  });
});

describe("attempt ids", () => {
  it("numbers the first attempt of an anchor day", () => {
    expect(nextAttemptId([], ANCHOR)).toBe("2026-09-22.1");
  });

  it("counts the attempts that day has already seen, and ignores other days", () => {
    const entries = foldLedgerSnapshot({
      state: "intact",
      entries: parseLedgerText(ledgerText([
        { attempt: "2026-09-15.1", anchorDay: "2026-09-15", kind: "note" },
        { attempt: ATTEMPT, anchorDay: ANCHOR, kind: "note" },
        { attempt: ATTEMPT, anchorDay: ANCHOR, kind: "abort", nextOwnerAction: "Retry." },
      ])).entries,
      corrupt: [],
    });
    expect(entries.currentAttempt?.id).toBe(ATTEMPT);
    const all = parseLedgerText(ledgerText([
      { attempt: "2026-09-15.1", anchorDay: "2026-09-15", kind: "note" },
      { attempt: ATTEMPT, anchorDay: ANCHOR, kind: "note" },
    ])).entries;
    expect(nextAttemptId(all, ANCHOR)).toBe("2026-09-22.2");
    expect(nextAttemptId(all, "2026-09-29")).toBe("2026-09-29.1");
  });

  it("produces an id the codec accepts as an attempt", () => {
    expect(accepted(openingDraft("LEDGER_EMPTY", nextAttemptId([], ANCHOR), ANCHOR, STAMP)).attempt).toBe("2026-09-22.1");
  });
});

describe("a stamp the ledger will accept", () => {
  it("keeps its own moment when the clock runs forwards", () => {
    expect(monotonicStamp(STAMP, { lastSeq: 3, lastAtUtcMs: BASE_MS - 1 }, stampAt)).toEqual(STAMP);
  });

  it("borrows the tail's moment when the clock ran backwards, instead of writing a refused line", () => {
    expect(monotonicStamp(STAMP, { lastSeq: 3, lastAtUtcMs: BASE_MS + 5_000 }, stampAt)).toEqual(stampAt(BASE_MS + 5_000));
  });

  it("accepts equality, which the codec does too", () => {
    expect(monotonicStamp(STAMP, { lastSeq: 3, lastAtUtcMs: BASE_MS }, stampAt)).toEqual(STAMP);
  });

  it("has nothing to compare against on an empty ledger", () => {
    expect(monotonicStamp(STAMP, { lastSeq: 0, lastAtUtcMs: null }, stampAt)).toEqual(STAMP);
  });
});

describe("the store's system events as ledger lines", () => {
  const make = systemDraftFactory({ nowUtcMs: BASE_MS, stampAt, attempt: ATTEMPT, anchorDay: ANCHOR });
  const tail: LedgerTail = { lastSeq: 4, lastAtUtcMs: BASE_MS - 1_000 };
  const owner = { pid: 4321, startedAtUtcMs: BASE_MS - 60_000 };
  const contender = { pid: 8765, startedAtUtcMs: BASE_MS - 30_000 };

  it("writes a live competitor's note with the event's fields verbatim", () => {
    const drafted = make({ kind: "live-lock", owner, contender, claimId: "live-8765-1" }, tail, null);
    expect(drafted.kind).toBe("note");
    expect(drafted.step).toBeNull();
    expect(drafted.outcome).toBeNull();
    expect(drafted.evidence).toEqual({ kind: "live-lock", owner, contender, claimId: "live-8765-1" });
    expect(accepted(drafted).attempt).toBe(ATTEMPT);
  });

  it("writes a stale lock's note with the event's fields verbatim", () => {
    const drafted = make({ kind: "stale-lock", owner }, tail, null);
    expect(drafted.evidence).toEqual({ kind: "stale-lock", owner });
  });

  it("writes a torn tail as a correction that names the damaged seq", () => {
    const drafted = make({ kind: "torn-tail", segment: 1, damagedSeq: 12 }, { lastSeq: 11, lastAtUtcMs: BASE_MS - 1_000 }, null);
    expect(drafted.kind).toBe("correction");
    expect(drafted.evidence).toEqual({ kind: "torn-tail", segment: 1, damagedSeq: 12, correctedSeq: 12 });
    const planned = planLedgerAppend({ lastSeq: 11, lastAtUtcMs: BASE_MS - 1_000 }, drafted);
    expect(planned.ok).toBe(true);
  });

  it("takes the attempt the store supplies, not its own, so a system line never splits an attempt", () => {
    const drafted = make({ kind: "stale-lock", owner }, tail, { attempt: "2026-09-15.3", anchorDay: "2026-09-15" });
    expect(drafted.attempt).toBe("2026-09-15.3");
    expect(drafted.anchorDay).toBe("2026-09-15");
  });

  it("stamps monotonically against the tail it is given", () => {
    const drafted = make({ kind: "stale-lock", owner }, { lastSeq: 4, lastAtUtcMs: BASE_MS + 90_000 }, null);
    expect(drafted.atUtcMs).toBe(BASE_MS + 90_000);
  });
});

describe("how an invocation ends", () => {
  const cases: readonly { outcome: InvocationOutcome; code: number; pages: boolean }[] = [
    { outcome: { kind: "acted", step: "4-enable", outcome: "ok", deferred: false }, code: 0, pages: false },
    { outcome: { kind: "acted", step: "4-enable", outcome: "failed", deferred: false }, code: 1, pages: false },
    { outcome: { kind: "recorded", step: "9-proof", outcome: "ok" }, code: 0, pages: false },
    { outcome: { kind: "waited", reason: "NOT_DUE", noted: false }, code: 0, pages: false },
    { outcome: { kind: "opened", attempt: ATTEMPT, found: "LEDGER_EMPTY" }, code: 0, pages: false },
    { outcome: { kind: "ended", seq: 21, reason: "ended" }, code: 0, pages: false },
    { outcome: { kind: "done", reason: "complete" }, code: 0, pages: false },
    { outcome: { kind: "yielded", reason: "a live invocation holds the lease" }, code: 0, pages: false },
    { outcome: { kind: "reported" }, code: 0, pages: false },
    { outcome: { kind: "aborted", step: "10-gate", reason: "WORLD_MISMATCH", teardown: true, nextOwnerAction: "Read it." }, code: 1, pages: true },
    { outcome: { kind: "refused", reason: "--state-root is required" }, code: 2, pages: false },
    { outcome: { kind: "ledger-defect", stage: "write-ledger", reason: "NO_SPACE" }, code: 3, pages: true },
    { outcome: { kind: "work-failed", reason: "the invocation failed inside the ledger lease" }, code: 4, pages: true },
  ];

  it("maps every outcome to its own exit code", () => {
    for (const item of cases) expect({ kind: item.outcome.kind, code: exitCodeFor(item.outcome) }).toEqual({ kind: item.outcome.kind, code: item.code });
  });

  it("pages exactly on an abort, a ledger defect and its own failure", () => {
    for (const item of cases) expect({ kind: item.outcome.kind, pages: pages(item.outcome) }).toEqual({ kind: item.outcome.kind, pages: item.pages });
  });
});

describe("a failure that came back out of the ledger lease (review residual G2)", () => {
  it("reads the CLI's own failure as the CLI's, not as a defect in the record", () => {
    expect(classifyStoreFailure("callback", "WORK_FAILED").kind).toBe("work-failed");
    expect(exitCodeFor(classifyStoreFailure("callback", "WORK_FAILED"))).toBe(4);
  });

  it("reads a store failure raised inside the callback as a ledger defect, because it kept its own stage", () => {
    const outcome = classifyStoreFailure("write-ledger", "NO_SPACE");
    expect(outcome).toEqual({ kind: "ledger-defect", stage: "write-ledger", reason: "NO_SPACE" });
    expect(exitCodeFor(outcome)).toBe(3);
  });

  it("reads every other stage as a ledger defect too", () => {
    for (const stage of ["acquire-lock", "read-lock", "read-ledger", "encode-ledger", "release-lock", "read-directory", "takeover-lock"]) {
      expect(classifyStoreFailure(stage, "IO_ERROR").kind).toBe("ledger-defect");
    }
  });

  it("does not let a different reason on the callback stage pass as the CLI's own", () => {
    expect(classifyStoreFailure("callback", "SOMETHING_ELSE").kind).toBe("ledger-defect");
  });
});
