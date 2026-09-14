// Spec §5–§7, revision 6: the decision one invocation takes. Every test builds a
// ledger the way the shell would append it, a world as the readers would report
// it, and asks for one answer. The dangerous answers are the permissive ones — an
// act where the world does not match the phase, a green where a reading was
// unknown, a drill counted whose cause is ambiguous, a proof taken from yesterday
// or from a catch-up firing — so most tests below pin a refusal.
import { describe, expect, it } from "vitest";
import { GATE_CHECK_MAX_AGE_MS, authorizeCertificateWrite, decide, definitionFindings, tokenizeArguments } from "../core/decide.ts";
import { foldLedger, stepDone } from "../core/fold.ts";
import type { LedgerFold } from "../core/fold.ts";
import { parseLedgerText, planLedgerAppend } from "../core/ledger.ts";
import type { LedgerDraft } from "../core/ledger.ts";
import { executionOrder, expectedCertificateLine, expectedTasks } from "../core/steps.ts";
import type { AlertConfirmation, CheckObservation, Decision, DisarmObservation, LocalInstant, LogLine, Observations, Outcome, Reading, Schedule, SessionSample, StepId, TaskObservation } from "../core/types.ts";

const MON = "2026-09-21";
const TUE = "2026-09-22";
const NEXT_MON = "2026-09-28";
const NEXT_TUE = "2026-09-29";
const DAY_MS = 86_400_000;
const HOST = { HiberbootEnabled: "0", DisableAutomaticRestartSignOn: "1" };
const CERT_PATH = "C:\\Users\\felix\\glass-box-state\\dev\\certificate-run-4.json";
const FINGERPRINTS = { liveness: "hc:a685fe10", readiness: "hc:c4ad5b69", watchdog: "hc:b76072aa" };
const REPO = "C:\\Users\\felix\\source\\repos\\glass-box-trading";
const HOST_OPTIONS = "-NoProfile -NonInteractive -ExecutionPolicy Bypass";
const CYCLE_ARGS = `${HOST_OPTIONS} -File "${REPO}\\tools\\cycle-run.ps1" -RepoRoot "${REPO}" -NodePath "C:\\Program Files\\nodejs\\node.exe"`;
const WATCHDOG_ARGS = `${HOST_OPTIONS} -File "${REPO}\\tools\\watchdog-run.ps1" -RepoRoot "${REPO}" -NodePath "C:\\Program Files\\nodejs\\node.exe" -WatchdogIntervalMinutes 10`;
const NODE = "C:\\Program Files\\nodejs\\node.exe";
const POWERSHELL = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const USER_SID = "S-1-5-21-1000";
const ACTIVATION_ROOT = "C:\\Users\\felix\\glass-box-state\\activation-1";

/** A drill history like the one of 2026-09-11: down a minute before the alert, back up two hours later. */
function flipsFor(alertUtcMs: number): CheckObservation["flips"] {
  return [{ utcMs: alertUtcMs - 60_000 + 2 * 3_600_000, up: true }, { utcMs: alertUtcMs - 60_000, up: false }];
}

/** The confirmation `confirm-alerts` would write for that history: one bundled alert, a reminder 90 minutes later listing all three checks. */
function confirmationAt(alertUtcMs: number): AlertConfirmation {
  const down = alertUtcMs - 60_000;
  return {
    operator: "felix",
    alertReceivedUtcMs: { liveness: alertUtcMs, readiness: alertUtcMs, watchdog: alertUtcMs },
    bundledAlert: true,
    reminderReceivedUtcMs: alertUtcMs + 90 * 60_000,
    reminderListed: ["liveness", "readiness", "watchdog"],
    fingerprints: FINGERPRINTS,
    downFlipUtcMs: { liveness: down, readiness: down, watchdog: down },
  };
}

const CONFIRMED_ALERT = utc([MON, 0, 0]) - 2 * DAY_MS;
const CONFIRMED_DOWN = CONFIRMED_ALERT - 60_000;
const DRILL_FLIPS = flipsFor(CONFIRMED_ALERT);

/** The disarm one-shot as unit 8 will register it; tests override one part at a time. */
function disarmFor(anchorDay: string, overrides: Partial<DisarmObservation> = {}): DisarmObservation {
  return {
    registered: true,
    fires: { date: anchorDay, minute: 15 * 60 + 5 },
    state: "Ready",
    actions: [{ execute: NODE, argumentLine: `"${REPO}\\ops\\activation\\cli.ts" disarm --state-root "${ACTIVATION_ROOT}" --anchor-day ${anchorDay}`, workingDirectory: REPO }],
    runLevel: "Highest",
    logonType: "S4U",
    startWhenAvailable: true,
    userId: "DESKTOP-V6EGFDV\\felix",
    userSid: USER_SID,
    ...overrides,
  };
}

const NO_DISARM: DisarmObservation = { registered: false, fires: null, state: null, actions: [], runLevel: null, logonType: null, startWhenAvailable: null, userId: null, userSid: null };

/** The checks of a drill that went down and were never resumed: no up flip can expose a receipt time typed into the future. */
const STILL_DOWN: CheckObservation["flips"] = [{ utcMs: CONFIRMED_DOWN, up: false }];

function scheduleFor(certificateDay: string, anchorDay: string): Schedule {
  return { certificateDay, drillNightDay: anchorDay, anchorDay, longRunAccountMasked: "PA3L…U97", coverageThroughDate: "2026-12-16", expectedHostPreconditions: HOST, minFreeDiskBytes: 10_000_000_000, repoRoot: REPO, activationRoot: ACTIVATION_ROOT };
}
const SCHEDULE = scheduleFor(MON, TUE);

type Clock = readonly [date: string, hour: number, minute: number];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Europe/Berlin in September is UTC+2. */
function utc([date, hour, minute]: Clock, second = 0): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hour - 2, minute, second);
}

function local([date, hour, minute]: Clock): LocalInstant {
  return { date, minute: hour * 60 + minute };
}

function known<T>(value: T): Reading<T> {
  return { known: true, value };
}

function unknown<T>(reason = "unreachable"): Reading<T> {
  return { known: false, reason };
}

// ---------------------------------------------------------------------------
// Ledgers
// ---------------------------------------------------------------------------

interface Line {
  readonly at: Clock;
  readonly second?: number;
  readonly step: StepId | null;
  readonly kind: LedgerDraft["kind"];
  readonly outcome?: Outcome;
  readonly evidence?: Readonly<Record<string, unknown>>;
  readonly attempt?: string;
  readonly anchorDay?: string;
}

function ledgerText(lines: readonly Line[]): string {
  let text = "";
  let tail = { lastSeq: 0, lastAtUtcMs: null as number | null };
  for (const line of lines) {
    const [date, hour, minute] = line.at;
    const second = line.second ?? 0;
    const planned = planLedgerAppend(tail, {
      at: `${date}T${pad(hour)}:${pad(minute)}:${pad(second)}+02:00`,
      atUtcMs: utc(line.at, second),
      attempt: line.attempt ?? "a1",
      anchorDay: line.anchorDay ?? TUE,
      step: line.step,
      kind: line.kind,
      outcome: line.kind === "result" ? (line.outcome ?? "ok") : null,
      evidence: line.evidence ?? {},
      nextOwnerAction: line.kind === "abort" ? "Retry on the next trading day." : null,
    });
    if (!planned.ok) throw new Error(planned.reason);
    text += planned.line;
    tail = { lastSeq: planned.entry.seq, lastAtUtcMs: planned.entry.atUtcMs };
  }
  return text;
}

function foldOf(lines: readonly Line[]): LedgerFold {
  return foldLedger(parseLedgerText(ledgerText(lines)));
}

/** When each step of the happy path ran, and what its result recorded. */
function happy(step: StepId): { readonly at: Clock; readonly evidence: Readonly<Record<string, unknown>> } {
  switch (step) {
    case "0-preflight": return { at: [MON, 15, 30], evidence: { wrapperHashes: { "cycle-run.ps1": "w1", "watchdog-run.ps1": "w2" }, hostPreconditions: HOST } };
    case "1-install": return { at: [MON, 15, 31], evidence: { checkCount: 51 } };
    case "2-certificate": return { at: [MON, 16, 10], evidence: { certificatePath: CERT_PATH, runtimeDigest: "r1", policyDigest: "p1" } };
    case "3-flat": return { at: [MON, 16, 15], evidence: {} };
    case "4-enable": return { at: [MON, 22, 5], evidence: {} };
    case "5a-watchdog-disable": return { at: [MON, 22, 16], evidence: {} };
    case "5b-watchdog-down": return { at: [MON, 22, 45], evidence: {} };
    case "5c-watchdog-reenable": return { at: [MON, 22, 46], evidence: {} };
    case "5d-watchdog-up": return { at: [MON, 22, 50], evidence: {} };
    case "6a-silence-disable": return { at: [MON, 22, 55], evidence: {} };
    case "6b-silence-down": return { at: [TUE, 0, 0], evidence: {} };
    case "6c-silence-clear": return { at: [TUE, 0, 5], evidence: {} };
    case "8-reboot": return { at: [TUE, 13, 30], evidence: { bootUtcMs: utc([TUE, 13, 33]) } };
    case "7-rearm": return { at: [TUE, 13, 50], evidence: {} };
    case "9-proof": return { at: [TUE, 14, 5], evidence: {} };
    case "10-gate": return { at: [TUE, 14, 35], evidence: {} };
    case "11-anchor": return { at: [TUE, 15, 20], evidence: {} };
  }
}

/** An open attempt: the note the CLI writes when it opens one. */
function opened(at: Clock = [MON, 15, 0], attempt = "a1", anchorDay = TUE): Line {
  return { at, step: null, kind: "note", attempt, anchorDay };
}

/** The happy path through `last`, each step as intent and result one second apart (the reboot's result after the boot). */
function linesThrough(last: StepId, evidence: Partial<Record<StepId, Readonly<Record<string, unknown>>>> = {}): Line[] {
  const order = executionOrder();
  const lines: Line[] = [opened()];
  for (const step of order.slice(0, order.indexOf(last) + 1)) {
    const { at, evidence: recorded } = happy(step);
    lines.push({ at, step, kind: "intent" });
    if (step === "8-reboot") lines.push({ at: [TUE, 13, 40], step, kind: "result", evidence: evidence[step] ?? recorded });
    else lines.push({ at, second: 1, step, kind: "result", evidence: evidence[step] ?? recorded });
  }
  return lines;
}

function through(last: StepId): LedgerFold {
  return foldOf(linesThrough(last));
}

function before(step: StepId): LedgerFold {
  const order = executionOrder();
  const index = order.indexOf(step);
  return index === 0 ? foldOf([opened()]) : through(order[index - 1] ?? "0-preflight");
}

// ---------------------------------------------------------------------------
// Worlds
// ---------------------------------------------------------------------------

function task(state: string, argumentLine: string, execute = POWERSHELL): TaskObservation {
  return {
    state,
    userId: "DESKTOP-V6EGFDV\\felix",
    userSid: USER_SID,
    runLevel: "Limited",
    logonType: "S4U",
    startWhenAvailable: true,
    actions: [{ execute, argumentLine, workingDirectory: REPO }],
    execute,
    argumentLine,
  };
}

function check(fingerprint: string, status: string, lastPingUtcMs: number | null, flips: CheckObservation["flips"] = DRILL_FLIPS): CheckObservation {
  return { fingerprint, status, lastPingUtcMs, flips };
}

function logLine(file: string, at: Clock, shape: LogLine["shape"], second = 0): LogLine {
  return { file, utcMs: utc(at, second), local: local(at), shape, composition: null };
}

