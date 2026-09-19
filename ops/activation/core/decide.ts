// The decision (spec §5–§7): one invocation's answer, from the fold of the ledger,
// the observations taken just before, and the schedule of the attempt.
//
// The order of evaluation is the design, and every rung answers a finding:
// 1. Integrity. A torn, corrupt or ambiguous ledger means the phase is unknown, so
//    the answer is a tearing abort — the state cannot be shown to be a correctly
//    armed run (A1, A4).
// 2. The attempt. No open attempt is an abort; an ended attempt does nothing at all,
//    whatever the world looks like (round 5, A3); a schedule for another anchor day
//    than the attempt's is an abort.
// 3. Done. A complete activation stops observing: the watchdog carries the run.
// 4. `0-resume`. The world is judged against the expectation of the phase the ledger
//    is in, never against absolutes (round 4, B3); every reading that judgement needs
//    and could not take is an abort (A1).
// 5. An interrupted step. Only the reboot may be interrupted, and the first
//    invocation after the boot closes it from `LastBootUpTime` (round 4).
// 6. The next step: a failure in this attempt aborts, a missed deadline aborts, an
//    early invocation waits.
// 7. The step itself.
//
// One deliberate exception to "unknown aborts": while a drill phase waits for the
// healthchecks.io API to show a state, an unreadable API is a wait bounded by the
// phase's deadline, because a single 429 must not end the night (ACT-47) and the
// deadline turns a lasting blindness into an abort anyway. Local readings — logs,
// tasks, `.env` — still abort at once.
//
// Pure: no I/O, no clock, no `Date`, no module-scope tables.
import type { LedgerFold, StepState } from "./fold.ts";
import { stepDone } from "./fold.ts";
import { crossCheckAlerts } from "./confirmation.ts";
import { compareLocal, expectedCertificateLine, expectedTasks, localAt, nextStep, stepWindow } from "./steps.ts";
import type { CheckName, CheckObservation, Decision, DisarmObservation, ExecutionBoundary, LocalInstant, LogLine, Observations, Reading, Schedule, SessionSample, StepId, TaskName, TaskObservation, WorldAction, WrapperName } from "./types.ts";

/** Spec §5, step 0: gate condition 4 may be at most fourteen days old. */
const ALERT_CONFIRMATION_MAX_AGE_MS = 1_209_600_000;
/** A gate read older than this can no longer authorise a certificate write. */
export const GATE_CHECK_MAX_AGE_MS = 5_000;

export type CertificateWriteAction = Extract<WorldAction, { readonly kind: "write-certificate-line" }>;
export type CertificateWriteAuthorization = { readonly ok: true } | { readonly ok: false; readonly reason: "ACTION_CLOCK_INVALID" | "ACTION_CONTRACT_INVALID" | "SCHEDULE_DEADLINE_EXPIRED" | "CHECK_LEASE_EXPIRED" | "CHECKS_UNKNOWN" | "CHECK_CHANGED" };

/** The fresh re-read lease which unit 8 must consume immediately before writing `.env`. */
export function authorizeCertificateWrite(action: CertificateWriteAction, actionUtcMs: number, freshChecks: Reading<Readonly<Record<CheckName, CheckObservation>>>): CertificateWriteAuthorization {
  if (!Number.isSafeInteger(actionUtcMs)) return { ok: false, reason: "ACTION_CLOCK_INVALID" };
  if (![action.observedAtUtcMs, action.leaseNotAfterUtcMs, action.scheduleNotAfterUtcMs].every(Number.isSafeInteger) || action.leaseNotAfterUtcMs < action.observedAtUtcMs || action.scheduleNotAfterUtcMs < action.observedAtUtcMs) return { ok: false, reason: "ACTION_CONTRACT_INVALID" };
  if (actionUtcMs < action.observedAtUtcMs) return { ok: false, reason: "ACTION_CLOCK_INVALID" };
  if (actionUtcMs > action.scheduleNotAfterUtcMs) return { ok: false, reason: "SCHEDULE_DEADLINE_EXPIRED" };
  if (actionUtcMs > action.leaseNotAfterUtcMs) return { ok: false, reason: "CHECK_LEASE_EXPIRED" };
  if (!freshChecks.known) return { ok: false, reason: "CHECKS_UNKNOWN" };
  for (const name of ["liveness", "readiness", "watchdog"] as const) {
    const expected = action.expectedChecks[name];
    const actual = freshChecks.value[name];
    if (actual.status !== "up" || actual.fingerprint !== expected.fingerprint || actual.status !== expected.status || actual.lastPingUtcMs !== expected.lastPingUtcMs) return { ok: false, reason: "CHECK_CHANGED" };
  }
  return { ok: true };
}

/**
 * Spec §5, step 6: wrapper lines inside the silence window mean a wrapper ran. An
 * invocation already running when the tasks were disabled keeps running — disabling
 * does not stop an instance — and the wrapper writes its line after its pings, so a
 * line within this bound of the disable is that invocation finishing, not a firing
 * the disable failed to prevent. 6a also refuses to disable while a task reads
 * `Running`, which leaves only a firing that starts in the seconds between reading
 * and disabling.
 */
const IN_FLIGHT_TOLERANCE_MS = 120_000;

/** Spec §3: the cycle wrapper's defaults, which the cycle task must use. */
const SESSION_LEAD_IN_DEFAULT = "20";

function taskNames(): readonly TaskName[] {
  return ["cycle", "watchdog"];
}

function checkNames(): readonly CheckName[] {
  return ["liveness", "readiness", "watchdog"];
}

function wrapperNames(): readonly WrapperName[] {
  return ["cycle-run.ps1", "watchdog-run.ps1", "run-log.psm1"];
}

/** Spec §5, step 2: what `--preflight` would have left in the long-run state directory had it used the wrong one. */
function forbiddenLongRunArtefacts(): readonly string[] {
  return ["journal.jsonl", "epoch.json", "analyst", "pings.log"];
}

