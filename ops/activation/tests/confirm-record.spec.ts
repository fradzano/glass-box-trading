// The pure half of `activation confirm-alerts` (owner ruling and review, 2026-09-14): the
// command line the owner types, and the line the command would append. The round trip
// matters most — a line this module writes must read back through the step-0 parser and
// pass the same cross-check there, or the confirmation would be written and then refused.
import { describe, expect, it } from "vitest";
import { parseConfirmArgs, buildConfirmation } from "../confirm/record.ts";
import type { ConfirmArgs } from "../confirm/record.ts";
import { crossCheckAlerts } from "../core/confirmation.ts";
import type { CheckFlip, CheckName, Reading } from "../core/types.ts";
import type { CheckSummary } from "../readers/parse-healthchecks.ts";
import { parseAlertConfirmations } from "../readers/parse.ts";

const BASE = ["--operator", "felix", "--state-root", "C:\\Users\\felix\\glass-box-state\\activation-1", "--reminder", "2026-09-12T00:58:00+02:00", "--reminder-lists", "liveness,readiness,watchdog"];

function argsOf(argv: readonly string[]): ConfirmArgs {
  const parsed = parseConfirmArgs(argv);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.args;
}

describe("confirm-alerts — the command line", () => {
  it("reads one bundled alert mail as the same receipt for all three checks", () => {
    expect(argsOf([...BASE, "--alert", "2026-09-11T22:02:00+02:00"])).toEqual({
      operator: "felix",
      stateRoot: "C:\\Users\\felix\\glass-box-state\\activation-1",
      alertReceivedAt: { liveness: "2026-09-11T22:02:00+02:00", readiness: "2026-09-11T22:02:00+02:00", watchdog: "2026-09-11T22:02:00+02:00" },
      bundledAlert: true,
      reminderReceivedAt: "2026-09-12T00:58:00+02:00",
      reminderListed: ["liveness", "readiness", "watchdog"],
      dryRun: false,
    });
  });

  it("reads one alert mail per check, and the dry-run switch", () => {
    const args = argsOf([...BASE, "--alert-liveness", "2026-09-11T22:02:00+02:00", "--alert-readiness", "2026-09-11T22:03:00+02:00", "--alert-watchdog", "2026-09-11T22:02:30+02:00", "--dry-run"]);
    expect(args).toMatchObject({ bundledAlert: false, dryRun: true, alertReceivedAt: { readiness: "2026-09-11T22:03:00+02:00" } });
  });

  const refused: readonly (readonly [string, readonly string[]])[] = [
    ["both alert forms at once", [...BASE, "--alert", "2026-09-11T22:02:00+02:00", "--alert-watchdog", "2026-09-11T22:02:00+02:00"]],
    ["per-check alerts for two checks only", [...BASE, "--alert-liveness", "2026-09-11T22:02:00+02:00", "--alert-readiness", "2026-09-11T22:02:00+02:00"]],
    ["no alert at all", BASE],
    ["an alert time without a zone", [...BASE, "--alert", "2026-09-11T22:02:00"]],
    ["a reminder time without a zone", ["--operator", "felix", "--state-root", "x", "--reminder", "12.09.2026 00:58", "--reminder-lists", "liveness,readiness,watchdog", "--alert", "2026-09-11T22:02:00+02:00"]],
    ["a reminder list naming something that is not a check", ["--operator", "felix", "--state-root", "x", "--reminder", "2026-09-12T00:58:00+02:00", "--reminder-lists", "liveness,all", "--alert", "2026-09-11T22:02:00+02:00"]],
    ["a check listed twice", ["--operator", "felix", "--state-root", "x", "--reminder", "2026-09-12T00:58:00+02:00", "--reminder-lists", "liveness,liveness", "--alert", "2026-09-11T22:02:00+02:00"]],
    ["no operator", ["--state-root", "x", "--reminder", "2026-09-12T00:58:00+02:00", "--reminder-lists", "liveness", "--alert", "2026-09-11T22:02:00+02:00"]],
    ["an unknown argument", [...BASE, "--alert", "2026-09-11T22:02:00+02:00", "--force"]],
    ["a flag without its value", [...BASE, "--alert"]],
    ["a flag given twice", [...BASE, "--alert", "2026-09-11T22:02:00+02:00", "--operator", "someone"]],
  ];
  for (const [name, argv] of refused) {
    it(`refuses ${name}`, () => {
      expect(parseConfirmArgs(argv).ok).toBe(false);
    });
  }
});

