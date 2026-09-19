// A world the activation core can be run against end to end (build log, unit 6).
//
// Unit 5's tests ask one question per test. This simulator asks the next one: do
// the answers compose? It advances a clock minute by minute, lets the scheduled
// tasks fire and the healthchecks.io checks go down the way their cron schedules and
// graces make them, invokes the core every five minutes inside the activation task's
// two trigger windows, and applies each decision exactly as the shell contracts of
// unit 5 define it: `act` writes intent, applies the actions, writes the result;
// `record` writes one result; `abort` writes one abort entry and, with `teardown`,
// disables both tasks and removes the certificate line; `wait`, `ended` and `done`
// write nothing.
//
// It lives in the test tree on purpose: it is a model of the world, and a model is a
// yardstick only as long as the code under test cannot import it.
//
// The model, stated so that a reader can check it against the host:
// - cycle task: every 15 min from 14:00 to 23:45 local; `run:` inside 15:10–21:59
//   (session minus the 20-minute lead-in), `skip:` otherwise; pings liveness and
//   readiness; the first `run:` with a certificate line present writes BOOTSTRAP;
// - watchdog task: every 5 min from 14:00 to 23:55 (measured on the host, 2026-09-14); `run:`; pings the watchdog check;
// - a check is due at the next slot of its schedule after its last ping (the next day
//   at 14:00 when none is left today), goes to `grace` after the slot and `down` after
//   slot plus grace — liveness 30 min, readiness 50 min, watchdog 15 min;
// - a paused check stays paused until a ping;
// - the activation task fires every 5 min, certificate day 15:30–00:45 and anchor day
//   13:25–16:05; a restart takes the machine down for `rebootMinutes`.
// Europe/Berlin is UTC+2 throughout, which holds for the September dates used.
import { decide } from "../core/decide.ts";
import { foldLedger, stepDone } from "../core/fold.ts";
import type { LedgerFold } from "../core/fold.ts";
import { ledgerTail, parseLedgerText, planLedgerAppend } from "../core/ledger.ts";
import type { LedgerDraft } from "../core/ledger.ts";
import type { CheckName, Decision, LocalInstant, LogLine, Observations, Reading, Schedule, SessionSample, StepId, TaskName, WorldAction } from "../core/types.ts";

export const MINUTE_MS = 60_000;
const OFFSET_MS = 120 * MINUTE_MS;
const DAY_MS = 1_440 * MINUTE_MS;

export const CERT_PATH = "C:\\Users\\felix\\glass-box-state\\dev\\certificate-run-4.json";
export const HOST: Readonly<Record<string, string>> = { HiberbootEnabled: "0", DisableAutomaticRestartSignOn: "1" };
export const FINGERPRINTS: Readonly<Record<CheckName, string>> = { liveness: "hc:a685fe10", readiness: "hc:c4ad5b69", watchdog: "hc:b76072aa" };
export const ACCOUNT = "PA3L…U97";
const REPO = "C:\\Users\\felix\\source\\repos\\glass-box-trading";
const HOST_OPTIONS = "-NoProfile -NonInteractive -ExecutionPolicy Bypass";
const NODE = "C:\\Program Files\\nodejs\\node.exe";
const POWERSHELL = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
export const CYCLE_ARGS = `${HOST_OPTIONS} -File "${REPO}\\tools\\cycle-run.ps1" -RepoRoot "${REPO}" -NodePath "${NODE}"`;
export const WATCHDOG_ARGS = `${HOST_OPTIONS} -File "${REPO}\\tools\\watchdog-run.ps1" -RepoRoot "${REPO}" -NodePath "${NODE}" -WatchdogIntervalMinutes 10`;
const STALE_CYCLE_ARGS = `"${REPO}\\dist\\shell\\agent-cli.js"`;
export const ACTIVATION_ROOT = "C:\\Users\\felix\\glass-box-state\\activation-1";
/** What `config/deployment.json` declares, and therefore what `.env` must name (G-7 / R2-18). */
export const LONG_RUN = "C:\\Users\\felix\\glass-box-state\\longrun-2026-09-22";

export function utcOf(date: string, hour: number, minute: number): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hour, minute) - OFFSET_MS;
}

export function localOf(utcMs: number): LocalInstant {
  const shifted = new Date(utcMs + OFFSET_MS);
  return { date: shifted.toISOString().slice(0, 10), minute: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() };
}

