// Spec §4/§5 and review round 5: how the ledger folds into what the current
// attempt has done. The dangerous readings are the ones a retry or a crash would
// produce — yesterday's reboot counted for today, a step read as done because
// its intent was written, an aborted attempt that keeps acting.
import { describe, expect, it } from "vitest";
import { foldLedger, stepDone } from "../core/fold.ts";
import { parseLedgerText, planLedgerAppend } from "../core/ledger.ts";
import type { LedgerDraft } from "../core/ledger.ts";
import type { StepId } from "../core/types.ts";

type Line = Pick<LedgerDraft, "attempt" | "anchorDay" | "kind"> & Partial<LedgerDraft>;

function ledger(lines: readonly Line[]): string {
  let text = "";
  let tail = { lastSeq: 0, lastAtUtcMs: null as number | null };
  let clock = 1_789_990_000_000;
  for (const line of lines) {
    clock += 60_000;
    const draft: LedgerDraft = {
      at: "2026-09-21T15:35:00+02:00",
      atUtcMs: clock,
      step: null,
      outcome: null,
      evidence: {},
      nextOwnerAction: null,
      ...line,
    };
    const planned = planLedgerAppend(tail, draft);
    if (!planned.ok) throw new Error(planned.reason);
    text += planned.line;
    tail = { lastSeq: planned.entry.seq, lastAtUtcMs: planned.entry.atUtcMs };
  }
  return text;
}

function ok(attempt: string, anchorDay: string, step: StepId): readonly Line[] {
  return [
    { attempt, anchorDay, kind: "intent", step },
    { attempt, anchorDay, kind: "result", step, outcome: "ok" },
  ];
}

const MON = "2026-09-22";
const NEXT = "2026-09-29";