function sample(at: Clock, interactiveSessions = 0, explorerProcesses = 0): SessionSample {
  return { utcMs: utc(at), local: local(at), interactiveSessions, explorerProcesses };
}

/** A world that matches the phase the fold is in, everything green, at `at`. Tests override what they probe. */
function worldFor(fold: LedgerFold, at: Clock, overrides: Partial<Observations> = {}): Observations {
  const now = utc(at);
  const tasks = expectedTasks(fold);
  const stateOf = (expectation: string): string => (expectation === "enabled" ? "Ready" : "Disabled");
  const disarmed = stepDone(fold, "4-enable") && !stepDone(fold, "10-gate");
  const base: Observations = {
    nowUtcMs: now,
    nowLocal: local(at),
    checksObservedAtUtcMs: now,
    executionBoundary: known({ nodePath: NODE, powerShellPath: POWERSHELL, taskUserId: "DESKTOP-V6EGFDV\\felix", taskUserSid: USER_SID }),
    tasks: known({ cycle: task(stateOf(tasks.cycle), CYCLE_ARGS), watchdog: task(stateOf(tasks.watchdog), WATCHDOG_ARGS) }),
    checks: known({
      liveness: check(FINGERPRINTS.liveness, "up", now - 60_000),
      readiness: check(FINGERPRINTS.readiness, "up", now - 60_000),
      watchdog: check(FINGERPRINTS.watchdog, "up", now - 60_000),
    }),
    apiIndependentRead: known(true),
    env: known({ certificatePath: expectedCertificateLine(fold) === "present" ? CERT_PATH : null, profile: "competition", hash: "e1", duplicateKeys: [], shadowedKeys: [] }),
    resolvedAccountMasked: known("PA3L…U97"),
    deploymentDigests: known({ runtimeDigest: "r1", policyDigest: "p1" }),
    certificate: known({ path: CERT_PATH, verdict: "PASS", digests: { runtimeDigest: "r1", policyDigest: "p1" }, violations: [] }),
    devAccount: known({ positions: 0, nonTerminalOrders: 0 }),
    bootUtcMs: known(utc([TUE, 13, 33])),
    cycleLog: known([]),
    watchdogLog: known([]),
    logFilesSearched: ["cycle-run.log", "cycle-run.log.1"],
    sessionSamples: [],
    wrapperHashes: known({ "cycle-run.ps1": "w1", "watchdog-run.ps1": "w2" }),
    hostPreconditions: known(HOST),
    alertConfirmation: known(confirmationAt(CONFIRMED_ALERT)),
    longRunArtefacts: known(["quarantine"]),
    freeDiskBytes: known(1_000_000_000_000),
    analyst: known({ oauthTokenPresent: true, childStartVerified: true, tokenLive: true, tokenProbeClass: null }),
    schedulerCheck: known({ passed: true, checkCount: 51, failedChecks: 0 }),
    schedulerCheckExpectEnabled: known({ passed: true, checkCount: 53, failedChecks: 0 }),
    disarm: known(disarmed ? disarmFor(TUE) : NO_DISARM),
    bootstrapEntry: known(null),
  };
  return { ...base, ...overrides };
}

function checksWith(now: number, statuses: Partial<Record<"liveness" | "readiness" | "watchdog", CheckObservation>>): Observations["checks"] {
  return known({
    liveness: statuses.liveness ?? check(FINGERPRINTS.liveness, "up", now - 60_000),
    readiness: statuses.readiness ?? check(FINGERPRINTS.readiness, "up", now - 60_000),
    watchdog: statuses.watchdog ?? check(FINGERPRINTS.watchdog, "up", now - 60_000),
  });
}

function abortReason(decision: Decision): string | null {
  return decision.kind === "abort" ? decision.reason : null;
}

function evidenceOf(decision: Decision): Readonly<Record<string, unknown>> {
  return decision.kind === "abort" || decision.kind === "act" || decision.kind === "record" ? decision.evidence : {};
}

// ---------------------------------------------------------------------------

describe("decide — integrity and the attempt", () => {
  it("distinguishes same-spelled Windows principals by SID instead of raw UserId text", () => {
    const candidate = { ...task("Disabled", CYCLE_ARGS), userId: "felix", userSid: "S-1-5-21-other" };
    const boundary = { nodePath: NODE, powerShellPath: POWERSHELL, taskUserId: "felix", taskUserSid: "S-1-5-21-expected" };
    expect(definitionFindings("cycle", candidate, SCHEDULE, boundary)).toContain("cycle.user-sid");
  });

  it("aborts with teardown on a torn ledger, even after the gate: the phase cannot be shown to be armed", () => {
    const fold = foldLedger(parseLedgerText(`${ledgerText(linesThrough("10-gate"))}{"seq":`));
    const decision = decide(fold, worldFor(fold, [TUE, 15, 20]), SCHEDULE);
    expect(decision).toMatchObject({ kind: "abort", step: null, reason: "LEDGER_TORN", teardown: true });
  });

  it("aborts on an attempt whose anchor day changed", () => {
    const fold = foldOf([opened(), { at: [MON, 15, 1], step: null, kind: "note", anchorDay: NEXT_TUE }]);
    expect(decide(fold, worldFor(fold, [MON, 15, 5]), SCHEDULE)).toMatchObject({ kind: "abort", reason: "LEDGER_INCONSISTENT", teardown: true });
  });

  it("aborts with teardown when no attempt is open", () => {
    const fold = foldLedger(parseLedgerText(""));
    expect(decide(fold, worldFor(fold, [MON, 15, 30]), SCHEDULE)).toMatchObject({ kind: "abort", step: null, reason: "LEDGER_EMPTY", teardown: true });
  });

  it("does nothing at all in an ended attempt, although the world would allow the enable (round 5, A3)", () => {
    const fold = foldOf([...linesThrough("3-flat"), { at: [MON, 16, 20], step: "3-flat", kind: "abort" }]);
    expect(decide(fold, worldFor(fold, [MON, 22, 6]), SCHEDULE)).toEqual({ kind: "ended", seq: 10, reason: "attempt a1 ended at seq 10" });
  });

  it("names an owner's abort as such", () => {
    const fold = foldOf([...linesThrough("0-preflight"), { at: [MON, 15, 40], step: null, kind: "abort" }]);
    const decision = decide(fold, worldFor(fold, [MON, 15, 45]), SCHEDULE);
    expect(decision.kind).toBe("ended");
    expect(decision.kind === "ended" ? decision.reason : "").toContain("by the owner");
  });

  it("aborts when the invocation's schedule is for another anchor day than the attempt's", () => {
    const fold = before("4-enable");
    expect(abortReason(decide(fold, worldFor(fold, [NEXT_MON, 22, 6]), scheduleFor(NEXT_MON, NEXT_TUE)))).toBe("SCHEDULE_NOT_FOR_THIS_ATTEMPT");
  });

  it("is done once the anchor is recorded, and stops observing", () => {
    const fold = through("11-anchor");
    expect(decide(fold, worldFor(fold, [TUE, 15, 30], { tasks: unknown() }), SCHEDULE)).toMatchObject({ kind: "done" });
  });
});

