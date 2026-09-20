// The vocabulary of the activation core (docs/P12-ACTIVATION-SPEC.md, rev 9).
//
// Everything the core decides is a function of three inputs, and all three are
// declared here: the ledger (what was done), a snapshot of observations (what the
// world looks like now), and the schedule (which days the attempt is about).
// Nothing in this file has a runtime value, so it cannot trip the architecture
// gate; the rules that the gate enforces on src/core apply to the modules that
// import it.

/**
 * A step of the activation. The identifiers carry the spec's numbers so that a
 * ledger line can be traced to the table row it executes. Steps 5 and 6 are
 * split into their phases because each phase is its own invocation: a drill
 * disables, waits for an observation minutes later, re-enables, and waits again,
 * and every one of those moments must be reconstructible from the ledger alone.
 */
export type StepId =
  | "0-preflight"
  | "1-install"
  | "2-certificate"
  | "3-flat"
  | "4-enable"
  | "5a-watchdog-disable"
  | "5b-watchdog-down"
  | "5c-watchdog-reenable"
  | "5d-watchdog-up"
  | "6a-silence-disable"
  | "6b-silence-down"
  | "6c-silence-clear"
  | "7-rearm"
  | "8-reboot"
  | "9-proof"
  | "10-gate"
  | "11-anchor";

export type EntryKind = "intent" | "result" | "observation" | "correction" | "abort" | "note";

export type Outcome = "ok" | "failed" | "already_in_target_state" | "unknown";

/** A wall-clock moment in Europe/Berlin, as the shell converted it. The core never converts time zones. */
export interface LocalInstant {
  /** `YYYY-MM-DD`; compares correctly as a string. */
  readonly date: string;
  /** Minutes since local midnight, 0..1439. */
  readonly minute: number;
}

/** One ledger line. Field names follow the spec's §4; `anchorDay` scopes results to the day they are about. */
export interface LedgerEntry {
  readonly seq: number;
  /** ISO 8601 with offset, exactly as written. */
  readonly at: string;
  /** The same instant in UTC milliseconds, parsed by the shell when it read the line. */
  readonly atUtcMs: number;
  readonly attempt: string;
  /** The anchor day this attempt is for, `YYYY-MM-DD`. */
  readonly anchorDay: string;
  readonly step: StepId | null;
  readonly kind: EntryKind;
  readonly outcome: Outcome | null;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly nextOwnerAction: string | null;
}

/**
 * A reading of the world that may have failed. Axiom A1 of the spec: unknown is
 * never green, so every observation the core consumes carries the possibility
 * that it could not be taken, and the reason why. A reader keeps the reason free
 * of credentials; the ledger codec refuses secret shapes as the backstop.
 */
export type Reading<T> =
  | { readonly known: true; readonly value: T }
  | { readonly known: false; readonly reason: string };

export type TaskName = "cycle" | "watchdog";

/** A scheduled task as registered: its state and its action line verbatim, which the core parses by value. */
export interface TaskObservation {
  readonly state: string;
  readonly userId: string | null;
  readonly userSid: string | null;
  readonly runLevel: string | null;
  readonly logonType: string | null;
  readonly startWhenAvailable: boolean | null;
  readonly actions: readonly TaskAction[];
  /** First action convenience fields retained for the decision helpers. */
  readonly execute: string;
  readonly argumentLine: string;
}

export interface TaskAction {
  readonly execute: string;
  readonly argumentLine: string;
  readonly workingDirectory: string | null;
}

/** Executables and principal derived by the reader from this process and the trusted Windows host. */
export interface ExecutionBoundary {
  readonly nodePath: string;
  readonly powerShellPath: string;
  readonly taskUserId: string;
  readonly taskUserSid: string;
}

export type CheckName = "liveness" | "readiness" | "watchdog";

export interface CheckFlip {
  readonly utcMs: number;
  readonly up: boolean;
}

/** One healthchecks.io check, identified by name and `hc:` fingerprint — never by URL or UUID. */
export interface CheckObservation {
  readonly fingerprint: string;
  readonly status: string;
  readonly lastPingUtcMs: number | null;
  /** Newest first, as the API returns them. */
  readonly flips: readonly CheckFlip[];
}