describe("activation fold — attempts and their steps", () => {
  it("reads an empty ledger as empty, with no attempt", () => {
    const fold = foldLedger(parseLedgerText(""));
    expect(fold.empty).toBe(true);
    expect(fold.currentAttempt).toBeNull();
    expect(fold.integrity).toBe("intact");
  });

  it("carries steps 0 to 3 into a new attempt, and nothing after them", () => {
    const text = ledger([
      ...ok("a1", MON, "0-preflight"), ...ok("a1", MON, "1-install"), ...ok("a1", MON, "2-certificate"), ...ok("a1", MON, "3-flat"),
      ...ok("a1", MON, "4-enable"), ...ok("a1", MON, "8-reboot"), ...ok("a1", MON, "9-proof"),
      { attempt: "a1", anchorDay: MON, kind: "abort", step: "10-gate", nextOwnerAction: "Retry next week." },
      { attempt: "a2", anchorDay: NEXT, kind: "note" },
    ]);
    const fold = foldLedger(parseLedgerText(text));
    expect(fold.currentAttempt).toEqual({ id: "a2", anchorDay: NEXT, firstSeq: 16 });
    for (const step of ["0-preflight", "1-install", "2-certificate", "3-flat"] as const) expect(stepDone(fold, step)).toBe(true);
    // Round 5, A2: yesterday's reboot proof does not count for the new anchor day.
    for (const step of ["4-enable", "8-reboot", "9-proof"] as const) expect(stepDone(fold, step)).toBe(false);
    expect(fold.attemptEnded).toBeNull();
  });

  it("ends an attempt at its first abort, and tells an owner's abort apart", () => {
    const byStep = foldLedger(parseLedgerText(ledger([
      ...ok("a1", MON, "0-preflight"),
      { attempt: "a1", anchorDay: MON, kind: "abort", step: "2-certificate", nextOwnerAction: "The certificate failed; a new run is needed." },
      { attempt: "a1", anchorDay: MON, kind: "note" },
    ])));
    expect(byStep.attemptEnded).toEqual({ seq: 3, step: "2-certificate", byOwner: false });

    const byOwner = foldLedger(parseLedgerText(ledger([
      ...ok("a1", MON, "0-preflight"),
      { attempt: "a1", anchorDay: MON, kind: "abort", step: null, nextOwnerAction: "Stopped by the owner.", evidence: { operator: "felix" } },
    ])));
    expect(byOwner.attemptEnded).toEqual({ seq: 3, step: null, byOwner: true });
  });

  it("does not let an abort in an earlier attempt end the current one", () => {
    const fold = foldLedger(parseLedgerText(ledger([
      { attempt: "a1", anchorDay: MON, kind: "abort", step: "2-certificate", nextOwnerAction: "Retry." },
      ...ok("a2", NEXT, "0-preflight"),
    ])));
    expect(fold.attemptEnded).toBeNull();
  });

  it("reads an intent without a result as interrupted, never as done", () => {
    const fold = foldLedger(parseLedgerText(ledger([
      ...ok("a1", MON, "6c-silence-clear"),
      { attempt: "a1", anchorDay: MON, kind: "intent", step: "8-reboot" },
    ])));
    expect(stepDone(fold, "8-reboot")).toBe(false);
    expect(fold.interrupted?.step).toBe("8-reboot");
    expect(fold.interrupted?.intentSeq).toBe(3);
  });

  it("closes an interrupted step when its result is appended later, as the first invocation after a boot does", () => {
    const fold = foldLedger(parseLedgerText(ledger([
      { attempt: "a1", anchorDay: MON, kind: "intent", step: "8-reboot" },
      { attempt: "a1", anchorDay: MON, kind: "observation" },
      { attempt: "a1", anchorDay: MON, kind: "result", step: "8-reboot", outcome: "ok", evidence: { bootUtcMs: 1 } },
    ])));
    expect(stepDone(fold, "8-reboot")).toBe(true);
    expect(fold.interrupted).toBeNull();
    expect(fold.steps["8-reboot"]?.resultEvidence).toEqual({ bootUtcMs: 1 });
  });

  it("reads a re-run intent after a result as open again", () => {
    const fold = foldLedger(parseLedgerText(ledger([
      ...ok("a1", MON, "5b-watchdog-down"),
      { attempt: "a1", anchorDay: MON, kind: "intent", step: "5b-watchdog-down" },
    ])));
    expect(stepDone(fold, "5b-watchdog-down")).toBe(false);
    expect(fold.interrupted?.step).toBe("5b-watchdog-down");
  });

  it("lets the latest result of a carried-over step win, including a failure", () => {
    const fold = foldLedger(parseLedgerText(ledger([
      ...ok("a1", MON, "2-certificate"),
      { attempt: "a2", anchorDay: NEXT, kind: "intent", step: "2-certificate" },
      { attempt: "a2", anchorDay: NEXT, kind: "result", step: "2-certificate", outcome: "failed" },
    ])));
    expect(stepDone(fold, "2-certificate")).toBe(false);
    expect(fold.steps["2-certificate"]?.outcome).toBe("failed");
  });

  it("does not count an unknown outcome as done, and counts already-in-target-state as done", () => {
    const fold = foldLedger(parseLedgerText(ledger([
      { attempt: "a1", anchorDay: MON, kind: "result", step: "4-enable", outcome: "unknown" },
      { attempt: "a1", anchorDay: MON, kind: "result", step: "1-install", outcome: "already_in_target_state" },
    ])));
    expect(stepDone(fold, "4-enable")).toBe(false);
    expect(stepDone(fold, "1-install")).toBe(true);
  });
});

describe("activation fold — shapes that make the phase ambiguous", () => {
  it("flags an attempt that reappears after another one started", () => {
    const fold = foldLedger(parseLedgerText(ledger([
      { attempt: "a1", anchorDay: MON, kind: "note" },
      { attempt: "a2", anchorDay: NEXT, kind: "note" },
      { attempt: "a1", anchorDay: MON, kind: "note" },
    ])));
    expect(fold.inconsistencies).toEqual(["ATTEMPT_INTERLEAVED:a1@3"]);
  });

  it("flags an attempt whose anchor day changes", () => {
    const fold = foldLedger(parseLedgerText(ledger([
      { attempt: "a1", anchorDay: MON, kind: "note" },
      { attempt: "a1", anchorDay: NEXT, kind: "note" },
    ])));
    expect(fold.inconsistencies).toEqual(["ATTEMPT_ANCHOR_DAY_CHANGED:a1@2"]);
  });

  it("collects the seq values that corrections name, and passes a torn tail through as integrity", () => {
    const text = ledger([
      { attempt: "a1", anchorDay: MON, kind: "note" },
      { attempt: "a1", anchorDay: MON, kind: "correction", evidence: { corrects: 7 } },
    ]);
    const fold = foldLedger(parseLedgerText(`${text}{"seq":3,"at`));
    expect(fold.corrections).toEqual([7]);
    expect(fold.integrity).toBe("torn");
  });
});