describe("decide — 0-resume judges the world against the phase", () => {
  it("aborts when a task is enabled before step 4 (ACT-26)", () => {
    const fold = before("4-enable");
    const decision = decide(fold, worldFor(fold, [MON, 22, 6], { tasks: known({ cycle: task("Ready", CYCLE_ARGS), watchdog: task("Disabled", WATCHDOG_ARGS) }) }), SCHEDULE);
    expect(decision).toMatchObject({ kind: "abort", reason: "WORLD_MISMATCH", teardown: true });
    expect(evidenceOf(decision)["red"]).toContain("tasks.cycle.expected-disabled:observed-Ready");
  });

  it("aborts when a task is disabled after step 4 outside the watchdog drill (ACT-26)", () => {
    const fold = before("5a-watchdog-disable");
    expect(abortReason(decide(fold, worldFor(fold, [MON, 22, 16], { tasks: known({ cycle: task("Disabled", CYCLE_ARGS), watchdog: task("Ready", WATCHDOG_ARGS) }) }), SCHEDULE))).toBe("WORLD_MISMATCH");
  });

  it("treats a task state it does not recognise as red", () => {
    const fold = before("4-enable");
    const decision = decide(fold, worldFor(fold, [MON, 22, 6], { tasks: known({ cycle: task("Stopping", CYCLE_ARGS), watchdog: task("Disabled", WATCHDOG_ARGS) }) }), SCHEDULE);
    expect(evidenceOf(decision)["red"]).toContain("tasks.cycle.state-unrecognised:Stopping");
  });

  it("aborts on an unreadable task list (A1)", () => {
    const fold = before("2-certificate");
    expect(decide(fold, worldFor(fold, [MON, 16, 0], { tasks: unknown("access denied") }), SCHEDULE)).toMatchObject({ kind: "abort", reason: "WORLD_UNKNOWN", teardown: true });
  });

  it("aborts when the certificate line is back after step 0 removed it", () => {
    const fold = before("2-certificate");
    const decision = decide(fold, worldFor(fold, [MON, 16, 0], { env: known({ certificatePath: "C:\\old\\hackathon.json", profile: "competition", hash: "e2", duplicateKeys: [], shadowedKeys: [] }) }), SCHEDULE);
    expect(evidenceOf(decision)["red"]).toContain("env.certificate-line.expected-absent");
  });

  it("aborts on a non-competition profile, which would skip the latch (ACT-57)", () => {
    const fold = before("4-enable");
    const decision = decide(fold, worldFor(fold, [MON, 22, 6], { env: known({ certificatePath: null, profile: "dev", hash: "e2", duplicateKeys: [], shadowedKeys: [] }) }), SCHEDULE);
    expect(evidenceOf(decision)["red"]).toContain("env.profile:dev");
  });

  it("aborts on a duplicate key in .env", () => {
    const fold = before("4-enable");
    const decision = decide(fold, worldFor(fold, [MON, 22, 6], { env: known({ certificatePath: null, profile: "competition", hash: "e2", duplicateKeys: ["ALPACA_PROFILE"], shadowedKeys: [] }) }), SCHEDULE);
    expect(evidenceOf(decision)["red"]).toContain("env.duplicate-keys:ALPACA_PROFILE");
  });

  it("aborts when a certificate path or profile is set outside .env, which the runtime would prefer (owner ruling 2026-09-14)", () => {
    const fold = before("4-enable");
    const decision = decide(fold, worldFor(fold, [MON, 22, 6], { env: known({ certificatePath: null, profile: "competition", hash: "e2", duplicateKeys: [], shadowedKeys: ["PRE_ARM_CERTIFICATE"] }) }), SCHEDULE);
    expect(decision).toMatchObject({ kind: "abort", reason: "WORLD_MISMATCH", teardown: true });
    expect(evidenceOf(decision)["red"]).toContain("env.shadowed-outside-dotenv:PRE_ARM_CERTIFICATE");
  });

  it("aborts when the resolved account is not the long-run account", () => {
    const fold = before("4-enable");
    expect(abortReason(decide(fold, worldFor(fold, [MON, 22, 6], { resolvedAccountMasked: known("PA37…IK2") }), SCHEDULE))).toBe("WORLD_MISMATCH");
  });

  it("aborts when either wrapper's hash changed since step 0, naming the wrapper (review 2026-09-14, point 6)", () => {
    const fold = before("4-enable");
    const watchdogEdited = decide(fold, worldFor(fold, [MON, 22, 6], { wrapperHashes: known({ "cycle-run.ps1": "w1", "watchdog-run.ps1": "w2-edited" }) }), SCHEDULE);
    expect(evidenceOf(watchdogEdited)["red"]).toEqual(["wrapper.watchdog-run.ps1.sha256-changed-since-step-0"]);
    const cycleEdited = decide(fold, worldFor(fold, [MON, 22, 6], { wrapperHashes: known({ "cycle-run.ps1": "w1-edited", "watchdog-run.ps1": "w2" }) }), SCHEDULE);
    expect(evidenceOf(cycleEdited)["red"]).toEqual(["wrapper.cycle-run.ps1.sha256-changed-since-step-0"]);
  });

  it("aborts when step 0 recorded a single hash instead of both wrappers", () => {
    const fold = foldOf(linesThrough("3-flat", { "0-preflight": { wrapperSha256: "w1", hostPreconditions: HOST } }));
    expect(evidenceOf(decide(fold, worldFor(fold, [MON, 22, 6]), SCHEDULE))["red"]).toContain("ledger.0-preflight.wrapperHashes-missing");
  });

  it("aborts when a digest changed after the certificate (ACT-25)", () => {
    const fold = before("4-enable");
    const decision = decide(fold, worldFor(fold, [MON, 22, 6], { deploymentDigests: known({ runtimeDigest: "r2", policyDigest: "p1" }) }), SCHEDULE);
    expect(evidenceOf(decision)["red"]).toContain("digests.changed-since-certificate");
  });

  it("aborts when the certificate file is no longer the one step 2 validated", () => {
    const fold = before("4-enable");
    const decision = decide(fold, worldFor(fold, [MON, 22, 6], { certificate: known({ path: CERT_PATH, verdict: "FAIL", digests: { runtimeDigest: "r1", policyDigest: "p1" }, violations: [] }) }), SCHEDULE);
    expect(evidenceOf(decision)["red"]).toContain("certificate.no-longer-the-file-validated-in-step-2");
  });

  it("aborts when the disarm one-shot is missing after the enable", () => {
    const fold = before("5a-watchdog-disable");
    const decision = decide(fold, worldFor(fold, [MON, 22, 16], { disarm: known(NO_DISARM) }), SCHEDULE);
    expect(evidenceOf(decision)["red"]).toContain("disarm.expected-registered-for-15:05-on-the-anchor-day");
  });

  it("aborts when the disarm one-shot fires on the wrong day — a retry's old trigger never fires again", () => {
    const fold = before("5a-watchdog-disable");
    expect(abortReason(decide(fold, worldFor(fold, [MON, 22, 16], { disarm: known(disarmFor(TUE, { fires: { date: MON, minute: 15 * 60 + 5 } })) }), SCHEDULE))).toBe("WORLD_MISMATCH");
  });

  it("after the gate, pages without teardown when the certificate line names another file", () => {
    const fold = before("11-anchor");
    const decision = decide(fold, worldFor(fold, [TUE, 15, 20], { env: known({ certificatePath: "C:\\other.json", profile: "competition", hash: "e3", duplicateKeys: [], shadowedKeys: [] }) }), SCHEDULE);
    expect(decision).toMatchObject({ kind: "abort", reason: "WORLD_MISMATCH", teardown: false });
  });

  it("after the gate, pages without teardown when the disarm one-shot is still registered", () => {
    const fold = before("11-anchor");
    const decision = decide(fold, worldFor(fold, [TUE, 15, 20], { disarm: known(disarmFor(TUE)) }), SCHEDULE);
    expect(decision).toMatchObject({ kind: "abort", reason: "WORLD_MISMATCH", teardown: false });
    expect(evidenceOf(decision)["red"]).toContain("disarm.expected-deleted-after-gate");
  });

  it("aborts when the disarm one-shot would run anything but this attempt's disarm (review 2026-09-14, point 2)", () => {
    const fold = before("5a-watchdog-disable");
    const at: Clock = [MON, 22, 16];
    const redOf = (disarm: DisarmObservation): unknown => evidenceOf(decide(fold, worldFor(fold, at, { disarm: known(disarm) }), SCHEDULE))["red"];
    expect(decide(fold, worldFor(fold, at), SCHEDULE).kind).toBe("wait");
    expect(redOf(disarmFor(TUE, { actions: [{ execute: "powershell.exe", argumentLine: "-NoProfile -Command Get-Date", workingDirectory: REPO }] }))).toEqual(["disarm.execute", "disarm.arguments"]);
    expect(redOf(disarmFor(TUE, { actions: [...disarmFor(TUE).actions, { execute: "cmd.exe", argumentLine: "/c exit 0", workingDirectory: REPO }] }))).toEqual(["disarm.actions:2"]);
    expect(redOf(disarmFor(TUE, { actions: [] }))).toEqual(["disarm.actions:0"]);
    expect(redOf(disarmFor(TUE, { actions: [{ execute: NODE, argumentLine: `"${REPO}\\ops\\activation\\cli.ts" disarm --state-root "C:\\Users\\felix\\glass-box-state\\longrun-1" --anchor-day ${TUE}`, workingDirectory: REPO }] }))).toEqual(["disarm.arguments"]);
    expect(redOf(disarmFor(TUE, { actions: [{ execute: NODE, argumentLine: `"${REPO}\\ops\\activation\\cli.ts" status --state-root "${ACTIVATION_ROOT}" --anchor-day ${TUE}`, workingDirectory: REPO }] }))).toEqual(["disarm.arguments"]);
    expect(redOf(disarmFor(TUE, { actions: [{ execute: NODE, argumentLine: `"${REPO}\\ops\\activation\\cli.ts" disarm --state-root "${ACTIVATION_ROOT}" --anchor-day ${TUE} --force`, workingDirectory: REPO }] }))).toEqual(["disarm.arguments"]);
    expect(redOf(disarmFor(TUE, { state: "Disabled" }))).toEqual(["disarm.state:Disabled"]);
  });

  it("aborts when the disarm one-shot would not run elevated, signed out and after a missed start, or runs another node (review 2026-09-14, point 4)", () => {
    const fold = before("5a-watchdog-disable");
    const at: Clock = [MON, 22, 16];
    const redOf = (disarm: DisarmObservation): unknown => evidenceOf(decide(fold, worldFor(fold, at, { disarm: known(disarm) }), SCHEDULE))["red"];
    const disarmLine = disarmFor(TUE).actions[0]?.argumentLine ?? "";
    expect(redOf(disarmFor(TUE, { runLevel: "Limited" }))).toEqual(["disarm.run-level:Limited"]);
    expect(redOf(disarmFor(TUE, { logonType: "Interactive" }))).toEqual(["disarm.logon-type:Interactive"]);
    expect(redOf(disarmFor(TUE, { logonType: "Password" }))).toEqual(["disarm.logon-type:Password"]);
    expect(redOf(disarmFor(TUE, { startWhenAvailable: false }))).toEqual(["disarm.start-when-available:false"]);
    expect(redOf(disarmFor(TUE, { userId: "OTHER\\user", userSid: "S-1-5-21-other" }))).toEqual(["disarm.user-sid"]);
    expect(redOf(disarmFor(TUE, { runLevel: null, logonType: null, startWhenAvailable: null }))).toEqual(["disarm.run-level:absent", "disarm.logon-type:absent", "disarm.start-when-available:absent"]);
    // Principal and settings are judged even when the action is wrong too: one finding does not hide another.
    expect(redOf(disarmFor(TUE, { runLevel: "Limited", actions: [] }))).toEqual(["disarm.run-level:Limited", "disarm.actions:0"]);
    // The registered node must be the expected one, by full path: another installation, or a bare name the PATH resolves, is red.
    expect(redOf(disarmFor(TUE, { actions: [{ execute: "C:\\Users\\felix\\AppData\\Local\\fnm\\node.exe", argumentLine: disarmLine, workingDirectory: REPO }] }))).toEqual(["disarm.execute"]);
    expect(redOf(disarmFor(TUE, { actions: [{ execute: "node.exe", argumentLine: disarmLine, workingDirectory: REPO }] }))).toEqual(["disarm.execute"]);
    expect(redOf(disarmFor(TUE, { actions: [{ execute: `${NODE}.bak`, argumentLine: disarmLine, workingDirectory: REPO }] }))).toEqual(["disarm.execute"]);
  });

  it("checks task definitions by value once step 1 is done, and not before", () => {
    const stale = known({ cycle: task("Disabled", `"${REPO}\\dist\\shell\\agent-cli.js"`, "C:\\Program Files\\nodejs\\node.exe"), watchdog: task("Disabled", WATCHDOG_ARGS) });
    const afterInstall = before("2-certificate");
    const decision = decide(afterInstall, worldFor(afterInstall, [MON, 16, 0], { tasks: stale }), SCHEDULE);
    expect(evidenceOf(decision)["red"]).toContain("cycle.execute");
    const beforeInstall = before("0-preflight");
    expect(decide(beforeInstall, worldFor(beforeInstall, [MON, 15, 30], { tasks: stale }), SCHEDULE).kind).toBe("record");
  });
});