function atString(utcMs: number): string {
  return `${new Date(utcMs + OFFSET_MS).toISOString().slice(0, 19)}+02:00`;
}

export function scheduleFor(certificateDay: string, anchorDay: string): Schedule {
  return { certificateDay, drillNightDay: anchorDay, anchorDay, gateNotAfterUtcMs: utcOf(anchorDay, 14, 55), longRunAccountMasked: ACCOUNT, coverageThroughDate: "2026-12-16", expectedHostPreconditions: HOST, minFreeDiskBytes: 10_000_000_000, repoRoot: REPO, activationRoot: ACTIVATION_ROOT, longRunStateDir: LONG_RUN };
}

export interface SimCheck {
  status: string;
  lastPingUtcMs: number | null;
  flips: { utcMs: number; up: boolean }[];
}

export interface SimWorld {
  nowUtcMs: number;
  tasks: Record<TaskName, { enabled: boolean; installed: boolean }>;
  certificateLine: string | null;
  disarm: { registered: boolean; fires: LocalInstant | null };
  checks: Record<CheckName, SimCheck>;
  cycleLog: LogLine[];
  watchdogLog: LogLine[];
  sessionSamples: SessionSample[];
  bootUtcMs: number;
  machineDownUntilUtcMs: number | null;
  rebootMinutes: number;
  certificateReadyAtUtcMs: number;
  certificateVerdict: string;
  bootstrap: { seq: number; utcMs: number } | null;
  /** False models an outage: pings do not land and the management API cannot be read. */
  network: boolean;
  /** A wrapper that keeps running whatever the task states say, as a second registration would. */
  strayCycleWrapper: boolean;
  /** A configuration error: the cycle wrapper's liveness ping reaches the watchdog check (ACT-50). */
  mixedUpLivenessPing?: boolean;
  /** The cycle task reads enabled but never starts, as an S4U logon failure would leave it (ACT-43). */
  cycleStalled?: boolean;
  /** Positions left on the dev account, as a manual test between attempts would leave them (review 2026-09-14, point 3). */
  devPositions?: number;
  alertConfirmedUtcMs: number;
  /** Crash the next invocation that acts on this step: after its intent, before or after its actions. */
  crash: { step: StepId; afterActions: boolean } | null;
  ledgerText: string;
  lastAppendUtcMs: number;
}

export interface Trace {
  readonly local: LocalInstant;
  readonly decision: Decision;
  readonly attempt: string | null;
  readonly cycleEnabled: boolean;
  readonly watchdogEnabled: boolean;
  readonly certificateLine: string | null;
  readonly gateDone: boolean;
}

export function freshWorld(startUtcMs: number): SimWorld {
  // The alert drill of two days earlier, which the confirmation below rests on: down, then back up two hours later.
  const paused = (): SimCheck => ({ status: "paused", lastPingUtcMs: null, flips: [{ utcMs: startUtcMs - 2 * DAY_MS + 2 * 60 * MINUTE_MS, up: true }, { utcMs: startUtcMs - 2 * DAY_MS, up: false }] });
  return {
    nowUtcMs: startUtcMs,
    tasks: { cycle: { enabled: false, installed: false }, watchdog: { enabled: false, installed: false } },
    certificateLine: "C:\\Users\\felix\\glass-box-state\\evidence\\hackathon-certificate.json",
    disarm: { registered: false, fires: null },
    checks: { liveness: paused(), readiness: paused(), watchdog: paused() },
    cycleLog: [],
    watchdogLog: [],
    sessionSamples: [],
    bootUtcMs: startUtcMs - 3 * DAY_MS,
    machineDownUntilUtcMs: null,
    rebootMinutes: 3,
    certificateReadyAtUtcMs: startUtcMs + 65 * MINUTE_MS,
    certificateVerdict: "PASS",
    bootstrap: null,
    network: true,
    strayCycleWrapper: false,
    alertConfirmedUtcMs: startUtcMs - 2 * DAY_MS + MINUTE_MS,
    crash: null,
    ledgerText: "",
    lastAppendUtcMs: 0,
  };
}

export function foldOfWorld(world: SimWorld): LedgerFold {
  return foldLedger(parseLedgerText(world.ledgerText));
}

// ---------------------------------------------------------------------------
// The ledger, as the shell appends it
// ---------------------------------------------------------------------------

type Draft = Pick<LedgerDraft, "step" | "kind" | "outcome" | "evidence" | "nextOwnerAction">;

