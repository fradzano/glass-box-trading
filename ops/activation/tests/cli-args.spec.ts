// The activation CLI's command line (unit 10). The interesting cases are not the happy
// ones: a flag typed after the wrong command, an anchor day that is not a day, and the
// two commands that must not be invocable by accident — `abort`, which ends the attempt,
// and `disarm`, whose argument vector a scheduled task carries verbatim.
import { describe, expect, it } from "vitest";
import { isCalendarDay, parseInvocation } from "../cli/args.ts";
import type { ActivationInvocation } from "../cli/args.ts";

const ROOT = "C:\\Users\\felix\\glass-box-state\\activation-1";

function accepted(argv: readonly string[]): ActivationInvocation {
  const parsed = parseInvocation(argv);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.invocation;
}

function refusal(argv: readonly string[]): string {
  const parsed = parseInvocation(argv);
  if (parsed.ok) throw new Error(`expected a refusal, got ${parsed.invocation.command}`);
  return parsed.reason;
}

describe("the activation command line", () => {
  it("reads the run the scheduled task invokes", () => {
    expect(accepted(["run", "--state-root", ROOT, "--anchor-day", "2026-09-22"])).toEqual({
      command: "run",
      stateRoot: ROOT,
      anchorDay: "2026-09-22",
      operator: null,
      dryRun: false,
    });
  });

  it("reads the disarm vector that disarmFindings pins by value", () => {
    expect(accepted(["disarm", "--state-root", ROOT, "--anchor-day", "2026-09-22"])).toEqual({
      command: "disarm",
      stateRoot: ROOT,
      anchorDay: "2026-09-22",
      operator: null,
      dryRun: false,
    });
  });

  it("reads the owner's retry, which names both the day and the person", () => {
    expect(accepted(["open", "--state-root", ROOT, "--anchor-day", "2026-09-29", "--operator", "felix"])).toEqual({
      command: "open",
      stateRoot: ROOT,
      anchorDay: "2026-09-29",
      operator: "felix",
      dryRun: false,
    });
  });

  it("refuses an open without an operator: a new attempt is a decision with a name on it", () => {
    expect(refusal(["open", "--state-root", ROOT, "--anchor-day", "2026-09-29"]))
      .toBe("--operator is required for open: a new attempt after an abort is a decision with a name on it");
    expect(refusal(["open", "--state-root", ROOT, "--anchor-day", "2026-09-29", "--operator", " "]))
      .toBe("--operator is required for open: a new attempt after an abort is a decision with a name on it");
    expect(refusal(["open", "--state-root", ROOT, "--operator", "felix"]))
      .toBe("--anchor-day is required for open");
  });

  it("reads status without an anchor day, because it only reports what the ledger says", () => {
    expect(accepted(["status", "--state-root", ROOT])).toEqual({
      command: "status",
      stateRoot: ROOT,
      anchorDay: null,
      operator: null,
      dryRun: false,
    });
  });

  it("reads the owner's abort with the operator it will name in the terminal entry", () => {
    expect(accepted(["abort", "--confirm", "--state-root", ROOT, "--operator", "felix"])).toEqual({
      command: "abort",
      stateRoot: ROOT,
      anchorDay: null,
      operator: "felix",
      dryRun: false,
    });
  });

  it("takes --dry-run on the commands that would touch the world", () => {
    expect(accepted(["run", "--state-root", ROOT, "--anchor-day", "2026-09-22", "--dry-run"]).dryRun).toBe(true);
    expect(accepted(["disarm", "--state-root", ROOT, "--anchor-day", "2026-09-22", "--dry-run"]).dryRun).toBe(true);
  });

  it("refuses --dry-run on status, which never touches anything to begin with", () => {
    expect(refusal(["status", "--state-root", ROOT, "--dry-run"])).toBe("status does not accept --dry-run");
  });
});