describe("decide — task definitions by value", () => {
  const cycle = (argumentLine: string): readonly string[] => definitionFindings("cycle", task("Disabled", argumentLine));
  const watchdog = (argumentLine: string): readonly string[] => definitionFindings("watchdog", task("Disabled", argumentLine));

  it("rejects a relative PowerShell host instead of trusting PATH", () => {
    expect(definitionFindings("cycle", task("Disabled", CYCLE_ARGS, "powershell.exe"))).toContain("cycle.execute-untrusted");
  });

  it("binds the installed definition to the reader-derived Node, PowerShell, user and checkout", () => {
    const boundary = { nodePath: NODE, powerShellPath: POWERSHELL, taskUserId: "DESKTOP-V6EGFDV\\felix", taskUserSid: USER_SID };
    expect(definitionFindings("cycle", task("Disabled", CYCLE_ARGS), SCHEDULE, boundary)).toEqual([]);
    const notepad = CYCLE_ARGS.replace(NODE, "C:\\Windows\\System32\\notepad.exe");
    expect(definitionFindings("cycle", task("Disabled", notepad), SCHEDULE, boundary)).toContain("cycle.parameter.nodepath.not-expected");
    expect(definitionFindings("cycle", { ...task("Disabled", CYCLE_ARGS), userId: "OTHER\\user", userSid: "S-1-5-21-other" }, SCHEDULE, boundary)).toContain("cycle.user-sid");
    const observed = task("Disabled", CYCLE_ARGS);
    const firstAction = observed.actions[0];
    if (firstAction === undefined) throw new Error("test task has no action");
    expect(definitionFindings("cycle", { ...observed, actions: [{ ...firstAction, workingDirectory: "C:\\other" }] }, SCHEDULE, boundary)).toContain("cycle.working-directory");
  });

  it("accepts exactly the installer's action lines", () => {
    expect(cycle(CYCLE_ARGS)).toEqual([]);
    expect(watchdog(WATCHDOG_ARGS)).toEqual([]);
  });

  it("splits arguments on whitespace and groups quoted paths, refusing an unbalanced quote", () => {
    expect(tokenizeArguments(`-File "C:\\Program Files\\x.ps1" -A 1`)).toEqual(["-File", "C:\\Program Files\\x.ps1", "-A", "1"]);
    expect(tokenizeArguments(`-File "C:\\x.ps1`)).toBeNull();
    expect(cycle(`${HOST_OPTIONS} -File "C:\\x\\tools\\cycle-run.ps1`)).toEqual(["cycle.argumentLine.unbalanced-quotes"]);
  });

  it("accepts -SkipOutsideSession only as its default, in the colon form", () => {
    expect(cycle(`${CYCLE_ARGS} -SkipOutsideSession:$true`)).toEqual([]);
    expect(cycle(`${CYCLE_ARGS} -SkipOutsideSession:$false`)).toEqual(["cycle.parameter.skipoutsidesession"]);
    expect(cycle(`${CYCLE_ARGS} -SkipOutsideSession`)).toEqual(["cycle.parameter.skipoutsidesession"]);
  });

  it("accepts -SessionLeadInMinutes only at its default of 20", () => {
    expect(cycle(`${CYCLE_ARGS} -SessionLeadInMinutes 20`)).toEqual([]);
    expect(cycle(`${CYCLE_ARGS} -SessionLeadInMinutes:20`)).toEqual([]);
    expect(cycle(`${CYCLE_ARGS} -SessionLeadInMinutes 0`)).toEqual(["cycle.parameter.sessionleadinminutes"]);
    expect(cycle(`${CYCLE_ARGS} -SessionLeadInMinutes`)).toEqual(["cycle.parameter.sessionleadinminutes"]);
  });

  it("refuses an abbreviated parameter, which PowerShell would bind without spelling the name", () => {
    expect(cycle(`${CYCLE_ARGS} -Skip:$false`)).toEqual(["cycle.parameter.unknown:-skip"]);
  });

  it("refuses duplicate wrapper parameters that PowerShell rejects as already bound", () => {
    expect(cycle(`${CYCLE_ARGS} -RepoRoot "${REPO}"`)).toContain("cycle.parameter.duplicate:-reporoot");
    expect(cycle(`${CYCLE_ARGS} -NodePath "${NODE}"`)).toContain("cycle.parameter.duplicate:-nodepath");
  });

  it("refuses a positional token, host options other than the installer's, and another script", () => {
    expect(cycle(`${CYCLE_ARGS} stray`)).toEqual(["cycle.parameter.positional"]);
    expect(cycle(CYCLE_ARGS.replace("-NonInteractive", "-Command Get-Date"))).toContain("cycle.argumentLine.host-options");
    expect(cycle(CYCLE_ARGS.replace("cycle-run.ps1", "cycle-run-old.ps1"))).toContain("cycle.argumentLine.script");
    expect(cycle(`"${REPO}\\dist\\shell\\agent-cli.js"`)).toEqual(["cycle.argumentLine.no-file"]);
  });

  it("refuses the other task's parameters", () => {
    expect(watchdog(`${WATCHDOG_ARGS} -SessionLeadInMinutes:20`)).toEqual(["watchdog.parameter.sessionleadinminutes"]);
    expect(watchdog(`${WATCHDOG_ARGS} -SkipOutsideSession:$true`)).toEqual(["watchdog.parameter.skipoutsidesession"]);
    expect(cycle(`${CYCLE_ARGS} -WatchdogIntervalMinutes 10`)).toEqual(["cycle.parameter.unknown:-watchdogintervalminutes"]);
  });

  it("accepts -MaxLogBytes only where it is declared: cycle-run.ps1 has it, watchdog-run.ps1 does not", () => {
    expect(cycle(`${CYCLE_ARGS} -MaxLogBytes 1048576`)).toEqual([]);
    expect(watchdog(`${WATCHDOG_ARGS} -MaxLogBytes 1048576`)).toEqual(["watchdog.parameter.unknown:-maxlogbytes"]);
  });

  it("refuses the direct-node registration found on the host", () => {
    expect(definitionFindings("cycle", task("Disabled", `"${REPO}\\dist\\shell\\agent-cli.js"`, "C:\\Program Files\\nodejs\\node.exe"))).toContain("cycle.execute");
  });
});

describe("decide — step 0, preflight", () => {
  const fold = before("0-preflight");
  const at: Clock = [MON, 15, 30];

  it("removes the stale certificate line and records the wrapper hash and host preconditions", () => {
    const decision = decide(fold, worldFor(fold, at, { env: known({ certificatePath: "C:\\old\\hackathon.json", profile: "competition", hash: "e0", duplicateKeys: [], shadowedKeys: [] }) }), SCHEDULE);
    expect(decision).toMatchObject({ kind: "act", step: "0-preflight", actions: [{ kind: "remove-certificate-line" }] });
    expect(evidenceOf(decision)).toMatchObject({ wrapperHashes: { "cycle-run.ps1": "w1", "watchdog-run.ps1": "w2" }, hostPreconditions: HOST, envHashBefore: "e0", fingerprints: FINGERPRINTS, tokenProbe: "ok" });
    expect(evidenceOf(decision)["alertConfirmation"]).toMatchObject({ operator: "felix", bundledAlert: true, downFlipUtcMs: { liveness: CONFIRMED_DOWN, readiness: CONFIRMED_DOWN, watchdog: CONFIRMED_DOWN }, oldestReceiptUtcMs: CONFIRMED_ALERT });
  });

  it("records already-in-target-state when the line is already absent (ACT-12)", () => {
    expect(decide(fold, worldFor(fold, at), SCHEDULE)).toMatchObject({ kind: "record", step: "0-preflight", outcome: "already_in_target_state" });
  });

  it("accepts a confirmation whose oldest receipt is exactly fourteen days old and refuses one a millisecond older", () => {
    const now = utc(at);
    const aged = (alertUtcMs: number): Partial<Observations> => ({
      alertConfirmation: known(confirmationAt(alertUtcMs)),
      checks: checksWith(now, { liveness: check(FINGERPRINTS.liveness, "up", now - 60_000, flipsFor(alertUtcMs)), readiness: check(FINGERPRINTS.readiness, "up", now - 60_000, flipsFor(alertUtcMs)), watchdog: check(FINGERPRINTS.watchdog, "up", now - 60_000, flipsFor(alertUtcMs)) }),
    });
    expect(decide(fold, worldFor(fold, at, aged(now - 14 * DAY_MS)), SCHEDULE).kind).toBe("record");
    expect(abortReason(decide(fold, worldFor(fold, at, aged(now - 14 * DAY_MS - 1)), SCHEDULE))).toBe("PREFLIGHT_RED");
  });

  const now = utc(at);
  const red: readonly (readonly [string, Partial<Observations>, string])[] = [
    ["no confirmation of gate condition 4 (ACT-11)", { alertConfirmation: known(null) }, "alert-confirmation.absent"],
    ["a confirmation dated in the future", { alertConfirmation: known(confirmationAt(now + 60_000)), checks: checksWith(now, { liveness: check(FINGERPRINTS.liveness, "up", now, flipsFor(now + 60_000)), readiness: check(FINGERPRINTS.readiness, "up", now, flipsFor(now + 60_000)), watchdog: check(FINGERPRINTS.watchdog, "up", now, flipsFor(now + 60_000)) }) }, "alert-confirmation.liveness.alert-after-now"],
    // Review of 2026-09-14, point 2: each receipt on its own, not only the oldest; the checks were never resumed, so no up flip exposes the future time.
    ["a reminder received after now, although the oldest receipt is in the past", { alertConfirmation: known({ ...confirmationAt(CONFIRMED_ALERT), reminderReceivedUtcMs: now + 3_600_000 }), checks: checksWith(now, { liveness: check(FINGERPRINTS.liveness, "paused", null, STILL_DOWN), readiness: check(FINGERPRINTS.readiness, "paused", null, STILL_DOWN), watchdog: check(FINGERPRINTS.watchdog, "paused", null, STILL_DOWN) }) }, "alert-confirmation.reminder.after-now"],
    ["one alert received after now", { alertConfirmation: known({ ...confirmationAt(CONFIRMED_ALERT), bundledAlert: false, alertReceivedUtcMs: { liveness: CONFIRMED_ALERT, readiness: CONFIRMED_ALERT, watchdog: now + 60_000 }, reminderReceivedUtcMs: now + 120_000 }), checks: checksWith(now, { liveness: check(FINGERPRINTS.liveness, "paused", null, STILL_DOWN), readiness: check(FINGERPRINTS.readiness, "paused", null, STILL_DOWN), watchdog: check(FINGERPRINTS.watchdog, "paused", null, STILL_DOWN) }) }, "alert-confirmation.watchdog.alert-after-now"],
    ["a reminder that did not list the watchdog (review 2026-09-14, point 3)", { alertConfirmation: known({ ...confirmationAt(CONFIRMED_ALERT), reminderListed: ["liveness", "readiness"] }) }, "alert-confirmation.reminder.does-not-list:watchdog"],
    ["a watchdog alert no down flip precedes", { alertConfirmation: known({ ...confirmationAt(CONFIRMED_ALERT), bundledAlert: false, alertReceivedUtcMs: { liveness: CONFIRMED_ALERT, readiness: CONFIRMED_ALERT, watchdog: CONFIRMED_DOWN - 60_000 } }) }, "alert-confirmation.watchdog.no-down-flip-before-alert"],
    ["a recorded down flip the live history does not show", { alertConfirmation: known({ ...confirmationAt(CONFIRMED_ALERT), downFlipUtcMs: { liveness: CONFIRMED_DOWN, readiness: CONFIRMED_DOWN - 1, watchdog: CONFIRMED_DOWN } }) }, "alert-confirmation.readiness.down-flip-differs-from-recorded"],
    ["a rotated check the confirmation does not attest (§8.13)", { checks: checksWith(now, { readiness: check("hc:00000000", "up", now) }) }, "alert-confirmation.readiness.fingerprint-differs-from-live-check"],
    ["a check that is down", { checks: checksWith(now, { watchdog: check(FINGERPRINTS.watchdog, "down", now) }) }, "checks.watchdog.status:down"],
    ["an analyst child that was not verified", { analyst: known({ oauthTokenPresent: true, childStartVerified: false, tokenLive: true, tokenProbeClass: null }) }, "analyst.child-start-not-verified"],
    ["a missing OAuth token", { analyst: known({ oauthTokenPresent: false, childStartVerified: true, tokenLive: true, tokenProbeClass: null }) }, "analyst.oauth-token-absent"],
    ["a token that is present but not live (owner ruling 2026-09-14)", { analyst: known({ oauthTokenPresent: true, childStartVerified: true, tokenLive: false, tokenProbeClass: "AUTH_REJECTED" }) }, "analyst.token-not-live"],
    ["ARSO not switched off", { hostPreconditions: known({ HiberbootEnabled: "0", DisableAutomaticRestartSignOn: "0" }) }, "host.DisableAutomaticRestartSignOn"],
    ["a host precondition that disappeared", { hostPreconditions: known({ HiberbootEnabled: "0" }) }, "host.DisableAutomaticRestartSignOn"],
    ["a host precondition nobody expected", { hostPreconditions: known({ ...HOST, Extra: "1" }) }, "host.Extra"],
    ["too little free disk", { freeDiskBytes: known(1_000) }, "host.free-disk"],
  ];
  for (const [name, overrides, finding] of red) {
    it(`refuses ${name}`, () => {
      const decision = decide(fold, worldFor(fold, at, overrides), SCHEDULE);
      expect(decision).toMatchObject({ kind: "abort", step: "0-preflight", reason: "PREFLIGHT_RED", teardown: true });
      expect(evidenceOf(decision)["red"]).toContain(finding);
    });
  }

  it("refuses when the checks or the wrapper cannot be read, and says unknown rather than red", () => {
    expect(abortReason(decide(fold, worldFor(fold, at, { checks: unknown("429") }), SCHEDULE))).toBe("PREFLIGHT_UNKNOWN");
    expect(abortReason(decide(fold, worldFor(fold, at, { wrapperHashes: unknown("locked") }), SCHEDULE))).toBe("PREFLIGHT_UNKNOWN");
    // A1: a confirmation file that cannot be read is not the same fact as no confirmation at all.
    const unreadable = decide(fold, worldFor(fold, at, { alertConfirmation: unknown("latest confirmation is not a JSON object") }), SCHEDULE);
    expect(abortReason(unreadable)).toBe("PREFLIGHT_UNKNOWN");
    expect(evidenceOf(unreadable)["unknown"]).toEqual(["alertConfirmation: latest confirmation is not a JSON object"]);
  });
});