/** Appends one line; false when the ledger ends in a torn line, which unit 9 has not yet decided how to append after. */
function append(world: SimWorld, attempt: string, anchorDay: string, draft: Draft): boolean {
  const parsed = parseLedgerText(world.ledgerText);
  if (parsed.torn !== null) return false;
  const atUtcMs = Math.max(world.nowUtcMs, world.lastAppendUtcMs + 1_000);
  const planned = planLedgerAppend(ledgerTail(parsed), { ...draft, at: atString(atUtcMs), atUtcMs, attempt, anchorDay });
  if (!planned.ok) throw new Error(`simulator append refused: ${planned.reason}`);
  world.ledgerText += planned.line;
  world.lastAppendUtcMs = atUtcMs;
  return true;
}

export function openAttempt(world: SimWorld, attempt: string, anchorDay: string): void {
  append(world, attempt, anchorDay, { step: null, kind: "note", outcome: null, evidence: { opened: attempt }, nextOwnerAction: null });
}

/** `activation abort --confirm` (spec §5, ACT-27): disable first, remove the line, delete the disarm, ping every check, then the terminal entry. */
export function ownerAbort(world: SimWorld): void {
  world.tasks.cycle.enabled = false;
  world.tasks.watchdog.enabled = false;
  world.certificateLine = null;
  world.disarm = { registered: false, fires: null };
  for (const name of checkNames()) ping(world, name);
  const attempt = foldOfWorld(world).currentAttempt;
  if (attempt === null) throw new Error("no attempt to abort");
  append(world, attempt.id, attempt.anchorDay, { step: null, kind: "abort", outcome: null, evidence: { operator: "felix" }, nextOwnerAction: "Stopped by the owner; nothing is armed." });
}

/** The owner pauses all three checks, as before a retry: with both tasks disabled all afternoon, a check that reads up at 15:00 is down long before 22:05. */
export function ownerPausesChecks(world: SimWorld): void {
  for (const name of checkNames()) world.checks[name].status = "paused";
}

// ---------------------------------------------------------------------------
// Physics
// ---------------------------------------------------------------------------

function checkNames(): readonly CheckName[] {
  return ["liveness", "readiness", "watchdog"];
}

function checkSchedule(name: CheckName): { readonly period: number; readonly grace: number; readonly windowEnd: number } {
  if (name === "watchdog") return { period: 5, grace: 15, windowEnd: 23 * 60 + 55 };
  return { period: 15, grace: name === "liveness" ? 30 : 50, windowEnd: 23 * 60 + 45 };
}

const WINDOW_START = 14 * 60;

function dueAfter(lastPingUtcMs: number, name: CheckName): number {
  const { period, windowEnd } = checkSchedule(name);
  const last = localOf(lastPingUtcMs);
  const slot = last.minute < WINDOW_START ? WINDOW_START : WINDOW_START + (Math.floor((last.minute - WINDOW_START) / period) + 1) * period;
  if (slot <= windowEnd) return utcOf(last.date, 0, slot);
  return utcOf(localOf(utcOf(last.date, 0, 0) + DAY_MS).date, 0, WINDOW_START);
}

function ping(world: SimWorld, name: CheckName): void {
  if (!world.network) return;
  const check = world.checks[name];
  check.lastPingUtcMs = world.nowUtcMs;
  if (check.status !== "up") check.flips.unshift({ utcMs: world.nowUtcMs, up: true });
  check.status = "up";
}

function line(world: SimWorld, file: string, shape: LogLine["shape"]): LogLine {
  return { file, utcMs: world.nowUtcMs, local: localOf(world.nowUtcMs), shape, composition: null };
}

function fireTasks(world: SimWorld): void {
  const minute = localOf(world.nowUtcMs).minute;
  const cycleSlot = minute >= WINDOW_START && minute <= 23 * 60 + 45 && (minute - WINDOW_START) % 15 === 0;
  if (cycleSlot && ((world.tasks.cycle.enabled && world.cycleStalled !== true) || world.strayCycleWrapper)) {
    const inside = minute >= 15 * 60 + 10 && minute < 22 * 60;
    world.cycleLog.push(line(world, "cycle-run.log", inside ? "run" : "skip"));
    ping(world, "readiness");
    ping(world, world.mixedUpLivenessPing === true ? "watchdog" : "liveness");
    if (inside && world.certificateLine !== null && world.bootstrap === null) world.bootstrap = { seq: 1, utcMs: world.nowUtcMs + 20_000 };
  }
  const watchdogSlot = minute >= WINDOW_START && minute <= 23 * 60 + 55 && (minute - WINDOW_START) % 5 === 0;
  if (watchdogSlot && world.tasks.watchdog.enabled) {
    world.watchdogLog.push(line(world, "watchdog-run.log", "run"));
    ping(world, "watchdog");
  }
}