function formatLocal(instant: LocalInstant): string {
  const hours = Math.floor(instant.minute / 60);
  const minutes = instant.minute % 60;
  return `${instant.date} ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Task definitions, by value
// ---------------------------------------------------------------------------

/** `true` enabled, `false` disabled, `null` a state the core does not recognise — which is red, never a guess. */
export function taskEnabled(state: string): boolean | null {
  if (state === "Disabled") return false;
  if (state === "Ready" || state === "Running" || state === "Queued") return true;
  return null;
}

/** Splits an action's argument line the way `powershell.exe` receives it: whitespace-separated, double quotes group. Unbalanced quotes are null. */
export function tokenizeArguments(line: string): readonly string[] | null {
  const tokens: string[] = [];
  let current = "";
  let inToken = false;
  let quoted = false;
  for (const character of line) {
    if (character === "\"") {
      quoted = !quoted;
      inToken = true;
      continue;
    }
    if (!quoted && (character === " " || character === "\t")) {
      if (inToken) tokens.push(current);
      current = "";
      inToken = false;
      continue;
    }
    current += character;
    inToken = true;
  }
  if (quoted) return null;
  if (inToken) tokens.push(current);
  return tokens;
}

/**
 * The script parameters after `-File <script>`. PowerShell binds any unambiguous
 * prefix of a parameter name and binds bare tokens positionally, so both are red:
 * `-Skip:$false` would switch the session test off without ever spelling the name
 * the verifier resolves. Only the full names the wrappers declare are accepted, and
 * the two that decide whether a firing can reach the runtime only at their defaults.
 */
function scriptParameterFindings(name: TaskName, tokens: readonly string[]): readonly string[] {
  const findings: string[] = [];
  const seen = new Set<string>();
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    index += 1;
    if (!token.startsWith("-")) {
      findings.push(`${name}.parameter.positional`);
      continue;
    }
    const colon = token.indexOf(":");
    const parameter = (colon < 0 ? token : token.slice(0, colon)).toLowerCase();
    if (seen.has(parameter)) findings.push(`${name}.parameter.duplicate:${parameter}`);
    seen.add(parameter);
    const inline = colon < 0 ? null : token.slice(colon + 1);
    const takeValue = (): string | null => {
      if (inline !== null) return inline;
      const value = tokens[index];
      if (value === undefined) return null;
      index += 1;
      return value;
    };
    switch (parameter) {
      case "-reporoot":
      case "-nodepath":
        if (takeValue() === null) findings.push(`${name}.parameter.${parameter.slice(1)}.no-value`);
        break;
      case "-maxlogbytes":
        // Declared by cycle-run.ps1 only; watchdog-run.ps1 would refuse to start with it.
        if (name !== "cycle") findings.push(`${name}.parameter.unknown:${parameter}`);
        if (takeValue() === null) findings.push(`${name}.parameter.${parameter.slice(1)}.no-value`);
        break;
      case "-watchdogintervalminutes":
        if (name !== "watchdog") findings.push(`${name}.parameter.unknown:${parameter}`);
        if (takeValue() === null) findings.push(`${name}.parameter.${parameter.slice(1)}.no-value`);
        break;
      case "-skipoutsidesession":
        // A [bool] parameter through -File binds only in the colon form; a bare switch or a separate value does not mean $true.
        if (name !== "cycle" || inline?.toLowerCase() !== "$true") findings.push(`${name}.parameter.skipoutsidesession`);
        break;
      case "-sessionleadinminutes":
        if (name !== "cycle" || takeValue() !== SESSION_LEAD_IN_DEFAULT) findings.push(`${name}.parameter.sessionleadinminutes`);
        break;
      case "-testclockutc":
        // The wrappers' one test seam (2026-09-19): it supplies the instant every
        // trading-day and session rule already reads, so the safety paths can be
        // exercised on any weekday without touching the host clock. A **registered**
        // task must never carry it, and that is what this case is: the seam's absence in
        // production is machine-checked here and in tools/verify-scheduled-tasks.ps1,
        // rather than promised in a comment. It is named rather than left to the default
        // branch so the finding says what it found.
        takeValue();
        findings.push(`${name}.parameter.test-seam-registered:${parameter}`);
        break;
      default:
        findings.push(`${name}.parameter.unknown:${parameter}`);
    }
  }
  return findings;
}

/** Spec §5 step 4 and §7: a task's action line checked by value, not by what the verifier resolves. Empty means the definition is the installer's. */
export function definitionFindings(name: TaskName, task: TaskObservation, schedule?: Schedule, boundary?: ExecutionBoundary): readonly string[] {
  const findings: string[] = [];
  const execute = task.execute.trim().toLowerCase();
  if (!execute.endsWith("powershell.exe")) findings.push(`${name}.execute`);
  else if (!/^[a-z]:\\/.test(execute) || !execute.endsWith("\\windowspowershell\\v1.0\\powershell.exe")) findings.push(`${name}.execute-untrusted`);
  if (schedule !== undefined && boundary !== undefined) {
    if (task.actions.length !== 1) findings.push(`${name}.actions:${String(task.actions.length)}`);
    if (execute !== boundary.powerShellPath.toLowerCase()) findings.push(`${name}.execute-not-expected`);
    if (task.userSid !== boundary.taskUserSid) findings.push(`${name}.user-sid`);
    if (task.runLevel !== "Limited") findings.push(`${name}.run-level:${task.runLevel ?? "absent"}`);
    if (task.logonType !== "S4U") findings.push(`${name}.logon-type:${task.logonType ?? "absent"}`);
    if (task.startWhenAvailable !== true) findings.push(`${name}.start-when-available`);
    if (task.actions[0]?.workingDirectory?.toLowerCase() !== schedule.repoRoot.toLowerCase()) findings.push(`${name}.working-directory`);
  }
  const tokens = tokenizeArguments(task.argumentLine);
  if (tokens === null) return [...findings, `${name}.argumentLine.unbalanced-quotes`];
  const fileAt = tokens.findIndex(token => token.toLowerCase() === "-file");
  if (fileAt < 0) return [...findings, `${name}.argumentLine.no-file`];
  // The host options before -File are exactly the installer's: anything else — -Command above all — changes what runs.
  if (tokens.slice(0, fileAt).join(" ").toLowerCase() !== "-noprofile -noninteractive -executionpolicy bypass") findings.push(`${name}.argumentLine.host-options`);
  const script = tokens[fileAt + 1];
  const expectedScript = name === "cycle" ? "\\tools\\cycle-run.ps1" : "\\tools\\watchdog-run.ps1";
  if (script === undefined || (schedule === undefined ? !script.toLowerCase().endsWith(expectedScript) : script.toLowerCase() !== `${schedule.repoRoot}${expectedScript}`.toLowerCase())) findings.push(`${name}.argumentLine.script`);
  findings.push(...scriptParameterFindings(name, tokens.slice(fileAt + 2)));
  if (schedule !== undefined && boundary !== undefined) {
    const parameterValue = (parameter: string): string | null => {
      const at = tokens.findIndex(token => token.toLowerCase() === parameter);
      return at < 0 ? null : (tokens[at + 1] ?? null);
    };
    if (parameterValue("-reporoot")?.toLowerCase() !== schedule.repoRoot.toLowerCase()) findings.push(`${name}.parameter.reporoot.not-expected`);
    if (parameterValue("-nodepath")?.toLowerCase() !== boundary.nodePath.toLowerCase()) findings.push(`${name}.parameter.nodepath.not-expected`);
  }
  return findings;
}

/**
 * Spec §6 by value (review of 2026-09-14, point 2): the one-shot is the second layer only if
 * it will fire — its state is not `Disabled` — and if what it runs is exactly this attempt's
 * disarm: one action, the expected node by its full path, the activation CLI in `disarm` mode,
 * this attempt's state root and anchor day, nothing else. A trigger at 15:05 that runs anything
 * else is red. Point 4 of the same review: it must also run as the spec registers it —
 * `Highest`, because only an elevated process may disable tasks whose definitions `felix` can
 * only read; `S4U`, because nobody is signed in at 15:05; and `StartWhenAvailable`, because a
 * machine that was off or rebooting at 15:05 must still disarm when it comes back. Principal and
 * settings are judged before the action, so one finding never hides another.
 */
export function disarmFindings(disarm: DisarmObservation, schedule: Schedule, boundary: ExecutionBoundary): readonly string[] {
  const findings: string[] = [];
  if (disarm.state === null || taskEnabled(disarm.state) !== true) findings.push(`disarm.state:${disarm.state ?? "absent"}`);
  if (disarm.runLevel !== "Highest") findings.push(`disarm.run-level:${disarm.runLevel ?? "absent"}`);
  if (disarm.logonType !== "S4U") findings.push(`disarm.logon-type:${disarm.logonType ?? "absent"}`);
  if (disarm.startWhenAvailable !== true) findings.push(`disarm.start-when-available:${disarm.startWhenAvailable === null ? "absent" : "false"}`);
  if (disarm.userSid !== boundary.taskUserSid) findings.push("disarm.user-sid");
  const action = disarm.actions[0];
  if (disarm.actions.length !== 1 || action === undefined) return [...findings, `disarm.actions:${String(disarm.actions.length)}`];
  if (action.execute.trim().toLowerCase() !== boundary.nodePath.toLowerCase()) findings.push("disarm.execute");
  if (action.workingDirectory?.toLowerCase() !== schedule.repoRoot.toLowerCase()) findings.push("disarm.working-directory");
  const tokens = tokenizeArguments(action.argumentLine);
  const expected = [`${schedule.repoRoot}\\ops\\activation\\cli.ts`, "disarm", "--state-root", schedule.activationRoot, "--anchor-day", schedule.anchorDay];
  if (tokens === null || tokens.length !== expected.length || tokens.some((token, index) => token.toLowerCase() !== (expected[index] ?? "").toLowerCase())) findings.push("disarm.arguments");
  return findings;
}

// ---------------------------------------------------------------------------
// What the ledger recorded
// ---------------------------------------------------------------------------

function recordedString(fold: LedgerFold, step: StepId, key: string): string | null {
  const value = fold.steps[step]?.resultEvidence?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function recordedNumber(fold: LedgerFold, step: StepId, key: string): number | null {
  const value = fold.steps[step]?.resultEvidence?.[key];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

/** An evidence value that is an object of strings, or null for anything else. */
function stringRecordOf(value: unknown): Readonly<Record<string, string>> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const result: Record<string, string> = {};
  for (const [name, item] of Object.entries(value)) {
    if (typeof item !== "string") return null;
    result[name] = item;
  }
  return result;
}

function recordedStringRecord(fold: LedgerFold, step: StepId, key: string): Readonly<Record<string, string>> | null {
  return stringRecordOf(fold.steps[step]?.resultEvidence?.[key]);
}

function resultAt(fold: LedgerFold, step: StepId): number | null {
  return fold.steps[step]?.resultAtUtcMs ?? null;
}

/** Name-by-name equality in both directions: a precondition that disappeared is as changed as one whose value moved. */
function sameRecord(expected: Readonly<Record<string, string>>, observed: Readonly<Record<string, string>>): readonly string[] {
  const changed: string[] = [];
  for (const [name, value] of Object.entries(expected)) {
    if (observed[name] !== value) changed.push(name);
  }
  for (const name of Object.keys(observed)) {
    if (!Object.hasOwn(expected, name)) changed.push(name);
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

function act(step: StepId, actions: readonly WorldAction[], evidence: Readonly<Record<string, unknown>>): Decision {
  return { kind: "act", step, actions, evidence };
}

function record(step: StepId, outcome: "ok" | "failed" | "already_in_target_state", evidence: Readonly<Record<string, unknown>>): Decision {
  return { kind: "record", step, outcome, evidence };
}

function wait(reason: string): Decision {
  return { kind: "wait", reason };
}

/**
 * What an abort owes the world, as a list rather than as a flag.
 *
 * Spec §5: "Every abort up to and including step 10 disables both tasks, leaves
 * `PRE_ARM_CERTIFICATE` unset and pages." Both halves of that sentence are actions and
 * both belong here. This used to return a boolean, and each of the four places that
 * consumed it turned the boolean back into actions on its own — the automatic paths
 * produced only the disable, so an abort after step 10's certificate write reported a
 * completed teardown while the arming credential stayed on disk. One definition, used
 * everywhere, is the whole point.
 *
 * It takes a fold that may be `null` because the disarm one-shot has to answer this
 * question on a ledger it could not read at all — spec §6 — and "I do not know whether
 * the gate is green" is not "the gate is green". An unknown fold owes the full teardown.
 */
export function abortTeardown(fold: LedgerFold | null): readonly WorldAction[] {
  if (fold !== null && stepDone(fold, "10-gate")) return [];
  return fullTeardown();
}

/**
 * The same two actions, owed unconditionally. Two callers need this and neither may ask
 * `abortTeardown`, because both have already established that the fold's own answer about
 * the gate must not decide:
 *
 * - **The record itself is in doubt** — a torn or inconsistent ledger, an empty one, a
 *   schedule for another attempt. A ledger with a torn tail may still *look* as though
 *   the gate was recorded, and ACT-39 says in its own title that an armed state which can
 *   no longer be shown is torn down rather than believed. Reading `stepDone` off a record
 *   whose integrity has just failed would be trusting the thing that failed.
 * - **The disarm one-shot found no green gate for *this* anchor day** (spec §6). A gate
 *   recorded green for an earlier day is not this day's permission, so `stepDone` alone
 *   would let the wrong attempt's success disarm the disarm.
 */
export function fullTeardown(): readonly WorldAction[] {
  return [{ kind: "disable-tasks", tasks: taskNames() }, { kind: "remove-certificate-line" }];
}

/** An abort tears down everything up to and including the gate; after the gate has armed the run it only pages (spec §5). */
function abortAt(fold: LedgerFold, step: StepId | null, reason: string, nextOwnerAction: string, evidence: Readonly<Record<string, unknown>> = {}): Decision {
  return { kind: "abort", step, reason, teardown: abortTeardown(fold), nextOwnerAction, evidence };
}

function unreadable<T>(reading: Reading<T>): string | null {
  return reading.known ? null : reading.reason;
}

/**
 * One directory spelling, reduced as far as a pure comparison honestly can: case-folded,
 * both separators spelled alike, a trailing separator dropped. Written with string
 * operations rather than a path library because this is a core (spec §9).
 */
function foldDirectory(value: string): string {
  const separated = value.trim().toLowerCase().split("/").join("\\");
  let text = separated;
  while (text.length > 0 && text.endsWith("\\")) text = text.slice(0, -1);
  return text;
}

/**
 * Do two spellings name the same directory? Only as far as folding can tell: a junction,
 * an 8.3 short name, a `\\?\` prefix or a `..` detour compares **unequal** here. That is
 * the safe direction — an unequal comparison reds a deployment that may in fact be
 * consistent, it never passes one that is not — and it is the reason the wrappers assert
 * the same agreement against the file system on every firing.
 */
function sameDirectory(left: string, right: string): boolean {
  const folded = foldDirectory(left);
  return folded.length > 0 && folded === foldDirectory(right);
}

// ---------------------------------------------------------------------------
// 0-resume: the world against the expectation of the current phase
// ---------------------------------------------------------------------------

interface WorldFindings {
  readonly unknown: readonly string[];
  readonly red: readonly string[];
}

export function worldFindings(fold: LedgerFold, observations: Observations, schedule: Schedule): WorldFindings {
  const unknown: string[] = [];
  const red: string[] = [];

  if (!observations.tasks.known) {
    unknown.push(`tasks: ${observations.tasks.reason}`);
  } else {
    const expected = expectedTasks(fold);
    for (const name of taskNames()) {
      const task = observations.tasks.value[name];
      const enabled = taskEnabled(task.state);
      if (enabled === null) red.push(`tasks.${name}.state-unrecognised:${task.state}`);
      else if (enabled !== (expected[name] === "enabled")) red.push(`tasks.${name}.expected-${expected[name]}:observed-${task.state}`);
      if (stepDone(fold, "1-install")) {
        if (!observations.executionBoundary.known) unknown.push(`execution-boundary: ${observations.executionBoundary.reason}`);
        else red.push(...definitionFindings(name, task, schedule, observations.executionBoundary.value));
      }
    }
  }

  if (!observations.env.known) {
    unknown.push(`env: ${observations.env.reason}`);
  } else {
    const env = observations.env.value;
    if (env.duplicateKeys.length > 0) red.push(`env.duplicate-keys:${env.duplicateKeys.join(",")}`);
    // The runtime lets process variables win over .env, so a key set outside it bypasses what the ledger expects of .env.
    if (env.shadowedKeys.length > 0) red.push(`env.shadowed-outside-dotenv:${env.shadowedKeys.join(",")}`);
    if (env.profile !== "competition") red.push(`env.profile:${env.profile ?? "absent"}`);
    // The declaration and `.env` state one fact twice, and until now nothing compared them
    // (G-7 / R2-18). The wrappers write `cycle-run.log` and `watchdog-run.log` where this
    // value points; every long-run reading below is taken where the declaration points. A
    // divergence is silent when both directories exist and are empty: step 2's
    // contamination assertion passes over a directory the long run never touches and step 9
    // waits forever for firings it will never see. A value that happens to agree today is
    // not a comparison, which is why this is checked rather than assumed.
    if (env.stateDir === null) red.push("env.state-dir:absent");
    else if (!sameDirectory(env.stateDir, schedule.longRunStateDir)) red.push(`env.state-dir.declared-${schedule.longRunStateDir}:observed-${env.stateDir}`);
    const line = expectedCertificateLine(fold);
    if (line === "absent" && env.certificatePath !== null) red.push("env.certificate-line.expected-absent");
    if (line === "present" && (env.certificatePath === null || env.certificatePath !== recordedString(fold, "2-certificate", "certificatePath"))) {
      red.push("env.certificate-line.expected-the-path-validated-in-step-2");
    }
  }

  if (!observations.resolvedAccountMasked.known) unknown.push(`account: ${observations.resolvedAccountMasked.reason}`);
  else if (observations.resolvedAccountMasked.value !== schedule.longRunAccountMasked) red.push(`account.expected-${schedule.longRunAccountMasked}:observed-${observations.resolvedAccountMasked.value}`);

  if (stepDone(fold, "0-preflight")) {
    // Review of 2026-09-14, point 6: both wrappers, by name — each carries its own safety claims outside the runtime digest.
    const recorded = recordedStringRecord(fold, "0-preflight", "wrapperHashes");
    if (recorded === null || wrapperNames().some(name => recorded[name] === undefined)) red.push("ledger.0-preflight.wrapperHashes-missing");
    else if (!observations.wrapperHashes.known) unknown.push(`wrappers: ${observations.wrapperHashes.reason}`);
    else for (const name of wrapperNames()) if (observations.wrapperHashes.value[name] !== recorded[name]) red.push(`wrapper.${name}.sha256-changed-since-step-0`);
  }

  if (stepDone(fold, "2-certificate")) {
    const path = recordedString(fold, "2-certificate", "certificatePath");
    const runtimeDigest = recordedString(fold, "2-certificate", "runtimeDigest");
    const policyDigest = recordedString(fold, "2-certificate", "policyDigest");
    if (path === null || runtimeDigest === null || policyDigest === null) {
      red.push("ledger.2-certificate.evidence-missing");
    } else {
      if (!observations.deploymentDigests.known) unknown.push(`digests: ${observations.deploymentDigests.reason}`);
      else if (observations.deploymentDigests.value.runtimeDigest !== runtimeDigest || observations.deploymentDigests.value.policyDigest !== policyDigest) red.push("digests.changed-since-certificate");
      if (!observations.certificate.known) {
        unknown.push(`certificate: ${observations.certificate.reason}`);
      } else {
        const certificate = observations.certificate.value;
        const same = certificate !== null && certificate.path === path && certificate.verdict === "PASS"
          && certificate.digests.runtimeDigest === runtimeDigest && certificate.digests.policyDigest === policyDigest;
        if (!same) red.push("certificate.no-longer-the-file-validated-in-step-2");
      }
    }
  }

  if (stepDone(fold, "4-enable")) {
    if (!observations.disarm.known) {
      unknown.push(`disarm: ${observations.disarm.reason}`);
    } else {
      const disarm = observations.disarm.value;
      if (stepDone(fold, "10-gate")) {
        if (disarm.registered) red.push("disarm.expected-deleted-after-gate");
      } else if (!disarm.registered || disarm.fires === null || compareLocal(disarm.fires, localAt(schedule.anchorDay, 15, 5)) !== 0) {
        red.push("disarm.expected-registered-for-15:05-on-the-anchor-day");
      } else {
        if (!observations.executionBoundary.known) unknown.push(`execution-boundary: ${observations.executionBoundary.reason}`);
        else red.push(...disarmFindings(disarm, schedule, observations.executionBoundary.value));
      }
    }
  }

  return { unknown, red };
}

// ---------------------------------------------------------------------------
// The interrupted reboot
// ---------------------------------------------------------------------------

function closeInterrupted(fold: LedgerFold, state: StepState, observations: Observations, schedule: Schedule): Decision {
  if (state.step !== "8-reboot") {
    return abortAt(fold, state.step, "STEP_INTERRUPTED", `Step ${state.step} wrote its intent and no result: an invocation died mid-step. Read the world (tasks, .env, checks) before opening a new attempt.`, { intentSeq: state.intentSeq });
  }
  // The close is bound by the re-arm's deadline, not the reboot's: it may land after 13:45, never after 13:59.
  const deadline = stepWindow("7-rearm", schedule).notValidAfter;
  if (compareLocal(observations.nowLocal, deadline) > 0) {
    return abortAt(fold, "8-reboot", "REBOOT_NOT_CLOSED_BEFORE_REARM_DEADLINE", `The machine did not come back in time to close the reboot before ${formatLocal(deadline)}. Retry on the next trading day.`, { intentSeq: state.intentSeq });
  }
  if (!observations.bootUtcMs.known) {
    return abortAt(fold, "8-reboot", "BOOT_TIME_UNKNOWN", "LastBootUpTime could not be read, so the reboot cannot be proven. Retry on the next trading day.", { reason: observations.bootUtcMs.reason });
  }
  if (state.intentAtUtcMs === null) {
    return abortAt(fold, "8-reboot", "LEDGER_REBOOT_INTENT_WITHOUT_TIME", "The reboot's intent carries no time. Inspect the ledger.");
  }
  const rebooted = observations.bootUtcMs.value > state.intentAtUtcMs;
  return record("8-reboot", rebooted ? "ok" : "failed", { bootUtcMs: observations.bootUtcMs.value, intentAtUtcMs: state.intentAtUtcMs, intentSeq: state.intentSeq });
}

// ---------------------------------------------------------------------------
// The steps
// ---------------------------------------------------------------------------

function linesInWindow(lines: readonly LogLine[], afterUtcMs: number, untilUtcMs: number): readonly LogLine[] {
  return lines.filter(line => line.utcMs > afterUtcMs && line.utcMs <= untilUtcMs);
}

/** A firing is a `run:` or `skip:` line; other lines (`output:`, `exit:`) belong to a firing already counted. */
function firstFiringAfter(lines: readonly LogLine[], afterUtcMs: number): LogLine | null {
  return lines.find(line => line.utcMs > afterUtcMs && (line.shape === "run" || line.shape === "skip")) ?? null;
}

/** A firing on `date` whose local minute lies in `[from, to]` — the named clock time, which a catch-up does not satisfy (ACT-36). */
function firingAt(lines: readonly LogLine[], date: string, from: number, to: number, shapes: readonly LogLine["shape"][]): LogLine | null {
  return lines.find(line => line.local.date === date && line.local.minute >= from && line.local.minute <= to && shapes.includes(line.shape)) ?? null;
}

function statuses(checks: Readonly<Record<CheckName, CheckObservation>>): Readonly<Record<CheckName, string>> {
  return { liveness: checks.liveness.status, readiness: checks.readiness.status, watchdog: checks.watchdog.status };
}

function missingEvidence(fold: LedgerFold, step: StepId, needs: string): Decision {
  return abortAt(fold, step, "LEDGER_EVIDENCE_MISSING", `The ledger lacks ${needs}, which ${step} depends on. Inspect the ledger.`);
}

function checksUnreadableWait(step: StepId, schedule: Schedule, reason: string): Decision {
  return wait(`${step}: healthchecks.io unreadable (${reason}); waiting until ${formatLocal(stepWindow(step, schedule).notValidAfter)}`);
}

function drillInvalid(fold: LedgerFold, step: StepId, cause: string, evidence: Readonly<Record<string, unknown>>): Decision {
  return abortAt(fold, step, "DRILL_INVALID", `The drill could not tell its own disable from another cause (${cause}), so it proves nothing and is not counted. Clear the checks, then repeat the activation from step 4 on the next trading day.`, { ...evidence, drill: "invalid", cause });
}

function step0(fold: LedgerFold, observations: Observations, schedule: Schedule): Decision {
  const unknown: string[] = [];
  const red: string[] = [];
  const note = (reading: Reading<unknown>, name: string): void => {
    const reason = unreadable(reading);
    if (reason !== null) unknown.push(`${name}: ${reason}`);
  };
  note(observations.hostPreconditions, "hostPreconditions");
  note(observations.freeDiskBytes, "freeDiskBytes");
  note(observations.wrapperHashes, "wrapperHashes");
  note(observations.analyst, "analyst");
  note(observations.checks, "checks");
  note(observations.alertConfirmation, "alertConfirmation");

  if (observations.hostPreconditions.known) {
    for (const name of sameRecord(schedule.expectedHostPreconditions, observations.hostPreconditions.value)) red.push(`host.${name}`);
  }
  // Review of 2026-09-14, point 3: a new attempt runs step 0 again, but the wrappers keep the baseline the previous
  // attempt's preflight recorded — tools/*.ps1 is outside the runtime digest, so nothing else would notice a change.
  const previous = fold.previousPreflight;
  if (previous !== null && observations.wrapperHashes.known) {
    const baseline = stringRecordOf(previous.resultEvidence?.["wrapperHashes"]);
    if (baseline === null || wrapperNames().some(name => baseline[name] === undefined)) red.push("ledger.previous-preflight.wrapperHashes-missing");
    else for (const name of wrapperNames()) if (observations.wrapperHashes.value[name] !== baseline[name]) red.push(`wrapper.${name}.sha256-changed-since-previous-attempt`);
  }
  if (observations.freeDiskBytes.known && observations.freeDiskBytes.value < schedule.minFreeDiskBytes) red.push("host.free-disk");
  if (observations.analyst.known) {
    if (!observations.analyst.value.oauthTokenPresent) red.push("analyst.oauth-token-absent");
    if (!observations.analyst.value.childStartVerified) red.push("analyst.child-start-not-verified");
    if (!observations.analyst.value.tokenLive) red.push("analyst.token-not-live");
  }
  const confirmation = observations.alertConfirmation.known ? observations.alertConfirmation.value : null;
  let confirmationEvidence: Readonly<Record<string, unknown>> | null = null;
  if (observations.alertConfirmation.known && confirmation === null) {
    red.push("alert-confirmation.absent");
  } else if (confirmation !== null && observations.checks.known) {
    // Review of 2026-09-14, point 3: the command's cross-check is repeated against the live flip history,
    // each check's recorded down flip must be the one the history assigns, and the confirmation is dated by
    // the oldest receipt it rests on, as an exact duration. Point 2 of the same review: against now, so that
    // no single receipt may lie after it.
    const live = observations.checks.value;
    const cross = crossCheckAlerts(confirmation, { liveness: live.liveness.flips, readiness: live.readiness.flips, watchdog: live.watchdog.flips }, observations.nowUtcMs);
    if (!cross.ok) {
      for (const reason of cross.reasons) red.push(`alert-confirmation.${reason}`);
    } else {
      for (const name of checkNames()) {
        if (cross.downFlipUtcMs[name] !== confirmation.downFlipUtcMs[name]) red.push(`alert-confirmation.${name}.down-flip-differs-from-recorded`);
      }
      // No receipt lies after now (the cross-check refused it), so the age cannot be negative; only staleness remains.
      if (observations.nowUtcMs - cross.oldestReceiptUtcMs > ALERT_CONFIRMATION_MAX_AGE_MS) red.push("alert-confirmation.stale");
      confirmationEvidence = {
        operator: confirmation.operator,
        alertReceivedUtcMs: confirmation.alertReceivedUtcMs,
        bundledAlert: confirmation.bundledAlert,
        reminderReceivedUtcMs: confirmation.reminderReceivedUtcMs,
        reminderListed: confirmation.reminderListed,
        fingerprints: confirmation.fingerprints,
        downFlipUtcMs: cross.downFlipUtcMs,
        oldestReceiptUtcMs: cross.oldestReceiptUtcMs,
      };
    }
  }
  if (observations.checks.known) {
    for (const name of checkNames()) {
      const check = observations.checks.value[name];
      if (confirmation !== null && confirmation.fingerprints[name] !== check.fingerprint) red.push(`alert-confirmation.${name}.fingerprint-differs-from-live-check`);
      if (check.status !== "up" && check.status !== "paused") red.push(`checks.${name}.status:${check.status}`);
    }
  }

  if (unknown.length > 0 || red.length > 0) {
    return abortAt(fold, "0-preflight", unknown.length > 0 && red.length === 0 ? "PREFLIGHT_UNKNOWN" : "PREFLIGHT_RED", "Step 0's preconditions do not hold; the evidence names each. Fix them, then open a new attempt.", { unknown, red });
  }
  if (!observations.env.known || !observations.wrapperHashes.known || !observations.hostPreconditions.known || !observations.checks.known || !observations.analyst.known) {
    return abortAt(fold, "0-preflight", "PREFLIGHT_UNKNOWN", "A reading step 0 needs was not taken.");
  }
  const evidence = {
    wrapperHashes: observations.wrapperHashes.value,
    hostPreconditions: observations.hostPreconditions.value,
    envHashBefore: observations.env.value.hash,
    fingerprints: { liveness: observations.checks.value.liveness.fingerprint, readiness: observations.checks.value.readiness.fingerprint, watchdog: observations.checks.value.watchdog.fingerprint },
    checkStatuses: statuses(observations.checks.value),
    alertConfirmation: confirmationEvidence,
    tokenProbe: observations.analyst.value.tokenProbeClass ?? "ok",
  };
  if (observations.env.value.certificatePath === null) return record("0-preflight", "already_in_target_state", evidence);
  return act("0-preflight", [{ kind: "remove-certificate-line" }], evidence);
}

function step1(fold: LedgerFold, observations: Observations, schedule: Schedule): Decision {
  if (!observations.deploymentDigests.known) {
    return abortAt(fold, "1-install", "BUILD_DIGESTS_UNKNOWN", "The deployment's digests could not be printed, so the build is not known to be current.", { reason: observations.deploymentDigests.reason });
  }
  if (observations.tasks.known && observations.executionBoundary.known && observations.schedulerCheck.known && observations.schedulerCheck.value.passed && observations.schedulerCheck.value.failedChecks === 0) {
    const tasks = observations.tasks.value;
    const findings = [...definitionFindings("cycle", tasks.cycle, schedule, observations.executionBoundary.value), ...definitionFindings("watchdog", tasks.watchdog, schedule, observations.executionBoundary.value)];
    if (findings.length === 0) {
      return record("1-install", "already_in_target_state", { checkCount: observations.schedulerCheck.value.checkCount, cycleArguments: tasks.cycle.argumentLine, watchdogArguments: tasks.watchdog.argumentLine });
    }
  }
  return act("1-install", [{ kind: "install-tasks", coverageThroughDate: schedule.coverageThroughDate }], { coverageThroughDate: schedule.coverageThroughDate });
}

function step2(fold: LedgerFold, observations: Observations): Decision {
  if (!observations.certificate.known) {
    return abortAt(fold, "2-certificate", "CERTIFICATE_UNREADABLE", "The certificate file could not be read. Inspect it; a new certificate run may be needed.", { reason: observations.certificate.reason });
  }
  const certificate = observations.certificate.value;
  if (certificate === null) return wait("2-certificate: no certificate file yet");
  if (certificate.verdict !== "PASS") {
    return abortAt(fold, "2-certificate", "CERTIFICATE_NOT_PASS", "The certificate run did not pass. A new certificate run is needed before any retry.", { certificatePath: certificate.path, verdict: certificate.verdict, violations: certificate.violations });
  }
  if (!observations.deploymentDigests.known) {
    return abortAt(fold, "2-certificate", "DIGESTS_UNKNOWN", "The deployment's digests could not be printed, so the certificate cannot be matched.", { reason: observations.deploymentDigests.reason });
  }
  const deployed = observations.deploymentDigests.value;
  if (deployed.runtimeDigest !== certificate.digests.runtimeDigest || deployed.policyDigest !== certificate.digests.policyDigest) {
    return abortAt(fold, "2-certificate", "CERTIFICATE_DIGEST_MISMATCH", "The certificate does not certify this deployment: a digest differs. A new certificate run is needed.", { certificate: certificate.digests, deployed });
  }
  if (!observations.longRunArtefacts.known) {
    return abortAt(fold, "2-certificate", "LONG_RUN_STATE_UNREADABLE", "The long-run state directory could not be listed.", { reason: observations.longRunArtefacts.reason });
  }
  const forbidden = forbiddenLongRunArtefacts();
  const found = observations.longRunArtefacts.value.filter(entry => forbidden.includes(entry.toLowerCase()));
  if (found.length > 0) {
    return abortAt(fold, "2-certificate", "LONG_RUN_STATE_CONTAMINATED", "The certificate run wrote into the long-run state directory. Empty those artefacts by hand after checking them, then open a new attempt.", { found });
  }
  return record("2-certificate", "ok", { certificatePath: certificate.path, verdict: certificate.verdict, runtimeDigest: certificate.digests.runtimeDigest, policyDigest: certificate.digests.policyDigest, longRunEntries: observations.longRunArtefacts.value });
}

function step3(fold: LedgerFold, observations: Observations): Decision {
  if (!observations.devAccount.known) {
    return abortAt(fold, "3-flat", "DEV_ACCOUNT_UNKNOWN", "The dev account could not be read.", { reason: observations.devAccount.reason });
  }
  const account = observations.devAccount.value;
  if (account.positions !== 0 || account.nonTerminalOrders !== 0) {
    return abortAt(fold, "3-flat", "DEV_ACCOUNT_NOT_FLAT", "The dev account is not flat. Nothing was cancelled or closed; flatten it by hand, then open a new attempt.", { positions: account.positions, nonTerminalOrders: account.nonTerminalOrders });
  }
  return record("3-flat", "ok", { positions: 0, nonTerminalOrders: 0 });
}

function step4(fold: LedgerFold, observations: Observations, schedule: Schedule): Decision {
  if (!observations.checks.known) {
    return abortAt(fold, "4-enable", "CHECKS_UNKNOWN", "healthchecks.io could not be read before enabling.", { reason: observations.checks.reason });
  }
  const current = statuses(observations.checks.value);
  const notReady = checkNames().filter(name => current[name] !== "up" && current[name] !== "paused");
  if (notReady.length > 0) {
    return abortAt(fold, "4-enable", "CHECKS_NOT_READY", "A check is neither up nor paused before the enable.", { checkStatuses: current });
  }
  // The disarm is the second layer; it exists before the tasks it guards are enabled.
  return act("4-enable", [
    { kind: "register-disarm", at: localAt(schedule.anchorDay, 15, 5) },
    { kind: "enable-tasks", tasks: ["cycle", "watchdog"] },
  ], { checkStatuses: current });
}

function step5a(fold: LedgerFold, observations: Observations, schedule: Schedule): Decision {
  const enabledAt = resultAt(fold, "4-enable");
  if (enabledAt === null) return missingEvidence(fold, "5a-watchdog-disable", "the enable's result time");
  if (!observations.watchdogLog.known) {
    return abortAt(fold, "5a-watchdog-disable", "WATCHDOG_LOG_UNREADABLE", "watchdog-run.log could not be read.", { reason: observations.watchdogLog.reason });
  }
  if (!observations.checks.known) return checksUnreadableWait("5a-watchdog-disable", schedule, observations.checks.reason);
  if (!observations.apiIndependentRead.known) return checksUnreadableWait("5a-watchdog-disable", schedule, observations.apiIndependentRead.reason);
  // An observed firing (design point, build log): a firing line after the enable, and the check up on a ping after the enable. A paused check never goes down.
  const firing = firstFiringAfter(observations.watchdogLog.value, enabledAt);
  const watchdog = observations.checks.value.watchdog;
  if (firing === null || watchdog.status !== "up" || watchdog.lastPingUtcMs === null || watchdog.lastPingUtcMs <= enabledAt) {
    return wait("5a-watchdog-disable: waiting for a watchdog firing and its ping after the enable");
  }
  return act("5a-watchdog-disable", [{ kind: "disable-tasks", tasks: ["watchdog"] }], { enabledAtUtcMs: enabledAt, firingUtcMs: firing.utcMs, firingFile: firing.file, watchdogLastPingUtcMs: watchdog.lastPingUtcMs });
}

function step5b(fold: LedgerFold, observations: Observations, schedule: Schedule): Decision {
  const disabledAt = resultAt(fold, "5a-watchdog-disable");
  if (disabledAt === null) return missingEvidence(fold, "5b-watchdog-down", "the watchdog disable's result time");
  if (!observations.checks.known) return checksUnreadableWait("5b-watchdog-down", schedule, observations.checks.reason);
  const checks = observations.checks.value;
  const current = statuses(checks);
  // The down-set is compared as a set (ACT-50): a mixed-up ping URL shows as the wrong check going down.
  if (checks.liveness.status === "down" || checks.readiness.status === "down") {
    return abortAt(fold, "5b-watchdog-down", "DRILL_WRONG_DOWN_SET", "A check other than the watchdog went down during the watchdog drill: a ping may reach the wrong check.", { checkStatuses: current });
  }
  if (checks.watchdog.status !== "down") return wait("5b-watchdog-down: waiting for the watchdog check to go down");
  const flip = checks.watchdog.flips[0];
  if (flip === undefined || flip.up || flip.utcMs <= disabledAt) {
    return drillInvalid(fold, "5b-watchdog-down", "the watchdog check was down before its task was disabled", { disabledAtUtcMs: disabledAt, flip: flip ?? null });
  }
  if (checks.liveness.status !== "up" || checks.readiness.status !== "up") return wait("5b-watchdog-down: waiting for liveness and readiness to read up");
  if (!observations.apiIndependentRead.known) return checksUnreadableWait("5b-watchdog-down", schedule, observations.apiIndependentRead.reason);
  return record("5b-watchdog-down", "ok", { disabledAtUtcMs: disabledAt, downFlipUtcMs: flip.utcMs, checkStatuses: current });
}

function step5d(fold: LedgerFold, observations: Observations, schedule: Schedule): Decision {
  const reenabledAt = resultAt(fold, "5c-watchdog-reenable");
  if (reenabledAt === null) return missingEvidence(fold, "5d-watchdog-up", "the watchdog re-enable's result time");
  if (!observations.checks.known) return checksUnreadableWait("5d-watchdog-up", schedule, observations.checks.reason);
  const checks = observations.checks.value;
  const current = statuses(checks);
  if (checks.liveness.status === "down" || checks.readiness.status === "down") {
    return abortAt(fold, "5d-watchdog-up", "DRILL_WRONG_DOWN_SET", "A check other than the watchdog is down after the watchdog drill.", { checkStatuses: current });
  }
  const lastPing = checks.watchdog.lastPingUtcMs;
  if (checks.watchdog.status !== "up" || lastPing === null || lastPing <= reenabledAt || checks.liveness.status !== "up" || checks.readiness.status !== "up") {
    return wait("5d-watchdog-up: waiting for all three checks up, the watchdog on a ping after its re-enable");
  }
  return record("5d-watchdog-up", "ok", { reenabledAtUtcMs: reenabledAt, watchdogLastPingUtcMs: lastPing, checkStatuses: current });
}

function step6a(fold: LedgerFold, observations: Observations, schedule: Schedule): Decision {
  const upAt = resultAt(fold, "5d-watchdog-up");
  if (upAt === null) return missingEvidence(fold, "6a-silence-disable", "the watchdog drill's result time");
  if (!observations.tasks.known) return abortAt(fold, "6a-silence-disable", "TASKS_UNKNOWN", "The tasks could not be read.", { reason: observations.tasks.reason });
  const tasks = observations.tasks.value;
  if (tasks.cycle.state === "Running" || tasks.watchdog.state === "Running") return wait("6a-silence-disable: a wrapper is running; disabling now would put its lines inside the silence window");
  if (!observations.checks.known) return checksUnreadableWait("6a-silence-disable", schedule, observations.checks.reason);
  if (!observations.apiIndependentRead.known) return checksUnreadableWait("6a-silence-disable", schedule, observations.apiIndependentRead.reason);
  const checks = observations.checks.value;
  const lastPings: Record<string, number | null> = {};
  let allPinged = true;
  for (const name of checkNames()) {
    const check = checks[name];
    lastPings[name] = check.lastPingUtcMs;
    if (check.status !== "up" || check.lastPingUtcMs === null || check.lastPingUtcMs <= upAt) allPinged = false;
  }
  if (!allPinged) return wait("6a-silence-disable: waiting for all three checks up on a ping after the watchdog drill");
  return act("6a-silence-disable", [{ kind: "disable-tasks", tasks: ["cycle", "watchdog"] }], { watchdogDrillEndedUtcMs: upAt, lastPingUtcMs: lastPings });
}

function step6b(fold: LedgerFold, observations: Observations, schedule: Schedule): Decision {
  const silencedAt = resultAt(fold, "6a-silence-disable");
  if (silencedAt === null) return missingEvidence(fold, "6b-silence-down", "the silence disable's result time");
  const base = { silencedAtUtcMs: silencedAt, inFlightToleranceMs: IN_FLIGHT_TOLERANCE_MS, logFilesSearched: observations.logFilesSearched };
  // The local discriminator first, because it can invalidate the drill before the checks go down.
  if (!observations.cycleLog.known || !observations.watchdogLog.known) {
    return drillInvalid(fold, "6b-silence-down", "the wrapper logs could not be read", base);
  }
  const intruders = [
    ...linesInWindow(observations.cycleLog.value, silencedAt + IN_FLIGHT_TOLERANCE_MS, observations.nowUtcMs),
    ...linesInWindow(observations.watchdogLog.value, silencedAt + IN_FLIGHT_TOLERANCE_MS, observations.nowUtcMs),
  ];
  if (intruders.length > 0) {
    return drillInvalid(fold, "6b-silence-down", "a wrapper wrote log lines inside the silence window", { ...base, intruders: intruders.map(line => ({ file: line.file, utcMs: line.utcMs, shape: line.shape })) });
  }
  if (!observations.checks.known) return checksUnreadableWait("6b-silence-down", schedule, observations.checks.reason);
  const checks = observations.checks.value;
  const downFlips: Record<string, number> = {};
  for (const name of checkNames()) {
    const check = checks[name];
    if (check.status !== "down") continue;
    const flip = check.flips[0];
    if (flip === undefined || flip.up || flip.utcMs <= silencedAt) {
      return drillInvalid(fold, "6b-silence-down", `${name} was down before the tasks were disabled`, { ...base, check: name, flip: flip ?? null });
    }
    downFlips[name] = flip.utcMs;
  }
  if (Object.keys(downFlips).length < checkNames().length) return wait("6b-silence-down: waiting for all three checks to go down");
  if (!observations.apiIndependentRead.known) {
    return drillInvalid(fold, "6b-silence-down", "the independent API read failed", { ...base, reason: observations.apiIndependentRead.reason });
  }
  return record("6b-silence-down", "ok", { ...base, downFlipUtcMs: downFlips });
}

function step8(fold: LedgerFold, observations: Observations): Decision {
  if (!observations.checks.known) {
    return abortAt(fold, "8-reboot", "CHECKS_UNKNOWN", "healthchecks.io could not be read before the reboot.", { reason: observations.checks.reason });
  }
  const current = statuses(observations.checks.value);
  if (checkNames().some(name => current[name] !== "up")) {
    return abortAt(fold, "8-reboot", "CHECKS_NOT_UP", "The checks the silence drill cleared are not all up, so the gate could not turn green. Nothing was rebooted.", { checkStatuses: current });
  }
  return act("8-reboot", [{ kind: "restart" }], { checkStatuses: current });
}

function step7(fold: LedgerFold, observations: Observations): Decision {
  const recorded = recordedStringRecord(fold, "0-preflight", "hostPreconditions");
  if (recorded === null) return missingEvidence(fold, "7-rearm", "the host preconditions step 0 recorded");
  if (!observations.hostPreconditions.known) {
    return abortAt(fold, "7-rearm", "HOST_PRECONDITIONS_UNKNOWN", "The host preconditions could not be re-read before the re-arm.", { reason: observations.hostPreconditions.reason });
  }
  const changed = sameRecord(recorded, observations.hostPreconditions.value);
  if (changed.length > 0) {
    return abortAt(fold, "7-rearm", "HOST_PRECONDITIONS_CHANGED", "A host precondition changed since step 0; the evidence names it.", { changed });
  }
  return act("7-rearm", [{ kind: "enable-tasks", tasks: ["cycle", "watchdog"] }], { hostPreconditions: observations.hostPreconditions.value });
}

/**
 * Step 9's session samples (design point, build log): the proof brackets the 14:00
 * firing with the last sample of 13:50–13:59 and the first of 14:00–14:10, both
 * taken after the boot. Neither may show an interactive session or an explorer.
 */
function bracketingSamples(samples: readonly SessionSample[], date: string, bootUtcMs: number): { readonly before: SessionSample | null; readonly after: SessionSample | null } {
  const afterBoot = samples.filter(sample => sample.utcMs > bootUtcMs && sample.local.date === date);
  const before = afterBoot.filter(sample => sample.local.minute >= 13 * 60 + 50 && sample.local.minute < 14 * 60).at(-1) ?? null;
  const after = afterBoot.find(sample => sample.local.minute >= 14 * 60 && sample.local.minute <= 14 * 60 + 10) ?? null;
  return { before, after };
}

function step9(fold: LedgerFold, observations: Observations, schedule: Schedule): Decision {
  const bootUtcMs = recordedNumber(fold, "8-reboot", "bootUtcMs");
  if (bootUtcMs === null) return missingEvidence(fold, "9-proof", "the boot time step 8 recorded");
  if (!observations.cycleLog.known) {
    return abortAt(fold, "9-proof", "CYCLE_LOG_UNREADABLE", "cycle-run.log could not be read, so the 14:00 firing cannot be proven.", { reason: observations.cycleLog.reason });
  }
  const { before, after } = bracketingSamples(observations.sessionSamples, schedule.anchorDay, bootUtcMs);
  if (before === null) {
    return abortAt(fold, "9-proof", "SESSION_SAMPLE_MISSING", "No session sample was taken between 13:50 and 14:00 after the boot, so signed-out execution cannot be proven. Retry on the next trading day.", { bootUtcMs });
  }
  const signedIn = [before, after].filter(sample => sample !== null && (sample.interactiveSessions > 0 || sample.explorerProcesses > 0));
  if (signedIn.length > 0) {
    return abortAt(fold, "9-proof", "SESSION_PRESENT", "Someone was signed in around the 14:00 firing, so it does not prove signed-out execution. Retry on the next trading day with nobody signed in.", { before, after });
  }
  const firing = firingAt(observations.cycleLog.value, schedule.anchorDay, 14 * 60, 14 * 60 + 4, ["run", "skip"]);
  if (firing === null || after === null) return wait("9-proof: waiting for the 14:00 firing and a session sample after it");
  return record("9-proof", "ok", { firing: { file: firing.file, utcMs: firing.utcMs, shape: firing.shape }, localWindow: "14:00-14:04", logFilesSearched: observations.logFilesSearched, sessionSamples: { before, after }, bootUtcMs });
}

function step10(fold: LedgerFold, observations: Observations, schedule: Schedule): Decision {
  const path = recordedString(fold, "2-certificate", "certificatePath");
  if (path === null) return missingEvidence(fold, "10-gate", "the certificate path step 2 validated");
  const unknown: string[] = [];
  const red: string[] = [];
  const checkAgeMs = observations.nowUtcMs - observations.checksObservedAtUtcMs;
  if (checkAgeMs < 0 || checkAgeMs > GATE_CHECK_MAX_AGE_MS) red.push(`checks.stale:${String(checkAgeMs)}`);
  const verifier = observations.schedulerCheckExpectEnabled;
  if (!verifier.known) unknown.push(`scheduler-check: ${verifier.reason}`);
  else if (!verifier.value.passed || verifier.value.failedChecks !== 0) red.push(`scheduler-check.failed:${String(verifier.value.failedChecks)}`);
  if (!observations.checks.known) {
    unknown.push(`checks: ${observations.checks.reason}`);
  } else {
    const current = statuses(observations.checks.value);
    for (const name of checkNames()) if (current[name] !== "up") red.push(`checks.${name}.status:${current[name]}`);
  }
  // Owner ruling 2026-09-14: the gate is the last moment before arming to find a token that died since step 0.
  if (!observations.analyst.known) unknown.push(`analyst: ${observations.analyst.reason}`);
  else if (!observations.analyst.value.tokenLive) red.push("analyst.token-not-live");
  // Today's intent, not an earlier attempt's: the fold scopes step 8 to this attempt, and the gate re-checks the recorded pair.
  const reboot = fold.steps["8-reboot"];
  const bootUtcMs = recordedNumber(fold, "8-reboot", "bootUtcMs");
  if (reboot === undefined || reboot.attempt !== fold.currentAttempt?.id || reboot.intentAtUtcMs === null || bootUtcMs === null || bootUtcMs <= reboot.intentAtUtcMs) {
    red.push("reboot.not-proven-for-this-attempt");
  }
  if (unknown.length > 0 || red.length > 0) {
    return abortAt(fold, "10-gate", "GATE_RED", "The gate is not green; the evidence names each failing condition. Nothing was armed.", { unknown, red });
  }
  const minuteStartUtcMs = observations.nowUtcMs - ((observations.nowUtcMs % 60_000) + 60_000) % 60_000;
  const canonicalGateDeadlineUtcMs = minuteStartUtcMs + (14 * 60 + 55 - observations.nowLocal.minute) * 60_000;
  if (schedule.gateNotAfterUtcMs !== canonicalGateDeadlineUtcMs) {
    return abortAt(fold, "10-gate", "SCHEDULE_DEADLINE_INVALID", "The supplied absolute gate deadline does not match 14:55 on the anchor day.", { suppliedUtcMs: schedule.gateNotAfterUtcMs, canonicalUtcMs: canonicalGateDeadlineUtcMs });
  }
  const checkCount = verifier.known ? verifier.value.checkCount : null;
  return act("10-gate", [
    { kind: "write-certificate-line", path, observedAtUtcMs: observations.checksObservedAtUtcMs, leaseNotAfterUtcMs: observations.checksObservedAtUtcMs + GATE_CHECK_MAX_AGE_MS, scheduleNotAfterUtcMs: schedule.gateNotAfterUtcMs, expectedChecks: observations.checks.known ? observations.checks.value : {} as Readonly<Record<CheckName, CheckObservation>>, expectedDigests: observations.deploymentDigests.known ? observations.deploymentDigests.value : { runtimeDigest: "", policyDigest: "" } },
    { kind: "delete-disarm" },
  ], { certificatePath: path, schedulerCheckCount: checkCount, bootUtcMs, checksObservedAtUtcMs: observations.checksObservedAtUtcMs, decisionUtcMs: observations.nowUtcMs });
}

function step11(fold: LedgerFold, observations: Observations, schedule: Schedule): Decision {
  if (!observations.cycleLog.known) {
    return abortAt(fold, "11-anchor", "CYCLE_LOG_UNREADABLE", "cycle-run.log could not be read, so the anchor firing cannot be recorded. The run stays armed; check it by hand.", { reason: observations.cycleLog.reason });
  }
  if (!observations.bootstrapEntry.known) {
    return abortAt(fold, "11-anchor", "JOURNAL_UNREADABLE", "The long-run journal could not be read. The run stays armed; check it by hand.", { reason: observations.bootstrapEntry.reason });
  }
  const firing = firingAt(observations.cycleLog.value, schedule.anchorDay, 15 * 60 + 15, 15 * 60 + 19, ["run"]);
  const bootstrap = observations.bootstrapEntry.value;
  if (firing === null || bootstrap === null) return wait("11-anchor: waiting for the 15:15 firing and the BOOTSTRAP entry");
  const gateAt = resultAt(fold, "10-gate");
  const watchdogLines = gateAt === null || !observations.watchdogLog.known ? null : observations.watchdogLog.value;
  const watchdogLine = gateAt === null || watchdogLines === null ? null : firstFiringAfter(watchdogLines, gateAt);
  // Spec §8.12: the drills measured a degraded watchdog; the first composition line after the gate says which one runs now. Recorded, not required.
  const composition = gateAt === null || watchdogLines === null ? null : watchdogLines.find(line => line.utcMs > gateAt && line.composition !== null) ?? null;
  return record("11-anchor", "ok", {
    firing: { file: firing.file, utcMs: firing.utcMs },
    localWindow: "15:15-15:19",
    bootstrap,
    firstWatchdogFiringAfterGate: watchdogLine === null ? null : { file: watchdogLine.file, utcMs: watchdogLine.utcMs },
    firstWatchdogCompositionAfterGate: composition === null ? null : { file: composition.file, utcMs: composition.utcMs, composition: composition.composition },
  });
}

function decideStep(step: StepId, fold: LedgerFold, observations: Observations, schedule: Schedule): Decision {
  switch (step) {
    case "0-preflight": return step0(fold, observations, schedule);
    case "1-install": return step1(fold, observations, schedule);
    case "2-certificate": return step2(fold, observations);
    case "3-flat": return step3(fold, observations);
    case "4-enable": return step4(fold, observations, schedule);
    case "5a-watchdog-disable": return step5a(fold, observations, schedule);
    case "5b-watchdog-down": return step5b(fold, observations, schedule);
    case "5c-watchdog-reenable": return act("5c-watchdog-reenable", [{ kind: "enable-tasks", tasks: ["watchdog"] }], {});
    case "5d-watchdog-up": return step5d(fold, observations, schedule);
    case "6a-silence-disable": return step6a(fold, observations, schedule);
    case "6b-silence-down": return step6b(fold, observations, schedule);
    // Readiness through readiness-cli.js, liveness and watchdog by a success ping; both tasks stay disabled.
    case "6c-silence-clear": return act("6c-silence-clear", [{ kind: "clear-checks" }], {});
    case "8-reboot": return step8(fold, observations);
    case "7-rearm": return step7(fold, observations);
    case "9-proof": return step9(fold, observations, schedule);
    case "10-gate": return step10(fold, observations, schedule);
    case "11-anchor": return step11(fold, observations, schedule);
  }
}

// ---------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------

export function decide(fold: LedgerFold, observations: Observations, schedule: Schedule): Decision {
  if (fold.integrity !== "intact" || fold.inconsistencies.length > 0) {
    const reason = fold.integrity === "intact" ? "LEDGER_INCONSISTENT" : `LEDGER_${fold.integrity.toUpperCase()}`;
    return { kind: "abort", step: null, reason, teardown: fullTeardown(), nextOwnerAction: "The ledger cannot be trusted as it stands. Read the world, record a correction naming the damaged line, and open a new attempt.", evidence: { integrity: fold.integrity, inconsistencies: fold.inconsistencies, corrections: fold.corrections } };
  }
  const attempt = fold.currentAttempt;
  if (attempt === null) {
    return { kind: "abort", step: null, reason: "LEDGER_EMPTY", teardown: fullTeardown(), nextOwnerAction: "No attempt is open. Open one for the intended anchor day.", evidence: {} };
  }
  if (fold.attemptEnded !== null) {
    return { kind: "ended", seq: fold.attemptEnded.seq, reason: `attempt ${attempt.id} ended at seq ${String(fold.attemptEnded.seq)}${fold.attemptEnded.byOwner ? " by the owner" : ""}` };
  }
  if (attempt.anchorDay !== schedule.anchorDay) {
    return { kind: "abort", step: null, reason: "SCHEDULE_NOT_FOR_THIS_ATTEMPT", teardown: fullTeardown(), nextOwnerAction: "The invocation was given a schedule for another anchor day than the open attempt's. Check the activation task's arguments.", evidence: { attemptAnchorDay: attempt.anchorDay, scheduleAnchorDay: schedule.anchorDay } };
  }

  // A certificate is an append-only fact about one deployment, not a permanent
  // waiver for every later attempt. Once a fresh deployment/certificate pair
  // proves different digests, the earlier attempt's step 2 stops carrying into
  // this attempt and the new valid certificate can be recorded as a new result.
  const carriedCertificate = fold.steps["2-certificate"];
  const carriedCertificatePath = recordedString(fold, "2-certificate", "certificatePath");
  const carriedRuntimeDigest = recordedString(fold, "2-certificate", "runtimeDigest");
  const carriedPolicyDigest = recordedString(fold, "2-certificate", "policyDigest");
  const certificateChanged = carriedCertificate !== undefined
    && carriedCertificate.attempt !== attempt.id
    && carriedCertificatePath !== null
    && carriedRuntimeDigest !== null
    && carriedPolicyDigest !== null
    && observations.deploymentDigests.known
    && observations.certificate.known
    && observations.certificate.value !== null
    && (carriedRuntimeDigest !== observations.deploymentDigests.value.runtimeDigest
      || carriedPolicyDigest !== observations.deploymentDigests.value.policyDigest)
    && observations.certificate.value.verdict === "PASS"
    && observations.certificate.value.digests.runtimeDigest === observations.deploymentDigests.value.runtimeDigest
    && observations.certificate.value.digests.policyDigest === observations.deploymentDigests.value.policyDigest;
  const effectiveFold: LedgerFold = certificateChanged
    ? { ...fold, steps: Object.fromEntries(Object.entries(fold.steps).filter(([step]) => step !== "2-certificate")) }
    : fold;

  const step = nextStep(effectiveFold);
  if (step === null) return { kind: "done", reason: `activation complete for anchor day ${attempt.anchorDay}` };

  const world = worldFindings(effectiveFold, observations, schedule);
  if (world.red.length > 0 || world.unknown.length > 0) {
    return abortAt(fold, step, world.red.length > 0 ? "WORLD_MISMATCH" : "WORLD_UNKNOWN", "The world does not match the phase the ledger is in; the evidence names each difference. Nothing further was changed.", { unknown: world.unknown, red: world.red });
  }

  if (effectiveFold.interrupted !== null) return closeInterrupted(effectiveFold, effectiveFold.interrupted, observations, schedule);

  const state = effectiveFold.steps[step];
  if (state !== undefined && state.attempt === attempt.id && (state.outcome === "failed" || state.outcome === "unknown")) {
    return abortAt(fold, step, "STEP_FAILED", `Step ${step} came back ${state.outcome} in this attempt. Read its evidence and the world before a retry.`, { resultSeq: state.resultSeq, resultEvidence: state.resultEvidence });
  }

  const window = stepWindow(step, schedule);
  if (compareLocal(observations.nowLocal, window.notValidAfter) > 0) {
    return abortAt(fold, step, "STEP_DEADLINE_MISSED", `Step ${step} was not valid after ${formatLocal(window.notValidAfter)}. Retry on the next trading day.`, { nowLocal: formatLocal(observations.nowLocal), notValidAfter: formatLocal(window.notValidAfter) });
  }
  if (window.opens !== null && compareLocal(observations.nowLocal, window.opens) < 0) {
    return wait(`${step} opens at ${formatLocal(window.opens)}`);
  }
  return decideStep(step, effectiveFold, observations, schedule);
}
