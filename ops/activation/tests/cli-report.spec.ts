// What the owner reads (unit 10). This is the only part of the activation that talks to
// a person, and it is read at 22:00 by someone who last looked at this ledger a week ago:
// a step that is silently left out reads as "fine", and an ended attempt that is not
// named reads as a running one.
import { describe, expect, it } from "vitest";
import { outcomeLines, statusLines } from "../cli/report.ts";
import type { InvocationOutcome } from "../cli/plan.ts";
import { foldLedger } from "../core/fold.ts";
import { parseLedgerText, planLedgerAppend } from "../core/ledger.ts";
import type { LedgerDraft, LedgerTail } from "../core/ledger.ts";
import type { Schedule } from "../core/types.ts";

const ANCHOR = "2026-09-22";
const ATTEMPT = "2026-09-22.1";
const BASE_MS = 1_790_000_000_000;

const SCHEDULE: Schedule = {
  certificateDay: "2026-09-21",
  drillNightDay: ANCHOR,
  anchorDay: ANCHOR,
  gateNotAfterUtcMs: BASE_MS,
  longRunAccountMasked: "PA3L…U97",
  coverageThroughDate: "2026-12-16",
  expectedHostPreconditions: { HiberbootEnabled: "0" },
  minFreeDiskBytes: 10_000_000_000,
  repoRoot: "C:\\repo",
  activationRoot: "C:\\state",
};

type Line = Pick<LedgerDraft, "attempt" | "anchorDay" | "kind"> & Partial<LedgerDraft>;

function foldOf(lines: readonly Line[]) {
  let text = "";
  let tail: LedgerTail = { lastSeq: 0, lastAtUtcMs: null };
  let clock = BASE_MS - 3_600_000;
  for (const line of lines) {
    clock += 60_000;
    const planned = planLedgerAppend(tail, {
      at: new Date(clock + 2 * 60 * 60 * 1_000).toISOString().replace("Z", "+02:00"),
      atUtcMs: clock,
      step: null,
      outcome: null,
      evidence: {},
      nextOwnerAction: null,
      ...line,
    });
    if (!planned.ok) throw new Error(planned.reason);
    text += planned.line;
    tail = { lastSeq: planned.entry.seq, lastAtUtcMs: planned.entry.atUtcMs };
  }
  return foldLedger(parseLedgerText(text));
}

describe("the status page", () => {
  it("says there is no attempt rather than printing an empty page", () => {
    expect(statusLines(foldOf([]), null)).toEqual(["ledger      intact (empty)", "attempt     none open"]);
  });

  it("names the attempt, its anchor day and every step that has run", () => {
    const lines = statusLines(foldOf([
      { attempt: ATTEMPT, anchorDay: ANCHOR, kind: "note" },
      { attempt: ATTEMPT, anchorDay: ANCHOR, kind: "intent", step: "0-preflight" },
      { attempt: ATTEMPT, anchorDay: ANCHOR, kind: "result", step: "0-preflight", outcome: "ok" },
    ]), SCHEDULE);

    expect(lines[1]).toContain(`attempt     ${ATTEMPT} for anchor day ${ANCHOR}`);
    expect(lines.some(line => line.includes("0-preflight") && line.includes("ok"))).toBe(true);
    expect(lines.at(-1)).toBe("next        1-install, valid from the start of the attempt until 2026-09-21 22:40");
  });

  it("prints both bounds of a window that has an opening time", () => {
    const lines = statusLines(foldOf([
      { attempt: ATTEMPT, anchorDay: ANCHOR, kind: "note" },
      { attempt: ATTEMPT, anchorDay: ANCHOR, kind: "intent", step: "0-preflight" },
      { attempt: ATTEMPT, anchorDay: ANCHOR, kind: "result", step: "0-preflight", outcome: "ok" },
      { attempt: ATTEMPT, anchorDay: ANCHOR, kind: "intent", step: "1-install" },
      { attempt: ATTEMPT, anchorDay: ANCHOR, kind: "result", step: "1-install", outcome: "ok" },
    ]), SCHEDULE);

    expect(lines.at(-1)).toBe("next        2-certificate, valid from 2026-09-21 15:35 until 2026-09-21 22:40");
  });

  it("says loudly that the attempt is over, because a later tick will do nothing", () => {
    const lines = statusLines(foldOf([
      { attempt: ATTEMPT, anchorDay: ANCHOR, kind: "note" },
      { attempt: ATTEMPT, anchorDay: ANCHOR, kind: "abort", nextOwnerAction: "Read the ledger." },
    ]), SCHEDULE);

    expect(lines.some(line => line.startsWith("ENDED"))).toBe(true);
  });

  it("names an interrupted step instead of leaving its intent to be noticed", () => {
    const lines = statusLines(foldOf([
      { attempt: ATTEMPT, anchorDay: ANCHOR, kind: "note" },
      { attempt: ATTEMPT, anchorDay: ANCHOR, kind: "intent", step: "0-preflight" },
    ]), SCHEDULE);

    expect(lines.some(line => line.startsWith("INTERRUPTED 0-preflight"))).toBe(true);
    expect(lines.some(line => line.includes("0-preflight") && line.includes("no result yet"))).toBe(true);
  });

  it("prints the next step without a window when it has no schedule to place it in", () => {
    const lines = statusLines(foldOf([{ attempt: ATTEMPT, anchorDay: ANCHOR, kind: "note" }]), null);
    expect(lines.at(-1)).toBe("next        0-preflight");
  });
});

describe("what one invocation reports", () => {
  it("gives an abort its reason, its teardown and the owner's next action, in that order", () => {
    const outcome: InvocationOutcome = { kind: "aborted", step: "10-gate", reason: "WORLD_MISMATCH", teardown: true, nextOwnerAction: "Read the gate evidence." };
    expect(outcomeLines(outcome)).toEqual([
      "ABORTED at 10-gate: WORLD_MISMATCH",
      "both tasks are disabled and the certificate line is unset",
      "next owner action: Read the gate evidence.",
    ]);
  });

  it("says when an armed run was deliberately left standing", () => {
    const outcome: InvocationOutcome = { kind: "aborted", step: "11-anchor", reason: "ANCHOR_MISSING", teardown: false, nextOwnerAction: "Decide whether to tear down." };
    expect(outcomeLines(outcome)[1]).toBe("the armed run was left as it is; tearing it down is the owner's decision");
  });

  it("separates a defect in the record from the CLI's own failure", () => {
    expect(outcomeLines({ kind: "ledger-defect", stage: "write-ledger", reason: "NO_SPACE" })[0]).toBe("LEDGER DEFECT write-ledger:NO_SPACE");
    expect(outcomeLines({ kind: "work-failed", reason: "it broke" })).toEqual(["FAILED: it broke"]);
  });

  it("says that a restart's result is not this invocation's to write", () => {
    expect(outcomeLines({ kind: "acted", step: "8-reboot", outcome: "ok", deferred: true })[0])
      .toBe("acted on 8-reboot: ok; its result is left for the first invocation after the boot");
  });

  it("prints nothing of its own for status, which has already printed the page", () => {
    expect(outcomeLines({ kind: "reported" })).toEqual([]);
  });
});