function settleChecks(world: SimWorld): void {
  for (const name of checkNames()) {
    const check = world.checks[name];
    if (check.lastPingUtcMs === null || (check.status !== "up" && check.status !== "grace")) continue;
    const due = dueAfter(check.lastPingUtcMs, name);
    const downAt = due + checkSchedule(name).grace * MINUTE_MS;
    if (world.nowUtcMs > downAt) {
      check.status = "down";
      check.flips.unshift({ utcMs: downAt, up: false });
    } else if (world.nowUtcMs > due) {
      check.status = "grace";
    }
  }
}

/** The disarm one-shot (spec §6): at its minute it disables both tasks unless the ledger shows a green gate. */
function fireDisarm(world: SimWorld): void {
  const fires = world.disarm.fires;
  const now = localOf(world.nowUtcMs);
  if (!world.disarm.registered || fires === null || fires.date !== now.date || fires.minute !== now.minute) return;
  if (!stepDone(foldOfWorld(world), "10-gate")) {
    world.tasks.cycle.enabled = false;
    world.tasks.watchdog.enabled = false;
  }
}

// ---------------------------------------------------------------------------
// Observations, as the readers would report them
// ---------------------------------------------------------------------------

function known<T>(value: T): Reading<T> {
  return { known: true, value };
}

function unreachable<T>(): Reading<T> {
  return { known: false, reason: "api unreachable" };
}