export interface EnvObservation {
  readonly certificatePath: string | null;
  readonly profile: string | null;
  /**
   * The `STATE_DIR` the runtime would see — user over machine over `.env`, the same
   * precedence as the two above. It is observed so that the core can hold it against the
   * directory `config/deployment.json` declares: the wrappers write their logs where this
   * value points and the activation reads where the declaration points, and nothing used
   * to compare the two (G-7 / R2-18).
   */
  readonly stateDir: string | null;
  /** SHA-256 of the file's bytes. */
  readonly hash: string;
  readonly duplicateKeys: readonly string[];
  /** Keys whose value in the user or machine environment would override `.env` for the runtime (owner ruling 2026-09-14). */
  readonly shadowedKeys: readonly string[];
}

export interface DigestPair {
  readonly runtimeDigest: string;
  readonly policyDigest: string;
}

/**
 * A certificate file as the runtime's own arming gate would judge it. `verdict` is
 * `PASS` only when `validateArmingCertificate` accepted the whole document against
 * this deployment — exact schema, evidence digest, dev role, canonical origin, both
 * digests (review of 2026-09-14, point 1). A document that merely says PASS and
 * fails that validation reads `REJECTED`, with the validator's violations.
 */
export interface CertificateObservation {
  readonly path: string;
  readonly verdict: string;
  readonly digests: DigestPair;
  readonly violations: readonly string[];
}

export interface DevAccountObservation {
  readonly positions: number;
  readonly nonTerminalOrders: number;
}

/** A wrapper log line the shell parsed: its UTC stamp, the same moment in local time, and which shape it had. */
export interface LogLine {
  readonly file: string;
  readonly utcMs: number;
  readonly local: LocalInstant;
  readonly shape: "run" | "skip" | "other";
  /**
   * For a watchdog `output:` line that carries the runtime's composition log line (spec §8.12): `armed`
   * when book recovery is armed, `degraded` when the watchdog can only fence and halt; null otherwise.
   */
  readonly composition: "armed" | "degraded" | null;
}

/**
 * One sample of who is signed in. The shell takes one on every invocation and
 * appends it to its own sample log without judging it — like a wrapper log line —
 * so that step 9 can find the samples around the 14:00 firing, which were taken
 * by earlier invocations.
 */
export interface SessionSample {
  readonly utcMs: number;
  readonly local: LocalInstant;
  readonly interactiveSessions: number;
  readonly explorerProcesses: number;
}

/**
 * The human confirmation of gate condition 4, as `activation confirm-alerts` recorded
 * it (owner ruling and review, 2026-09-14). Three checks send three down alerts, so
 * each has its own receipt time — or one mail named all three, which `bundledAlert`
 * states. The reminder's receipt time comes with the checks the reminder listed. The
 * command assigned each check the down flip its alert belongs to; step 0 repeats that
 * cross-check against the live flip history and dates the confirmation by its oldest
 * receipt.
 */
export interface AlertConfirmation {
  readonly operator: string;
  readonly alertReceivedUtcMs: Readonly<Record<CheckName, number>>;
  readonly bundledAlert: boolean;
  readonly reminderReceivedUtcMs: number;
  readonly reminderListed: readonly CheckName[];
  readonly fingerprints: Readonly<Record<CheckName, string>>;
  readonly downFlipUtcMs: Readonly<Record<CheckName, number>>;
}

/** Step 0's analyst precondition: the token the gate's digest re-print needs, one analyst child started and verified, and the token proven live. */
export interface AnalystObservation {
  readonly oauthTokenPresent: boolean;
  readonly childStartVerified: boolean;
  /** A minimal Claude call with the token succeeded now (owner ruling 2026-09-14): present is not live. */
  readonly tokenLive: boolean;
  /** The probe's normalised failure class when it did not succeed; null when it did. */
  readonly tokenProbeClass: string | null;
}

/** What `verify-scheduled-tasks.ps1` printed: the verdict line and its counts. */
export interface SchedulerCheckObservation {
  readonly passed: boolean;
  readonly checkCount: number;
  readonly failedChecks: number;
}

/**
 * The disarm one-shot, judged by what it would do and not only by when (review of
 * 2026-09-14, point 2): its trigger, its state — a disabled one-shot never fires —
 * and every action it carries, verbatim.
 */