describe("the command line refuses rather than defaults", () => {
  it("refuses an empty command line", () => {
    expect(refusal([])).toBe("give a command: status, run, open, abort --confirm, or disarm");
  });

  it("refuses a flag where the command belongs", () => {
    expect(refusal(["--state-root", ROOT])).toBe("the first argument must be a command, not --state-root");
  });

  it("refuses an unknown command", () => {
    expect(refusal(["armed", "--state-root", ROOT])).toBe("unknown command armed");
  });

  it("refuses a flag that belongs to another command", () => {
    expect(refusal(["run", "--state-root", ROOT, "--anchor-day", "2026-09-22", "--operator", "felix"]))
      .toBe("run does not accept --operator");
    expect(refusal(["disarm", "--state-root", ROOT, "--anchor-day", "2026-09-22", "--confirm"]))
      .toBe("disarm does not accept --confirm");
  });

  it("refuses a repeated flag instead of letting the last one win", () => {
    expect(refusal(["run", "--state-root", ROOT, "--anchor-day", "2026-09-22", "--state-root", "D:\\elsewhere"]))
      .toBe("--state-root is given twice");
  });

  it("refuses a flag whose value is missing or is the next flag", () => {
    expect(refusal(["run", "--state-root", ROOT, "--anchor-day"])).toBe("--anchor-day needs a value");
    expect(refusal(["run", "--state-root", "--anchor-day", "2026-09-22"])).toBe("--state-root needs a value");
  });

  it("refuses a bare word that follows no flag", () => {
    expect(refusal(["status", "--state-root", ROOT, "please"])).toBe("unexpected argument please");
  });

  it("requires --state-root on every command", () => {
    expect(refusal(["status"])).toBe("--state-root is required");
    expect(refusal(["run", "--anchor-day", "2026-09-22"])).toBe("--state-root is required");
  });

  it("requires an anchor day for run and disarm, and only for those", () => {
    expect(refusal(["run", "--state-root", ROOT])).toBe("--anchor-day is required for run");
    expect(refusal(["disarm", "--state-root", ROOT])).toBe("--anchor-day is required for disarm");
    expect(refusal(["status", "--state-root", ROOT, "--anchor-day", "2026-09-22"]))
      .toBe("status does not accept --anchor-day");
  });

  it("refuses an abort without --confirm, and without an operator", () => {
    expect(refusal(["abort", "--state-root", ROOT, "--operator", "felix"]))
      .toBe("abort needs --confirm: it disables both tasks and ends the attempt");
    expect(refusal(["abort", "--confirm", "--state-root", ROOT]))
      .toBe("--operator is required for abort: the terminal entry names who stopped the run");
    expect(refusal(["abort", "--confirm", "--state-root", ROOT, "--operator", "   "]))
      .toBe("--operator is required for abort: the terminal entry names who stopped the run");
  });
});

describe("an anchor day is a calendar day", () => {
  it("refuses a day that does not exist", () => {
    expect(refusal(["run", "--state-root", ROOT, "--anchor-day", "2026-09-31"]))
      .toBe("--anchor-day must be a calendar day as YYYY-MM-DD, not 2026-09-31");
    expect(refusal(["run", "--state-root", ROOT, "--anchor-day", "2026-02-30"]))
      .toBe("--anchor-day must be a calendar day as YYYY-MM-DD, not 2026-02-30");
    expect(refusal(["run", "--state-root", ROOT, "--anchor-day", "2026-13-01"]))
      .toBe("--anchor-day must be a calendar day as YYYY-MM-DD, not 2026-13-01");
  });

  it("refuses a shape the core would compare as a string and never match", () => {
    for (const bad of ["2026-9-22", "22.09.2026", "2026-09-22T00:00:00+02:00", "2026-09-2x", " 2026-09-22"]) {
      expect(refusal(["run", "--state-root", ROOT, "--anchor-day", bad]))
        .toBe(`--anchor-day must be a calendar day as YYYY-MM-DD, not ${bad}`);
    }
  });

  it("knows the leap years the drills could fall into", () => {
    expect(isCalendarDay("2028-02-29")).toBe(true);
    expect(isCalendarDay("2026-02-29")).toBe(false);
    expect(isCalendarDay("2100-02-29")).toBe(false);
    expect(isCalendarDay("2000-02-29")).toBe(true);
  });

  it("accepts every month's last day", () => {
    const lasts = ["2026-01-31", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30", "2026-10-31", "2026-11-30", "2026-12-31"];
    for (const day of lasts) expect(isCalendarDay(day)).toBe(true);
    for (const day of ["2026-04-31", "2026-06-31", "2026-09-31", "2026-11-31"]) expect(isCalendarDay(day)).toBe(false);
  });
});