describe("decide — step 1, install", () => {
  const fold = before("1-install");
  const at: Clock = [MON, 15, 31];
  const stale = known({ cycle: task("Disabled", `"${REPO}\\dist\\shell\\agent-cli.js"`, "C:\\Program Files\\nodejs\\node.exe"), watchdog: task("Disabled", WATCHDOG_ARGS) });

  it("re-registers the stale registration with the coverage date", () => {
    expect(decide(fold, worldFor(fold, at, { tasks: stale }), SCHEDULE)).toMatchObject({ kind: "act", step: "1-install", actions: [{ kind: "install-tasks", coverageThroughDate: "2026-12-16" }] });
  });

  it("records already-in-target-state with the verifier's count when the definitions are right and the verifier passed", () => {
    const decision = decide(fold, worldFor(fold, at), SCHEDULE);
    expect(decision).toMatchObject({ kind: "record", step: "1-install", outcome: "already_in_target_state" });
    expect(evidenceOf(decision)).toMatchObject({ checkCount: 51, cycleArguments: CYCLE_ARGS, watchdogArguments: WATCHDOG_ARGS });
  });

  it("re-registers when the verifier did not pass, even with the right definitions", () => {
    expect(decide(fold, worldFor(fold, at, { schedulerCheck: known({ passed: false, checkCount: 51, failedChecks: 2 }) }), SCHEDULE).kind).toBe("act");
  });

  it("aborts when the build's digests cannot be printed", () => {
    expect(abortReason(decide(fold, worldFor(fold, at, { deploymentDigests: unknown() }), SCHEDULE))).toBe("BUILD_DIGESTS_UNKNOWN");
  });
});

describe("decide — step 2, certificate", () => {
  const fold = before("2-certificate");

  it("waits before 15:35 and while no certificate file exists", () => {
    expect(decide(fold, worldFor(fold, [MON, 15, 34]), SCHEDULE).kind).toBe("wait");
    expect(decide(fold, worldFor(fold, [MON, 15, 40], { certificate: known(null) }), SCHEDULE).kind).toBe("wait");
  });

  it("records the validated path and both digests", () => {
    const decision = decide(fold, worldFor(fold, [MON, 16, 10]), SCHEDULE);
    expect(decision).toMatchObject({ kind: "record", step: "2-certificate", outcome: "ok" });
    expect(evidenceOf(decision)).toMatchObject({ certificatePath: CERT_PATH, runtimeDigest: "r1", policyDigest: "p1" });
  });

  it("aborts on a certificate the runtime's validator rejected, and carries its violations into the evidence (review 2026-09-14, point 1)", () => {
    const rejected = known({ path: CERT_PATH, verdict: "REJECTED", digests: { runtimeDigest: "r1", policyDigest: "p1" }, violations: ["certificate schema mismatch: unexpected or missing fields"] });
    const decision = decide(fold, worldFor(fold, [MON, 16, 10], { certificate: rejected }), SCHEDULE);
    expect(decision).toMatchObject({ kind: "abort", step: "2-certificate", reason: "CERTIFICATE_NOT_PASS", teardown: true });
    expect(evidenceOf(decision)["violations"]).toEqual(["certificate schema mismatch: unexpected or missing fields"]);
  });

  it("aborts on a verdict other than PASS (ACT-13)", () => {
    expect(abortReason(decide(fold, worldFor(fold, [MON, 16, 10], { certificate: known({ path: CERT_PATH, verdict: "FAIL", digests: { runtimeDigest: "r1", policyDigest: "p1" }, violations: [] }) }), SCHEDULE))).toBe("CERTIFICATE_NOT_PASS");
  });

  it("aborts when either digest differs from this deployment's", () => {
    expect(abortReason(decide(fold, worldFor(fold, [MON, 16, 10], { deploymentDigests: known({ runtimeDigest: "r1", policyDigest: "p2" }) }), SCHEDULE))).toBe("CERTIFICATE_DIGEST_MISMATCH");
  });

  it("aborts when --preflight left an artefact in the long-run state directory, by name and regardless of case", () => {
    expect(abortReason(decide(fold, worldFor(fold, [MON, 16, 10], { longRunArtefacts: known(["quarantine", "journal.jsonl"]) }), SCHEDULE))).toBe("LONG_RUN_STATE_CONTAMINATED");
    expect(abortReason(decide(fold, worldFor(fold, [MON, 16, 10], { longRunArtefacts: known(["Pings.log"]) }), SCHEDULE))).toBe("LONG_RUN_STATE_CONTAMINATED");
  });

  it("aborts on an unreadable certificate, and after 22:40", () => {
    expect(abortReason(decide(fold, worldFor(fold, [MON, 16, 10], { certificate: unknown("not JSON") }), SCHEDULE))).toBe("CERTIFICATE_UNREADABLE");
    expect(abortReason(decide(fold, worldFor(fold, [MON, 22, 41], { certificate: known(null) }), SCHEDULE))).toBe("STEP_DEADLINE_MISSED");
  });
});

describe("decide — step 3, flat", () => {
  const fold = before("3-flat");

  it("records a flat dev account", () => {
    expect(decide(fold, worldFor(fold, [MON, 16, 15]), SCHEDULE)).toMatchObject({ kind: "record", step: "3-flat", outcome: "ok" });
  });

  it("aborts on a leftover order or position, and never acts on the account (ACT-14, ACT-56)", () => {
    const order = decide(fold, worldFor(fold, [MON, 16, 15], { devAccount: known({ positions: 0, nonTerminalOrders: 1 }) }), SCHEDULE);
    expect(order).toMatchObject({ kind: "abort", reason: "DEV_ACCOUNT_NOT_FLAT", teardown: true });
    expect(abortReason(decide(fold, worldFor(fold, [MON, 16, 15], { devAccount: known({ positions: 2, nonTerminalOrders: 0 }) }), SCHEDULE))).toBe("DEV_ACCOUNT_NOT_FLAT");
    expect(abortReason(decide(fold, worldFor(fold, [MON, 16, 15], { devAccount: unknown() }), SCHEDULE))).toBe("DEV_ACCOUNT_UNKNOWN");
  });
});

describe("decide — step 4, enable", () => {
  const fold = before("4-enable");

  it("registers the disarm for 15:05 on the anchor day, then enables both tasks", () => {
    expect(decide(fold, worldFor(fold, [MON, 22, 6]), SCHEDULE)).toEqual({
      kind: "act",
      step: "4-enable",
      actions: [
        { kind: "register-disarm", at: { date: TUE, minute: 15 * 60 + 5 } },
        { kind: "enable-tasks", tasks: ["cycle", "watchdog"] },
      ],
      evidence: { checkStatuses: { liveness: "up", readiness: "up", watchdog: "up" } },
    });
  });

  it("waits before 22:05 and aborts after 22:20", () => {
    expect(decide(fold, worldFor(fold, [MON, 22, 4]), SCHEDULE).kind).toBe("wait");
    expect(decide(fold, worldFor(fold, [MON, 22, 21]), SCHEDULE)).toMatchObject({ kind: "abort", step: "4-enable", reason: "STEP_DEADLINE_MISSED", teardown: true });
  });

  it("aborts when a check is neither up nor paused", () => {
    const now = utc([MON, 22, 6]);
    expect(abortReason(decide(fold, worldFor(fold, [MON, 22, 6], { checks: checksWith(now, { liveness: check(FINGERPRINTS.liveness, "down", now) }) }), SCHEDULE))).toBe("CHECKS_NOT_READY");
    expect(decide(fold, worldFor(fold, [MON, 22, 6], { checks: checksWith(now, { liveness: check(FINGERPRINTS.liveness, "paused", null) }) }), SCHEDULE).kind).toBe("act");
  });

  it("does not enable on an evening whose certificate step failed in this attempt (round 5, A3)", () => {
    const failed = foldOf([...linesThrough("1-install"), { at: [MON, 16, 5], step: "2-certificate", kind: "intent" }, { at: [MON, 16, 6], step: "2-certificate", kind: "result", outcome: "failed" }]);
    expect(decide(failed, worldFor(failed, [MON, 22, 6]), SCHEDULE)).toMatchObject({ kind: "abort", step: "2-certificate", reason: "STEP_FAILED" });
  });

  it("re-runs a carried-over step that failed in a previous attempt instead of aborting the new one", () => {
    const fold2 = foldOf([
      ...linesThrough("1-install"),
      { at: [MON, 16, 5], step: "2-certificate", kind: "intent" },
      { at: [MON, 16, 6], step: "2-certificate", kind: "result", outcome: "failed" },
      { at: [MON, 16, 7], step: "2-certificate", kind: "abort" },
      opened([NEXT_MON, 15, 0], "a2", NEXT_TUE),
      { at: [NEXT_MON, 15, 30], step: "0-preflight", kind: "intent", attempt: "a2", anchorDay: NEXT_TUE },
      { at: [NEXT_MON, 15, 30], second: 1, step: "0-preflight", kind: "result", attempt: "a2", anchorDay: NEXT_TUE, evidence: happy("0-preflight").evidence },
    ]);
    expect(decide(fold2, worldFor(fold2, [NEXT_MON, 16, 0]), scheduleFor(NEXT_MON, NEXT_TUE))).toMatchObject({ kind: "record", step: "2-certificate", outcome: "ok" });

    const installRetry = foldOf([
      ...linesThrough("0-preflight"),
      { at: [MON, 15, 31], step: "1-install", kind: "intent" },
      { at: [MON, 15, 32], step: "1-install", kind: "result", outcome: "failed" },
      { at: [MON, 15, 33], step: "1-install", kind: "abort" },
      opened([NEXT_MON, 15, 0], "a2", NEXT_TUE),
      { at: [NEXT_MON, 15, 30], step: "0-preflight", kind: "intent", attempt: "a2", anchorDay: NEXT_TUE },
      { at: [NEXT_MON, 15, 30], second: 1, step: "0-preflight", kind: "result", attempt: "a2", anchorDay: NEXT_TUE, evidence: happy("0-preflight").evidence },
    ]);
    expect(decide(installRetry, worldFor(installRetry, [NEXT_MON, 15, 31]), scheduleFor(NEXT_MON, NEXT_TUE))).toMatchObject({ kind: "record", step: "1-install", outcome: "already_in_target_state" });
  });
});