describe("confirm-alerts — the line it would write", () => {
  const down = Date.UTC(2026, 8, 11, 20, 1);
  const history: readonly CheckFlip[] = [{ utcMs: Date.UTC(2026, 8, 11, 23, 30, 1), up: true }, { utcMs: down, up: false }];
  const summaries: Reading<Readonly<Record<CheckName, CheckSummary>>> = {
    known: true,
    value: {
      liveness: { fingerprint: "hc:a685fe10", status: "up", lastPingUtcMs: null },
      readiness: { fingerprint: "hc:c4ad5b69", status: "up", lastPingUtcMs: null },
      watchdog: { fingerprint: "hc:b76072aa", status: "up", lastPingUtcMs: null },
    },
  };
  const readable = { known: true as const, value: history };
  const flips = { liveness: readable, readiness: readable, watchdog: readable };
  const args = argsOf([...BASE, "--alert", "2026-09-11T22:02:00+02:00"]);

  it("writes a line that reads back through the step-0 parser and passes the same cross-check there", () => {
    const result = buildConfirmation(args, summaries, flips, "2026-09-14T09:00:00.000Z");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const readBack = parseAlertConfirmations(`${result.line}\n`);
    expect(readBack.known).toBe(true);
    if (!readBack.known || readBack.value === null) throw new Error("line did not read back");
    expect(readBack.value).toMatchObject({ operator: "felix", bundledAlert: true, fingerprints: { liveness: "hc:a685fe10" }, downFlipUtcMs: { liveness: down, readiness: down, watchdog: down } });
    expect(crossCheckAlerts(readBack.value, { liveness: history, readiness: history, watchdog: history })).toMatchObject({ ok: true, oldestReceiptUtcMs: Date.UTC(2026, 8, 11, 20, 2) });
  });

  it("writes nothing when the check list or any check's flips could not be read", () => {
    expect(buildConfirmation(args, { known: false, reason: "HTTP 503" }, flips, "t")).toEqual({ ok: false, reasons: ["checks: HTTP 503"] });
    expect(buildConfirmation(args, summaries, { ...flips, watchdog: { known: false, reason: "HTTP 429" } }, "t")).toEqual({ ok: false, reasons: ["watchdog flips: HTTP 429"] });
  });

  it("writes nothing when the statement does not fit the flip history", () => {
    const tooEarly = argsOf([...BASE, "--alert", "2026-09-11T21:59:00+02:00"]);
    expect(buildConfirmation(tooEarly, summaries, flips, "t")).toMatchObject({ ok: false, reasons: expect.arrayContaining(["liveness.no-down-flip-before-alert"]) as unknown });
    const partialList = argsOf(["--operator", "felix", "--state-root", "x", "--reminder", "2026-09-12T00:58:00+02:00", "--reminder-lists", "liveness,readiness", "--alert", "2026-09-11T22:02:00+02:00"]);
    expect(buildConfirmation(partialList, summaries, flips, "t")).toEqual({ ok: false, reasons: ["reminder.does-not-list:watchdog"] });
  });

  it("writes nothing that is credential-shaped, whatever the API handed back as a fingerprint", () => {
    const leaking: Reading<Readonly<Record<CheckName, CheckSummary>>> = { known: true, value: { ...summaries.value, readiness: { fingerprint: "c4ad5b69-0000-4000-8000-000000000000", status: "up", lastPingUtcMs: null } } };
    expect(buildConfirmation(args, leaking, flips, "t")).toEqual({ ok: false, reasons: ["the line would carry a credential-shaped value"] });
  });
});