export function observe(world: SimWorld): Observations {
  const installed = world.tasks.cycle.installed && world.tasks.watchdog.installed;
  const bothEnabled = world.tasks.cycle.enabled && world.tasks.watchdog.enabled;
  const checks = {
    liveness: { fingerprint: FINGERPRINTS.liveness, status: world.checks.liveness.status, lastPingUtcMs: world.checks.liveness.lastPingUtcMs, flips: [...world.checks.liveness.flips] },
    readiness: { fingerprint: FINGERPRINTS.readiness, status: world.checks.readiness.status, lastPingUtcMs: world.checks.readiness.lastPingUtcMs, flips: [...world.checks.readiness.flips] },
    watchdog: { fingerprint: FINGERPRINTS.watchdog, status: world.checks.watchdog.status, lastPingUtcMs: world.checks.watchdog.lastPingUtcMs, flips: [...world.checks.watchdog.flips] },
  };
  return {
    nowUtcMs: world.nowUtcMs,
    nowLocal: localOf(world.nowUtcMs),
    checksObservedAtUtcMs: world.nowUtcMs,
    executionBoundary: known({ nodePath: NODE, powerShellPath: POWERSHELL, taskUserId: "DESKTOP-V6EGFDV\\felix", taskUserSid: "S-1-5-21-1000" }),
    tasks: known({
      cycle: world.tasks.cycle.installed
        ? { state: world.tasks.cycle.enabled ? "Ready" : "Disabled", userId: "DESKTOP-V6EGFDV\\felix", userSid: "S-1-5-21-1000", runLevel: "Limited", logonType: "S4U", startWhenAvailable: true, actions: [{ execute: POWERSHELL, argumentLine: CYCLE_ARGS, workingDirectory: REPO }], execute: POWERSHELL, argumentLine: CYCLE_ARGS }
        : { state: world.tasks.cycle.enabled ? "Ready" : "Disabled", userId: "DESKTOP-V6EGFDV\\felix", userSid: "S-1-5-21-1000", runLevel: "Limited", logonType: "S4U", startWhenAvailable: true, actions: [{ execute: NODE, argumentLine: STALE_CYCLE_ARGS, workingDirectory: REPO }], execute: NODE, argumentLine: STALE_CYCLE_ARGS },
      watchdog: { state: world.tasks.watchdog.enabled ? "Ready" : "Disabled", userId: "DESKTOP-V6EGFDV\\felix", userSid: "S-1-5-21-1000", runLevel: "Limited", logonType: "S4U", startWhenAvailable: true, actions: [{ execute: POWERSHELL, argumentLine: WATCHDOG_ARGS, workingDirectory: REPO }], execute: POWERSHELL, argumentLine: WATCHDOG_ARGS },
    }),
    checks: world.network ? known(checks) : unreachable(),
    apiIndependentRead: world.network ? known(true) : unreachable(),
    env: known({ certificatePath: world.certificateLine, profile: "competition", stateDir: LONG_RUN, hash: `env:${world.certificateLine ?? "none"}`, duplicateKeys: [], shadowedKeys: [] }),
    resolvedAccountMasked: known(ACCOUNT),
    deploymentDigests: known({ runtimeDigest: "r1", policyDigest: "p1" }),
    certificate: known(world.nowUtcMs >= world.certificateReadyAtUtcMs ? { path: CERT_PATH, verdict: world.certificateVerdict, digests: { runtimeDigest: "r1", policyDigest: "p1" }, violations: world.certificateVerdict === "PASS" ? [] : ["certificate verdict is not PASS"] } : null),
    devAccount: known({ positions: world.devPositions ?? 0, nonTerminalOrders: 0 }),
    bootUtcMs: known(world.bootUtcMs),
    cycleLog: known([...world.cycleLog]),
    watchdogLog: known([...world.watchdogLog]),
    logFilesSearched: ["cycle-run.log", "cycle-run.log.1"],
    sessionSamples: [...world.sessionSamples],
    wrapperHashes: known({ "cycle-run.ps1": "w1", "watchdog-run.ps1": "w2", "run-log.psm1": "w3" }),
    hostPreconditions: known(HOST),
    alertConfirmation: known({
      operator: "felix",
      alertReceivedUtcMs: { liveness: world.alertConfirmedUtcMs, readiness: world.alertConfirmedUtcMs, watchdog: world.alertConfirmedUtcMs },
      bundledAlert: true,
      reminderReceivedUtcMs: world.alertConfirmedUtcMs + 90 * MINUTE_MS,
      reminderListed: ["liveness", "readiness", "watchdog"],
      fingerprints: FINGERPRINTS,
      downFlipUtcMs: { liveness: world.alertConfirmedUtcMs - MINUTE_MS, readiness: world.alertConfirmedUtcMs - MINUTE_MS, watchdog: world.alertConfirmedUtcMs - MINUTE_MS },
    }),
    longRunArtefacts: known(["quarantine"]),
    freeDiskBytes: known(1_000_000_000_000),
    analyst: known({ oauthTokenPresent: true, childStartVerified: true, tokenLive: true, tokenProbeClass: null }),
    schedulerCheck: known({ passed: installed, checkCount: 51, failedChecks: installed ? 0 : 2 }),
    schedulerCheckExpectEnabled: known({ passed: installed && bothEnabled, checkCount: 53, failedChecks: installed && bothEnabled ? 0 : 2 }),
    disarm: known(world.disarm.registered && world.disarm.fires !== null
      ? { registered: true, fires: world.disarm.fires, state: "Ready", actions: [{ execute: NODE, argumentLine: `"${REPO}\\ops\\activation\\cli.ts" disarm --state-root "${ACTIVATION_ROOT}" --anchor-day ${world.disarm.fires.date}`, workingDirectory: REPO }], runLevel: "Highest", logonType: "S4U", startWhenAvailable: true, userId: "DESKTOP-V6EGFDV\\felix", userSid: "S-1-5-21-1000" }
      : { registered: false, fires: null, state: null, actions: [], runLevel: null, logonType: null, startWhenAvailable: null, userId: null, userSid: null }),
    bootstrapEntry: known(world.bootstrap),
  };
}

// ---------------------------------------------------------------------------
// Applying a decision, as the shell will
// ---------------------------------------------------------------------------

/** Applies one action; true when the machine went down and the invocation ends here. */
function applyAction(world: SimWorld, action: WorldAction): boolean {
  switch (action.kind) {
    case "remove-certificate-line": world.certificateLine = null; return false;
    case "write-certificate-line": world.certificateLine = action.path; return false;
    case "enable-tasks": for (const name of action.tasks) world.tasks[name].enabled = true; return false;
    case "disable-tasks": for (const name of action.tasks) world.tasks[name].enabled = false; return false;
    case "install-tasks":
      world.tasks = { cycle: { enabled: false, installed: true }, watchdog: { enabled: false, installed: true } };
      return false;
    case "register-disarm": world.disarm = { registered: true, fires: action.at }; return false;
    case "delete-disarm": world.disarm = { registered: false, fires: null }; return false;
    case "clear-checks": for (const name of checkNames()) ping(world, name); return false;
    case "restart": world.machineDownUntilUtcMs = world.nowUtcMs + world.rebootMinutes * MINUTE_MS; return true;
  }
}