describe("decide — a new attempt inherits no confirmation age and no flat check (review 2026-09-14, point 3)", () => {
  /** The first attempt, through step 3, ended at step 4. */
  const firstAttempt: Line[] = [...linesThrough("3-flat"), { at: [MON, 22, 21], step: "4-enable", kind: "abort" }];
  const preflightOf = (attempt: string, anchorDay: string, date: string, evidence: Readonly<Record<string, unknown>> = happy("0-preflight").evidence): Line[] => [
    { at: [date, 15, 30], step: "0-preflight", kind: "intent", attempt, anchorDay },
    { at: [date, 15, 30], second: 1, step: "0-preflight", kind: "result", attempt, anchorDay, evidence },
  ];

  it("stops a retry more than fourteen days after the oldest receipt at step 0, before step 4 can enable anything", () => {
    const LATE_MON = "2026-10-05";
    const LATE_TUE = "2026-10-06";
    const fold = foldOf([...firstAttempt, opened([LATE_MON, 15, 0], "a2", LATE_TUE)]);
    const decision = decide(fold, worldFor(fold, [LATE_MON, 22, 6]), scheduleFor(LATE_MON, LATE_TUE));
    expect(decision).toMatchObject({ kind: "abort", step: "0-preflight", reason: "PREFLIGHT_RED", teardown: true });
    expect(evidenceOf(decision)["red"]).toContain("alert-confirmation.stale");
  });

  it("stops a retry whose dev account is no longer flat at step 3, before step 4 can enable anything", () => {
    const fold = foldOf([...firstAttempt, opened([NEXT_MON, 15, 0], "a2", NEXT_TUE), ...preflightOf("a2", NEXT_TUE, NEXT_MON)]);
    const decision = decide(fold, worldFor(fold, [NEXT_MON, 22, 6], { devAccount: known({ positions: 1, nonTerminalOrders: 0 }) }), scheduleFor(NEXT_MON, NEXT_TUE));
    expect(decision).toMatchObject({ kind: "abort", step: "3-flat", reason: "DEV_ACCOUNT_NOT_FLAT", teardown: true });
  });

  it("runs step 0 again in the new attempt, and its evidence is this attempt's", () => {
    const fold = foldOf([...firstAttempt, opened([NEXT_MON, 15, 0], "a2", NEXT_TUE)]);
    const decision = decide(fold, worldFor(fold, [NEXT_MON, 15, 30]), scheduleFor(NEXT_MON, NEXT_TUE));
    expect(decision).toMatchObject({ kind: "record", step: "0-preflight", outcome: "already_in_target_state" });
  });

  it("records a fresh valid certificate after deployment digests change instead of deadlocking on carried step 2", () => {
    const fold = foldOf([
      ...linesThrough("2-certificate"),
      { at: [MON, 16, 20], step: "3-flat", kind: "abort" },
      opened([NEXT_MON, 15, 0], "a2", NEXT_TUE),
      ...preflightOf("a2", NEXT_TUE, NEXT_MON),
    ]);
    const schedule = scheduleFor(NEXT_MON, NEXT_TUE);
    const changed = known({ runtimeDigest: "r2", policyDigest: "p2" });
    const certificate = known({ path: "C:\\evidence\\pre-arm\\retry.json", verdict: "PASS", digests: { runtimeDigest: "r2", policyDigest: "p2" }, violations: [] });
    expect(decide(fold, worldFor(fold, [NEXT_MON, 16, 10], { deploymentDigests: changed, certificate }), schedule)).toMatchObject({
      kind: "record", step: "2-certificate", outcome: "ok", evidence: { certificatePath: "C:\\evidence\\pre-arm\\retry.json", runtimeDigest: "r2", policyDigest: "p2" },
    });
  });

  it("does not call missing carried certificate evidence a digest change", () => {
    const fold = foldOf([
      ...linesThrough("1-install"),
      { at: [MON, 16, 9], step: "2-certificate", kind: "intent" },
      { at: [MON, 16, 10], step: "2-certificate", kind: "result", evidence: { certificatePath: CERT_PATH } },
      { at: [MON, 16, 20], step: "3-flat", kind: "abort" },
      opened([NEXT_MON, 15, 0], "a2", NEXT_TUE),
      ...preflightOf("a2", NEXT_TUE, NEXT_MON),
    ]);
    const changed = known({ runtimeDigest: "r2", policyDigest: "p2" });
    const certificate = known({ path: "C:\\evidence\\pre-arm\\retry.json", verdict: "PASS", digests: { runtimeDigest: "r2", policyDigest: "p2" }, violations: [] });
    const decision = decide(fold, worldFor(fold, [NEXT_MON, 16, 10], { deploymentDigests: changed, certificate }), scheduleFor(NEXT_MON, NEXT_TUE));
    expect(decision).toMatchObject({ kind: "abort", reason: "WORLD_MISMATCH" });
    expect(evidenceOf(decision)["red"]).toContain("ledger.2-certificate.evidence-missing");
  });

  it("keeps the wrapper baseline across attempts: a wrapper changed since the previous attempt's step 0 is red at the new step 0", () => {
    const fold = foldOf([...firstAttempt, opened([NEXT_MON, 15, 0], "a2", NEXT_TUE)]);
    const decision = decide(fold, worldFor(fold, [NEXT_MON, 15, 30], { wrapperHashes: known({ "cycle-run.ps1": "w1-edited", "watchdog-run.ps1": "w2" }) }), scheduleFor(NEXT_MON, NEXT_TUE));
    expect(decision).toMatchObject({ kind: "abort", step: "0-preflight", reason: "PREFLIGHT_RED" });
    expect(evidenceOf(decision)["red"]).toEqual(["wrapper.cycle-run.ps1.sha256-changed-since-previous-attempt"]);
  });

  it("refuses a previous preflight that recorded a hash for only one wrapper, rather than letting the other re-baseline", () => {
    const partial = foldOf([
      ...linesThrough("3-flat", { "0-preflight": { wrapperHashes: { "cycle-run.ps1": "w1" }, hostPreconditions: HOST } }),
      { at: [MON, 22, 21], step: "4-enable", kind: "abort" },
      opened([NEXT_MON, 15, 0], "a2", NEXT_TUE),
    ]);
    const decision = decide(partial, worldFor(partial, [NEXT_MON, 15, 30]), scheduleFor(NEXT_MON, NEXT_TUE));
    expect(evidenceOf(decision)["red"]).toEqual(["ledger.previous-preflight.wrapperHashes-missing"]);
  });
});

describe("decide — step 5, the watchdog drill", () => {
  const enabledAt = utc([MON, 22, 5], 1);

  it("5a waits until a watchdog firing and its ping after the enable are observed", () => {
    const fold = before("5a-watchdog-disable");
    const now = utc([MON, 22, 16]);
    expect(decide(fold, worldFor(fold, [MON, 22, 16]), SCHEDULE).kind).toBe("wait");
    expect(decide(fold, worldFor(fold, [MON, 22, 16], { watchdogLog: known([logLine("watchdog-run.log", [MON, 22, 0], "run")]) }), SCHEDULE).kind).toBe("wait");
    const paused = checksWith(now, { watchdog: check(FINGERPRINTS.watchdog, "paused", enabledAt - 1_000) });
    expect(decide(fold, worldFor(fold, [MON, 22, 16], { watchdogLog: known([logLine("watchdog-run.log", [MON, 22, 15], "run")]), checks: paused }), SCHEDULE).kind).toBe("wait");
  });

  it("5a disables only the watchdog once both are observed", () => {
    const fold = before("5a-watchdog-disable");
    const decision = decide(fold, worldFor(fold, [MON, 22, 16], { watchdogLog: known([logLine("watchdog-run.log", [MON, 22, 15], "run")]) }), SCHEDULE);
    expect(decision).toMatchObject({ kind: "act", step: "5a-watchdog-disable", actions: [{ kind: "disable-tasks", tasks: ["watchdog"] }] });
    expect(evidenceOf(decision)).toMatchObject({ enabledAtUtcMs: enabledAt, firingUtcMs: utc([MON, 22, 15]) });
  });

  it("5a waits on an unreadable API but aborts on an unreadable log, and aborts after 22:25", () => {
    const fold = before("5a-watchdog-disable");
    const firing = known([logLine("watchdog-run.log", [MON, 22, 15], "run")]);
    expect(decide(fold, worldFor(fold, [MON, 22, 16], { watchdogLog: firing, checks: unknown("429") }), SCHEDULE).kind).toBe("wait");
    expect(abortReason(decide(fold, worldFor(fold, [MON, 22, 16], { watchdogLog: unknown("locked") }), SCHEDULE))).toBe("WATCHDOG_LOG_UNREADABLE");
    expect(abortReason(decide(fold, worldFor(fold, [MON, 22, 26], { watchdogLog: firing }), SCHEDULE))).toBe("STEP_DEADLINE_MISSED");
  });

  const disabledAt = utc([MON, 22, 16], 1);
  const at5b: Clock = [MON, 22, 45];
  const now5b = utc(at5b);

  it("5b records the watchdog down with a flip after its disable while the others stay up", () => {
    const fold = before("5b-watchdog-down");
    const checks = checksWith(now5b, { watchdog: check(FINGERPRINTS.watchdog, "down", disabledAt - 60_000, [{ utcMs: utc([MON, 22, 40]), up: false }]) });
    const decision = decide(fold, worldFor(fold, at5b, { checks }), SCHEDULE);
    expect(decision).toMatchObject({ kind: "record", step: "5b-watchdog-down", outcome: "ok" });
    expect(evidenceOf(decision)).toMatchObject({ disabledAtUtcMs: disabledAt, downFlipUtcMs: utc([MON, 22, 40]) });
  });

  it("5b aborts when another check goes down: the down-set is compared as a set (ACT-50)", () => {
    const fold = before("5b-watchdog-down");
    const checks = checksWith(now5b, { liveness: check(FINGERPRINTS.liveness, "down", disabledAt, [{ utcMs: utc([MON, 22, 40]), up: false }]) });
    expect(abortReason(decide(fold, worldFor(fold, at5b, { checks }), SCHEDULE))).toBe("DRILL_WRONG_DOWN_SET");
  });

  it("5b calls the drill invalid when the watchdog was down before its task was disabled", () => {
    const fold = before("5b-watchdog-down");
    const checks = checksWith(now5b, { watchdog: check(FINGERPRINTS.watchdog, "down", null, [{ utcMs: utc([MON, 22, 10]), up: false }]) });
    const decision = decide(fold, worldFor(fold, at5b, { checks }), SCHEDULE);
    expect(decision).toMatchObject({ kind: "abort", reason: "DRILL_INVALID", teardown: true });
    expect(evidenceOf(decision)["drill"]).toBe("invalid");
  });

  it("5b waits while the watchdog is only late, and while the API is unreadable; aborts after 22:50", () => {
    const fold = before("5b-watchdog-down");
    expect(decide(fold, worldFor(fold, at5b, { checks: checksWith(now5b, { watchdog: check(FINGERPRINTS.watchdog, "grace", disabledAt - 60_000) }) }), SCHEDULE).kind).toBe("wait");
    expect(decide(fold, worldFor(fold, at5b, { checks: unknown("503") }), SCHEDULE).kind).toBe("wait");
    expect(abortReason(decide(fold, worldFor(fold, [MON, 22, 51]), SCHEDULE))).toBe("STEP_DEADLINE_MISSED");
  });

  it("5c re-enables the watchdog", () => {
    const fold = before("5c-watchdog-reenable");
    expect(decide(fold, worldFor(fold, [MON, 22, 46]), SCHEDULE)).toEqual({ kind: "act", step: "5c-watchdog-reenable", actions: [{ kind: "enable-tasks", tasks: ["watchdog"] }], evidence: {} });
  });

  it("5d records the watchdog up only on a ping after the re-enable", () => {
    const fold = before("5d-watchdog-up");
    const now = utc([MON, 22, 48]);
    expect(decide(fold, worldFor(fold, [MON, 22, 48]), SCHEDULE)).toMatchObject({ kind: "record", step: "5d-watchdog-up", outcome: "ok" });
    const stale = checksWith(now, { watchdog: check(FINGERPRINTS.watchdog, "up", utc([MON, 22, 40])) });
    expect(decide(fold, worldFor(fold, [MON, 22, 48], { checks: stale }), SCHEDULE).kind).toBe("wait");
  });
});