export interface DisarmObservation {
  readonly registered: boolean;
  readonly fires: LocalInstant | null;
  readonly state: string | null;
  readonly actions: readonly TaskAction[];
  /**
   * `Principal.RunLevel`, `Principal.LogonType` and `Settings.StartWhenAvailable` as the scheduler
   * prints them (review of 2026-09-14, point 4); null when the reading carried none.
   */
  readonly runLevel: string | null;
  readonly logonType: string | null;
  readonly startWhenAvailable: boolean | null;
  readonly userId: string | null;
  readonly userSid: string | null;
}

/** The long-run journal's `BOOTSTRAP` entry, which step 11 records as the start of the measurement period. */
export interface JournalBootstrapObservation {
  readonly seq: number;
  readonly utcMs: number;
}

/**
 * The deployment wrapper files, all outside the runtime digest and each carrying its own
 * safety claims. `run-log.psm1` joined them on 2026-09-19: the logging both wrappers do is
 * one shared module since then, so the code that used to sit inside the two hashed files
 * would otherwise have moved out from under step 0's integrity check
 * (docs/P12-STOP-AND-LOG-CONTRACTS.md, LC-8).
 */
export type WrapperName = "cycle-run.ps1" | "watchdog-run.ps1" | "run-log.psm1" | "watchdog-bootstrap.psm1";

/** Everything one invocation observed, taken before the core is asked anything. */
export interface Observations {
  readonly nowUtcMs: number;
  readonly nowLocal: LocalInstant;
  readonly tasks: Reading<Readonly<Record<TaskName, TaskObservation>>>;
  readonly checks: Reading<Readonly<Record<CheckName, CheckObservation>>>;
  /** Timestamp taken immediately after the management API returned. */
  readonly checksObservedAtUtcMs: number;
  /** Runtime trust roots, derived rather than supplied by an activation attempt. */
  readonly executionBoundary: Reading<ExecutionBoundary>;
  /** A management-API read the drills do not touch; its success is the independent proof that the API path works. */
  readonly apiIndependentRead: Reading<true>;
  readonly env: Reading<EnvObservation>;
  readonly resolvedAccountMasked: Reading<string>;
  readonly deploymentDigests: Reading<DigestPair>;
  readonly certificate: Reading<CertificateObservation | null>;
  readonly devAccount: Reading<DevAccountObservation>;
  readonly bootUtcMs: Reading<number>;
  readonly cycleLog: Reading<readonly LogLine[]>;
  readonly watchdogLog: Reading<readonly LogLine[]>;
  readonly logFilesSearched: readonly string[];
  readonly sessionSamples: readonly SessionSample[];
  /** SHA-256 of each deployment wrapper, by name (review of 2026-09-14, point 6). */
  readonly wrapperHashes: Reading<Readonly<Record<WrapperName, string>>>;
  /** The measured host preconditions of §3, as name → value; step 0 records them and later steps compare. */
  readonly hostPreconditions: Reading<Readonly<Record<string, string>>>;
  /** Known null when no confirmation was ever recorded; unknown when the file could not be read or its latest line does not parse (A1). */
  readonly alertConfirmation: Reading<AlertConfirmation | null>;
  /** The top-level entry names of the long-run state directory. */
  readonly longRunArtefacts: Reading<readonly string[]>;
  readonly freeDiskBytes: Reading<number>;
  readonly analyst: Reading<AnalystObservation>;
  /** The verifier run without `-ExpectEnabled`. The shell takes both runs on every invocation; the core picks. */
  readonly schedulerCheck: Reading<SchedulerCheckObservation>;
  /** The verifier run with `-ExpectEnabled`, which the gate requires. */
  readonly schedulerCheckExpectEnabled: Reading<SchedulerCheckObservation>;
  readonly disarm: Reading<DisarmObservation>;
  readonly bootstrapEntry: Reading<JournalBootstrapObservation | null>;
}