function apply(world: SimWorld, decision: Decision): void {
  const attempt = foldOfWorld(world).currentAttempt;
  if (attempt === null) return;
  const write = (draft: Draft): boolean => append(world, attempt.id, attempt.anchorDay, draft);
  switch (decision.kind) {
    case "act": {
      write({ step: decision.step, kind: "intent", outcome: null, evidence: decision.evidence, nextOwnerAction: null });
      const crash = world.crash;
      if (crash !== null && crash.step === decision.step) {
        world.crash = null;
        if (crash.afterActions) for (const action of decision.actions) applyAction(world, action);
        return;
      }
      for (const action of decision.actions) {
        if (applyAction(world, action)) return;
      }
      const reported = decision.step === "1-install" ? { checkCount: 51, cycleArguments: CYCLE_ARGS, watchdogArguments: WATCHDOG_ARGS } : {};
      write({ step: decision.step, kind: "result", outcome: "ok", evidence: { ...decision.evidence, ...reported }, nextOwnerAction: null });
      return;
    }
    case "record":
      write({ step: decision.step, kind: "result", outcome: decision.outcome, evidence: decision.evidence, nextOwnerAction: null });
      return;
    case "abort":
      write({ step: decision.step, kind: "abort", outcome: null, evidence: { reason: decision.reason, ...decision.evidence }, nextOwnerAction: decision.nextOwnerAction });
      // The oracle applies the decision's own teardown list through the same applier the
      // shell uses. It used to implement the teardown by hand — clearing both tasks and
      // the certificate line — which is what spec §5 says, while the shell issued only
      // the disable. So `sequences.spec.ts`'s assertion that an abort leaves both tasks
      // disabled and no certificate line was satisfied by this function and never asked
      // the code under test. A mutation probe measured it: making this loop behave like
      // the shell turned the suite red, and adding the missing action to the shell turned
      // it red too, because two green assertions about one invariant disagreed and
      // nothing compared them.
      for (const action of decision.teardown) applyAction(world, action);
      return;
    case "wait":
    case "ended":
    case "done":
      return;
  }
}

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

function invocationDue(schedule: Schedule, now: LocalInstant): boolean {
  if (now.minute % 5 !== 0) return false;
  if (now.date === schedule.certificateDay && now.minute >= 15 * 60 + 30) return true;
  if (now.date === schedule.drillNightDay && now.minute <= 45) return true;
  return now.date === schedule.anchorDay && now.minute >= 13 * 60 + 25 && now.minute <= 16 * 60 + 5;
}

/**
 * Runs minute by minute up to and including `untilUtcMs`. Each minute: the machine
 * boots if its restart is over, the hook changes the world (an owner, an outage),
 * the tasks fire, the checks settle, the disarm fires, and — every five minutes in a
 * trigger window, with the machine up — the core is invoked and its decision applied.
 */
export function runUntil(world: SimWorld, schedule: Schedule, untilUtcMs: number, hook: (world: SimWorld, now: LocalInstant) => void = () => undefined): Trace[] {
  const trace: Trace[] = [];
  for (; world.nowUtcMs <= untilUtcMs; world.nowUtcMs += MINUTE_MS) {
    const now = localOf(world.nowUtcMs);
    if (world.machineDownUntilUtcMs !== null && world.nowUtcMs >= world.machineDownUntilUtcMs) {
      world.machineDownUntilUtcMs = null;
      world.bootUtcMs = world.nowUtcMs;
    }
    const up = world.machineDownUntilUtcMs === null;
    hook(world, now);
    if (up) fireTasks(world);
    settleChecks(world);
    if (up) fireDisarm(world);
    if (!up || !invocationDue(schedule, now)) continue;
    world.sessionSamples.push({ utcMs: world.nowUtcMs, local: now, interactiveSessions: 0, explorerProcesses: 0 });
    const decision = decide(foldOfWorld(world), observe(world), schedule);
    apply(world, decision);
    const after = foldOfWorld(world);
    trace.push({
      local: now,
      decision,
      attempt: after.currentAttempt?.id ?? null,
      cycleEnabled: world.tasks.cycle.enabled,
      watchdogEnabled: world.tasks.watchdog.enabled,
      certificateLine: world.certificateLine,
      gateDone: stepDone(after, "10-gate"),
    });
  }
  return trace;
}