describe("decide — step 6, the silence drill", () => {
  const at6a: Clock = [MON, 22, 55];

  it("6a disables both tasks after a ping on every check since the watchdog drill", () => {
    const fold = before("6a-silence-disable");
    expect(decide(fold, worldFor(fold, at6a), SCHEDULE)).toMatchObject({ kind: "act", step: "6a-silence-disable", actions: [{ kind: "disable-tasks", tasks: ["cycle", "watchdog"] }] });
  });

  it("6a waits while a wrapper is running, and while a check has no ping since the watchdog drill", () => {
    const fold = before("6a-silence-disable");
    expect(decide(fold, worldFor(fold, at6a, { tasks: known({ cycle: task("Running", CYCLE_ARGS), watchdog: task("Ready", WATCHDOG_ARGS) }) }), SCHEDULE).kind).toBe("wait");
    const now = utc(at6a);
    expect(decide(fold, worldFor(fold, at6a, { checks: checksWith(now, { readiness: check(FINGERPRINTS.readiness, "up", utc([MON, 22, 45])) }) }), SCHEDULE).kind).toBe("wait");
    expect(abortReason(decide(fold, worldFor(fold, [MON, 23, 16]), SCHEDULE))).toBe("STEP_DEADLINE_MISSED");
  });

  const silencedAt = utc([MON, 22, 55], 1);
  const at6b: Clock = [TUE, 0, 0];
  const now6b = utc(at6b);
  const allDown = checksWith(now6b, {
    liveness: check(FINGERPRINTS.liveness, "down", silencedAt - 30_000, [{ utcMs: utc([MON, 23, 40]), up: false }]),
    readiness: check(FINGERPRINTS.readiness, "down", silencedAt - 30_000, [{ utcMs: utc([MON, 23, 50]), up: false }]),
    watchdog: check(FINGERPRINTS.watchdog, "down", silencedAt - 30_000, [{ utcMs: utc([MON, 23, 45]), up: false }]),
  });

  it("6b records all three down after the disable, tolerating the line of an invocation that was in flight", () => {
    const fold = before("6b-silence-down");
    const inFlight = known([logLine("cycle-run.log", [MON, 22, 57], "skip", 1)]);
    const decision = decide(fold, worldFor(fold, at6b, { checks: allDown, cycleLog: inFlight }), SCHEDULE);
    expect(decision).toMatchObject({ kind: "record", step: "6b-silence-down", outcome: "ok" });
    expect(evidenceOf(decision)).toMatchObject({ silencedAtUtcMs: silencedAt, downFlipUtcMs: { liveness: utc([MON, 23, 40]), readiness: utc([MON, 23, 50]), watchdog: utc([MON, 23, 45]) } });
  });

  it("6b calls the drill invalid when a wrapper wrote a line after the in-flight bound — the outage signature (ACT-45)", () => {
    const fold = before("6b-silence-down");
    const justAfter = known([logLine("cycle-run.log", [MON, 22, 57], "skip", 2)]);
    expect(abortReason(decide(fold, worldFor(fold, at6b, { checks: allDown, cycleLog: justAfter }), SCHEDULE))).toBe("DRILL_INVALID");
    const outage = known([logLine("watchdog-run.log", [MON, 23, 15], "run")]);
    const decision = decide(fold, worldFor(fold, [MON, 23, 20], { watchdogLog: outage }), SCHEDULE);
    expect(decision).toMatchObject({ kind: "abort", step: "6b-silence-down", reason: "DRILL_INVALID", teardown: true });
  });

  it("6b calls the drill invalid when the independent API read fails once all are down", () => {
    const fold = before("6b-silence-down");
    expect(abortReason(decide(fold, worldFor(fold, at6b, { checks: allDown, apiIndependentRead: unknown("timeout") }), SCHEDULE))).toBe("DRILL_INVALID");
  });

  it("6b calls the drill invalid when a check was down before the disable, or the logs cannot be read", () => {
    const fold = before("6b-silence-down");
    const early = checksWith(now6b, { readiness: check(FINGERPRINTS.readiness, "down", null, [{ utcMs: utc([MON, 22, 50]), up: false }]) });
    expect(abortReason(decide(fold, worldFor(fold, at6b, { checks: early }), SCHEDULE))).toBe("DRILL_INVALID");
    expect(abortReason(decide(fold, worldFor(fold, at6b, { checks: allDown, cycleLog: unknown("locked") }), SCHEDULE))).toBe("DRILL_INVALID");
  });

  it("6b waits until all three are down and while the API is unreadable; aborts after 00:30", () => {
    const fold = before("6b-silence-down");
    const twoDown = checksWith(now6b, {
      liveness: check(FINGERPRINTS.liveness, "down", silencedAt - 30_000, [{ utcMs: utc([MON, 23, 40]), up: false }]),
      watchdog: check(FINGERPRINTS.watchdog, "down", silencedAt - 30_000, [{ utcMs: utc([MON, 23, 45]), up: false }]),
      readiness: check(FINGERPRINTS.readiness, "grace", silencedAt - 30_000),
    });
    expect(decide(fold, worldFor(fold, at6b, { checks: twoDown }), SCHEDULE).kind).toBe("wait");
    expect(decide(fold, worldFor(fold, at6b, { checks: unknown("429") }), SCHEDULE).kind).toBe("wait");
    expect(abortReason(decide(fold, worldFor(fold, [TUE, 0, 31], { checks: twoDown }), SCHEDULE))).toBe("STEP_DEADLINE_MISSED");
  });

  it("6c clears the checks and leaves both tasks disabled", () => {
    const fold = before("6c-silence-clear");
    expect(decide(fold, worldFor(fold, [TUE, 0, 5]), SCHEDULE)).toEqual({ kind: "act", step: "6c-silence-clear", actions: [{ kind: "clear-checks" }], evidence: {} });
  });
});

describe("decide — step 8, the reboot, and closing it after the boot", () => {
  it("waits before 13:30, restarts inside its window, and aborts after 13:45", () => {
    const fold = before("8-reboot");
    expect(decide(fold, worldFor(fold, [TUE, 13, 29]), SCHEDULE).kind).toBe("wait");
    expect(decide(fold, worldFor(fold, [TUE, 13, 30]), SCHEDULE)).toMatchObject({ kind: "act", step: "8-reboot", actions: [{ kind: "restart" }] });
    expect(abortReason(decide(fold, worldFor(fold, [TUE, 13, 46]), SCHEDULE))).toBe("STEP_DEADLINE_MISSED");
  });

  it("does not reboot into a gate that cannot turn green", () => {
    const fold = before("8-reboot");
    const now = utc([TUE, 13, 30]);
    expect(abortReason(decide(fold, worldFor(fold, [TUE, 13, 30], { checks: checksWith(now, { readiness: check(FINGERPRINTS.readiness, "down", now) }) }), SCHEDULE))).toBe("CHECKS_NOT_UP");
  });

  const interrupted = foldOf([...linesThrough("6c-silence-clear"), { at: [TUE, 13, 30], step: "8-reboot", kind: "intent" }]);

  it("closes the interrupted reboot ok when the boot is later than the intent", () => {
    const decision = decide(interrupted, worldFor(interrupted, [TUE, 13, 40], { bootUtcMs: known(utc([TUE, 13, 33])) }), SCHEDULE);
    expect(decision).toEqual({ kind: "record", step: "8-reboot", outcome: "ok", evidence: { bootUtcMs: utc([TUE, 13, 33]), intentAtUtcMs: utc([TUE, 13, 30]), intentSeq: 26 } });
  });

  it("closes it failed when the boot is not later than the intent, and the next invocation aborts", () => {
    expect(decide(interrupted, worldFor(interrupted, [TUE, 13, 40], { bootUtcMs: known(utc([TUE, 13, 30])) }), SCHEDULE)).toMatchObject({ kind: "record", step: "8-reboot", outcome: "failed" });
    const closedFailed = foldOf([...linesThrough("6c-silence-clear"), { at: [TUE, 13, 30], step: "8-reboot", kind: "intent" }, { at: [TUE, 13, 40], step: "8-reboot", kind: "result", outcome: "failed" }]);
    expect(decide(closedFailed, worldFor(closedFailed, [TUE, 13, 45]), SCHEDULE)).toMatchObject({ kind: "abort", step: "8-reboot", reason: "STEP_FAILED", teardown: true });
  });

  it("may close after the reboot's own deadline, but not after the re-arm's", () => {
    expect(decide(interrupted, worldFor(interrupted, [TUE, 13, 52]), SCHEDULE)).toMatchObject({ kind: "record", step: "8-reboot", outcome: "ok" });
    expect(abortReason(decide(interrupted, worldFor(interrupted, [TUE, 14, 0]), SCHEDULE))).toBe("REBOOT_NOT_CLOSED_BEFORE_REARM_DEADLINE");
  });

  it("aborts when the boot time cannot be read (A1)", () => {
    expect(abortReason(decide(interrupted, worldFor(interrupted, [TUE, 13, 40], { bootUtcMs: unknown() }), SCHEDULE))).toBe("BOOT_TIME_UNKNOWN");
  });

  it("aborts on any other interrupted step", () => {
    const fold = foldOf([...linesThrough("3-flat"), { at: [MON, 22, 5], step: "4-enable", kind: "intent" }]);
    expect(decide(fold, worldFor(fold, [MON, 22, 10]), SCHEDULE)).toMatchObject({ kind: "abort", step: "4-enable", reason: "STEP_INTERRUPTED", teardown: true });
  });

  it("does not let a retry inherit the previous attempt's reboot: after its own preflight and flat check, the new attempt starts again at the enable (round 5, A2)", () => {
    const fold = foldOf([
      ...linesThrough("8-reboot"),
      { at: [TUE, 13, 55], step: "7-rearm", kind: "abort" },
      opened([NEXT_MON, 15, 0], "a2", NEXT_TUE),
      { at: [NEXT_MON, 15, 30], step: "0-preflight", kind: "intent", attempt: "a2", anchorDay: NEXT_TUE },
      { at: [NEXT_MON, 15, 30], second: 1, step: "0-preflight", kind: "result", attempt: "a2", anchorDay: NEXT_TUE, evidence: happy("0-preflight").evidence },
      { at: [NEXT_MON, 15, 35], step: "3-flat", kind: "intent", attempt: "a2", anchorDay: NEXT_TUE },
      { at: [NEXT_MON, 15, 35], second: 1, step: "3-flat", kind: "result", attempt: "a2", anchorDay: NEXT_TUE },
    ]);
    expect(decide(fold, worldFor(fold, [NEXT_MON, 22, 6]), scheduleFor(NEXT_MON, NEXT_TUE))).toMatchObject({ kind: "act", step: "4-enable" });
    expect(abortReason(decide(fold, worldFor(fold, [NEXT_TUE, 13, 50]), scheduleFor(NEXT_MON, NEXT_TUE)))).toBe("STEP_DEADLINE_MISSED");
  });
});

describe("decide — step 7, re-arm", () => {
  const fold = before("7-rearm");

  it("enables both tasks inside 13:50–13:59", () => {
    expect(decide(fold, worldFor(fold, [TUE, 13, 49]), SCHEDULE).kind).toBe("wait");
    expect(decide(fold, worldFor(fold, [TUE, 13, 50]), SCHEDULE)).toMatchObject({ kind: "act", step: "7-rearm", actions: [{ kind: "enable-tasks", tasks: ["cycle", "watchdog"] }] });
    expect(abortReason(decide(fold, worldFor(fold, [TUE, 14, 0]), SCHEDULE))).toBe("STEP_DEADLINE_MISSED");
  });

  it("aborts when a host precondition changed since step 0", () => {
    const decision = decide(fold, worldFor(fold, [TUE, 13, 50], { hostPreconditions: known({ HiberbootEnabled: "1", DisableAutomaticRestartSignOn: "1" }) }), SCHEDULE);
    expect(decision).toMatchObject({ kind: "abort", reason: "HOST_PRECONDITIONS_CHANGED" });
    expect(evidenceOf(decision)["changed"]).toEqual(["HiberbootEnabled"]);
  });
});