/** The parameters of one attempt. The shell computes the dates from the anchor day; the core only compares them. */
export interface Schedule {
  /** The trading day of the certificate run and the drills, `YYYY-MM-DD`. */
  readonly certificateDay: string;
  /** The calendar day after `certificateDay`, into which the silence drill runs. */
  readonly drillNightDay: string;
  /** The day of the reboot, the gate and the first regular cycle. */
  readonly anchorDay: string;
  /** The exact UTC instant at which step 10's authority ends; equality is still valid. */
  readonly gateNotAfterUtcMs: number;
  /** The masked id of the long-run account the gate expects. */
  readonly longRunAccountMasked: string;
  /** The coverage date the installer is given, `YYYY-MM-DD` (spec §5, step 1). */
  readonly coverageThroughDate: string;
  /** The host preconditions of spec §3 as step 0 must find them, name → value. */
  readonly expectedHostPreconditions: Readonly<Record<string, string>>;
  readonly minFreeDiskBytes: number;
  /** The repository root the disarm one-shot's CLI lives under, as registered. */
  readonly repoRoot: string;
  /** The activation state root the disarm one-shot reads the ledger from. */
  readonly activationRoot: string;
  /**
   * The long run's state directory as `config/deployment.json` declares it — the
   * yardstick for `EnvObservation.stateDir`, which is the same fact stated a second
   * time in `.env`. The core only compares the two; establishing either is the
   * shell's work (G-7 / R2-18).
   */
  readonly longRunStateDir: string;
}

/** What the shell is asked to do to the world. Each variant is one effect; nothing else may change it. */
export type WorldAction =
  | { readonly kind: "remove-certificate-line" }
  | { readonly kind: "write-certificate-line"; readonly path: string; readonly observedAtUtcMs: number; readonly leaseNotAfterUtcMs: number; readonly scheduleNotAfterUtcMs: number; readonly expectedChecks: Readonly<Record<CheckName, CheckObservation>>; readonly expectedDigests: DigestPair }
  | { readonly kind: "enable-tasks"; readonly tasks: readonly TaskName[] }
  | { readonly kind: "disable-tasks"; readonly tasks: readonly TaskName[] }
  /** Re-register both tasks with the installer, then run the verifier; the action fails unless both exit 0. */
  | { readonly kind: "install-tasks"; readonly coverageThroughDate: string }
  | { readonly kind: "register-disarm"; readonly at: LocalInstant }
  | { readonly kind: "delete-disarm" }
  | { readonly kind: "restart" }
  | { readonly kind: "clear-checks" };

/**
 * The answer to one invocation.
 * - `act`: write an `intent` carrying `evidence`, apply the actions in order and stop
 *   at the first that fails, then write a `result` carrying `evidence` plus what the
 *   actions reported — `ok` when all applied, `failed` otherwise. Whether an applied
 *   action took effect is judged by the next invocation, against the expectation of
 *   the phase the result puts the ledger in.
 * - `record`: nothing to change; write one `result` with this outcome.
 * - `wait`: nothing is due yet; record nothing unless the reason is new.
 * - `abort`: write an `abort` entry, which ends the attempt, and page. `teardown` is
 *   **the action list the abort owes the world**, not a flag that it owes one: spec §5
 *   says every abort up to and including the gate "disables both tasks, leaves
 *   `PRE_ARM_CERTIFICATE` unset and pages", and that is two actions, not one. It is
 *   empty once the gate has armed the run, whose teardown is the owner's decision.
 *   It carries the list rather than a boolean because a boolean has to be turned back
 *   into actions by whoever reads it, and four call sites each did that differently —
 *   one of them by omitting the certificate line entirely, which left the arming
 *   credential on disk after an abort that reported success.
 * - `ended`: the attempt was ended by an earlier abort; do nothing at all.
 * - `done`: the activation is complete for this anchor day.
 */
export type Decision =
  | { readonly kind: "act"; readonly step: StepId; readonly actions: readonly WorldAction[]; readonly evidence: Readonly<Record<string, unknown>> }
  | { readonly kind: "record"; readonly step: StepId; readonly outcome: Outcome; readonly evidence: Readonly<Record<string, unknown>> }
  | { readonly kind: "wait"; readonly reason: string }
  | { readonly kind: "abort"; readonly step: StepId | null; readonly reason: string; readonly teardown: readonly WorldAction[]; readonly nextOwnerAction: string; readonly evidence: Readonly<Record<string, unknown>> }
  | { readonly kind: "ended"; readonly seq: number; readonly reason: string }
  | { readonly kind: "done"; readonly reason: string };