describe("decide — step 9, the signed-out proof", () => {
  const fold = before("9-proof");
  const at: Clock = [TUE, 14, 5];
  const clean = [sample([TUE, 13, 55]), sample([TUE, 14, 5])];
  const firing = known([logLine("cycle-run.log", [TUE, 14, 0], "skip", 2)]);

  it("records the 14:00 firing and the samples around it", () => {
    const decision = decide(fold, worldFor(fold, at, { cycleLog: firing, sessionSamples: clean }), SCHEDULE);
    expect(decision).toMatchObject({ kind: "record", step: "9-proof", outcome: "ok" });
    expect(evidenceOf(decision)).toMatchObject({ localWindow: "14:00-14:04", logFilesSearched: ["cycle-run.log", "cycle-run.log.1"], bootUtcMs: utc([TUE, 13, 33]) });
  });

  it("does not accept a catch-up firing after 14:04 (ACT-32, ACT-36)", () => {
    const catchUp = known([logLine("cycle-run.log", [TUE, 14, 6], "skip")]);
    expect(decide(fold, worldFor(fold, [TUE, 14, 10], { cycleLog: catchUp, sessionSamples: clean }), SCHEDULE).kind).toBe("wait");
    expect(abortReason(decide(fold, worldFor(fold, [TUE, 14, 36], { cycleLog: catchUp, sessionSamples: clean }), SCHEDULE))).toBe("STEP_DEADLINE_MISSED");
  });

  it("aborts when an explorer process shows someone signed in", () => {
    expect(abortReason(decide(fold, worldFor(fold, at, { cycleLog: firing, sessionSamples: [sample([TUE, 13, 55]), sample([TUE, 14, 5], 0, 1)] }), SCHEDULE))).toBe("SESSION_PRESENT");
  });

  it("aborts when no sample was taken between 13:50 and 14:00 after the boot", () => {
    expect(abortReason(decide(fold, worldFor(fold, at, { cycleLog: firing, sessionSamples: [sample([TUE, 14, 5])] }), SCHEDULE))).toBe("SESSION_SAMPLE_MISSING");
    const slowBoot = foldOf(linesThrough("7-rearm", { "8-reboot": { bootUtcMs: utc([TUE, 13, 56]) } }));
    expect(abortReason(decide(slowBoot, worldFor(slowBoot, at, { cycleLog: firing, sessionSamples: clean }), SCHEDULE))).toBe("SESSION_SAMPLE_MISSING");
  });

  it("waits for the sample after the firing, and aborts on an unreadable log", () => {
    expect(decide(fold, worldFor(fold, at, { cycleLog: firing, sessionSamples: [sample([TUE, 13, 55])] }), SCHEDULE).kind).toBe("wait");
    expect(abortReason(decide(fold, worldFor(fold, at, { cycleLog: unknown(), sessionSamples: clean }), SCHEDULE))).toBe("CYCLE_LOG_UNREADABLE");
  });
});

describe("decide — step 10, the gate", () => {
  const fold = before("10-gate");
  const at: Clock = [TUE, 14, 35];

  it("writes the certificate path step 2 validated, then deletes the disarm", () => {
    const world = worldFor(fold, at);
    if (!world.checks.known) throw new Error("expected known gate checks");
    expect(decide(fold, world, SCHEDULE)).toEqual({
      kind: "act",
      step: "10-gate",
      actions: [{ kind: "write-certificate-line", path: CERT_PATH, observedAtUtcMs: utc(at), notAfterUtcMs: utc(at) + GATE_CHECK_MAX_AGE_MS, expectedChecks: world.checks.value }, { kind: "delete-disarm" }],
      evidence: { certificatePath: CERT_PATH, schedulerCheckCount: 53, bootUtcMs: utc([TUE, 13, 33]), checksObservedAtUtcMs: utc(at), decisionUtcMs: utc(at) },
    });
  });

  it("waits before 14:35 and aborts after 14:55", () => {
    expect(decide(fold, worldFor(fold, [TUE, 14, 34]), SCHEDULE).kind).toBe("wait");
    expect(abortReason(decide(fold, worldFor(fold, [TUE, 14, 56]), SCHEDULE))).toBe("STEP_DEADLINE_MISSED");
  });

  it("never arms from a healthcheck snapshot that aged past the pre-action bound", () => {
    const world = worldFor(fold, at, { checksObservedAtUtcMs: utc(at) - GATE_CHECK_MAX_AGE_MS - 1 });
    const decision = decide(fold, world, SCHEDULE);
    expect(abortReason(decision)).toBe("GATE_RED");
    expect(evidenceOf(decision)["red"]).toContain(`checks.stale:${String(GATE_CHECK_MAX_AGE_MS + 1)}`);
  });

  it("requires a fresh unchanged healthcheck read and clock immediately before the certificate write", () => {
    const decision = decide(fold, worldFor(fold, at), SCHEDULE);
    if (decision.kind !== "act") throw new Error("expected gate action");
    const write = decision.actions.find(action => action.kind === "write-certificate-line");
    if (write === undefined) throw new Error("expected certificate write");
    const fresh = worldFor(fold, at).checks;
    expect(authorizeCertificateWrite(write, utc(at) + 1, fresh)).toEqual({ ok: true });
    expect(authorizeCertificateWrite(write, write.observedAtUtcMs - 1, fresh)).toEqual({ ok: false, reason: "ACTION_CLOCK_INVALID" });
    expect(authorizeCertificateWrite(write, write.notAfterUtcMs + 1, fresh)).toEqual({ ok: false, reason: "ACTION_DEADLINE_EXPIRED" });
    expect(authorizeCertificateWrite(write, utc(at) + 1, unknown("management API failed"))).toEqual({ ok: false, reason: "CHECKS_UNKNOWN" });
    expect(authorizeCertificateWrite(write, utc(at) + 1, checksWith(utc(at), { readiness: check(FINGERPRINTS.readiness, "paused", null) }))).toEqual({ ok: false, reason: "CHECK_CHANGED" });
    expect(authorizeCertificateWrite(write, utc(at) + 1, checksWith(utc(at), { readiness: check("hc:changed", "up", utc(at) - 60_000) }))).toEqual({ ok: false, reason: "CHECK_CHANGED" });
  });

  const now = utc(at);
  const red: readonly (readonly [string, Partial<Observations>])[] = [
    ["a paused check (a paused check cannot alarm)", { checks: checksWith(now, { readiness: check(FINGERPRINTS.readiness, "paused", null) }) }],
    ["an unreadable API (ACT-48: unknown is red)", { checks: unknown("503") }],
    ["a verifier that failed", { schedulerCheckExpectEnabled: known({ passed: false, checkCount: 53, failedChecks: 1 }) }],
    ["a verdict line that contradicts its count", { schedulerCheckExpectEnabled: known({ passed: true, checkCount: 53, failedChecks: 2 }) }],
    ["a verifier that did not run", { schedulerCheckExpectEnabled: unknown("script missing") }],
    ["a token that died since step 0 (owner ruling 2026-09-14)", { analyst: known({ oauthTokenPresent: true, childStartVerified: true, tokenLive: false, tokenProbeClass: "AUTH_REJECTED" }) }],
    ["an analyst probe that could not run", { analyst: unknown("probe timed out") }],
  ];
  for (const [name, overrides] of red) {
    it(`is red on ${name}, and tears down`, () => {
      expect(decide(fold, worldFor(fold, at, overrides), SCHEDULE)).toMatchObject({ kind: "abort", step: "10-gate", reason: "GATE_RED", teardown: true });
    });
  }

  it("is red when the recorded boot is not later than today's reboot intent", () => {
    const noBoot = foldOf(linesThrough("9-proof", { "8-reboot": { bootUtcMs: utc([TUE, 13, 0]) } }));
    const decision = decide(noBoot, worldFor(noBoot, at), SCHEDULE);
    expect(abortReason(decision)).toBe("GATE_RED");
    expect(evidenceOf(decision)["red"]).toContain("reboot.not-proven-for-this-attempt");
  });
});

describe("decide — step 11, the anchor", () => {
  const fold = before("11-anchor");
  const bootstrap = known({ seq: 1, utcMs: utc([TUE, 15, 15], 20) });

  it("records the 15:15 firing and the BOOTSTRAP entry", () => {
    const decision = decide(fold, worldFor(fold, [TUE, 15, 20], { cycleLog: known([logLine("cycle-run.log", [TUE, 15, 15], "run", 3)]), bootstrapEntry: bootstrap }), SCHEDULE);
    expect(decision).toMatchObject({ kind: "record", step: "11-anchor", outcome: "ok" });
    expect(evidenceOf(decision)).toMatchObject({ localWindow: "15:15-15:19", bootstrap: { seq: 1 } });
  });

  it("records the first watchdog composition line after the gate, and not the drills' degraded ones before it (spec §8.12)", () => {
    const firing = known([logLine("cycle-run.log", [TUE, 15, 15], "run", 3)]);
    const degradedInTheDrill = { ...logLine("watchdog-run.log", [MON, 22, 30], "other"), composition: "degraded" as const };
    const armedAfterTheGate = { ...logLine("watchdog-run.log", [TUE, 14, 40], "other", 1), composition: "armed" as const };
    const armed = worldFor(fold, [TUE, 15, 20], { cycleLog: firing, bootstrapEntry: bootstrap, watchdogLog: known([degradedInTheDrill, logLine("watchdog-run.log", [TUE, 14, 40], "run"), armedAfterTheGate]) });
    expect(evidenceOf(decide(fold, armed, SCHEDULE))["firstWatchdogCompositionAfterGate"]).toEqual({ file: "watchdog-run.log", utcMs: utc([TUE, 14, 40], 1), composition: "armed" });
    const degradedAfterTheGate = { ...armedAfterTheGate, composition: "degraded" as const };
    const degraded = worldFor(fold, [TUE, 15, 20], { cycleLog: firing, bootstrapEntry: bootstrap, watchdogLog: known([degradedInTheDrill, degradedAfterTheGate]) });
    expect(evidenceOf(decide(fold, degraded, SCHEDULE))["firstWatchdogCompositionAfterGate"]).toMatchObject({ composition: "degraded" });
    const none = worldFor(fold, [TUE, 15, 20], { cycleLog: firing, bootstrapEntry: bootstrap, watchdogLog: known([degradedInTheDrill]) });
    expect(decide(fold, none, SCHEDULE)).toMatchObject({ kind: "record", step: "11-anchor", evidence: { firstWatchdogCompositionAfterGate: null } });
  });

  it("waits on a skip at 15:15 and on a catch-up at 15:31, and aborts after 16:00 without teardown", () => {
    const skip = known([logLine("cycle-run.log", [TUE, 15, 15], "skip")]);
    expect(decide(fold, worldFor(fold, [TUE, 15, 20], { cycleLog: skip, bootstrapEntry: bootstrap }), SCHEDULE).kind).toBe("wait");
    const catchUp = known([logLine("cycle-run.log", [TUE, 15, 31], "run")]);
    expect(decide(fold, worldFor(fold, [TUE, 15, 35], { cycleLog: catchUp, bootstrapEntry: bootstrap }), SCHEDULE).kind).toBe("wait");
    expect(decide(fold, worldFor(fold, [TUE, 16, 1], { cycleLog: catchUp, bootstrapEntry: bootstrap }), SCHEDULE)).toMatchObject({ kind: "abort", reason: "STEP_DEADLINE_MISSED", teardown: false });
  });

  it("waits for the BOOTSTRAP entry, and pages without teardown when the log cannot be read", () => {
    expect(decide(fold, worldFor(fold, [TUE, 15, 20], { cycleLog: known([logLine("cycle-run.log", [TUE, 15, 15], "run")]) }), SCHEDULE).kind).toBe("wait");
    expect(decide(fold, worldFor(fold, [TUE, 15, 20], { cycleLog: unknown() }), SCHEDULE)).toMatchObject({ kind: "abort", reason: "CYCLE_LOG_UNREADABLE", teardown: false });
  });
});
