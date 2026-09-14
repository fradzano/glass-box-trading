// One invocation's observations, from the host readers (build log, unit 7). This is the
// reading half of the imperative shell: it calls thin I/O ports, hands everything they return
// to the pure parsers, and decides nothing about the activation. Every field of
// `Observations` comes out of here, known or unknown with a reason; a reading this invocation
// did not take says so rather than pretending (A1).
//
// The ports are handed in: `host-ports.ts` binds them to this host, the tests bind them to
// recorded host output. The one write is the session sample log (build log, unit 5, design
// point 3), one line per invocation, appended before the log is read back.
//
// Three readings are costly and are taken only when the plan asks for them: the dev
// `--preflight`, which prints both digests and proves the analyst child starts but builds a
// whole dev runtime to do so; the live-token probe, one Claude call on the owner's quota; and
// the dev account's book. Which invocation needs which is the CLI's to say (unit 10), from the
// step the ledger is in — the core reads the digests on every invocation after step 2, the
// analyst only at step 0 and at the gate, the dev account only at step 3.
import path from "node:path";
import type { AnalystObservation, AlertConfirmation, CertificateObservation, DevAccountObservation, DigestPair, EnvObservation, JournalBootstrapObservation, LogLine, Observations, Reading, SchedulerCheckObservation, SessionSample, WrapperName } from "../core/types.ts";
import type { ProbeOutcome } from "./analyst-probe.ts";
import type { HealthchecksReading } from "./healthchecks-io.ts";
import { combineChecks } from "./parse-healthchecks.ts";
import type { JournalCodec } from "./parse-host.ts";
import { analystObservation, latestCertificateName, maskAccountId, parseEnvironmentShadow, parseHostPreconditions, parseJournalHead, parseSessionSampleLog, sessionSampleLine } from "./parse-host.ts";
import type { CertificateValidator, LogFile, PreflightReport, TaskNames } from "./parse.ts";
import { berlinLocal, parseAlertConfirmations, parseBootInstant, parseCertificateFile, parseDisarm, parseEnv, parsePreflightOutput, parseSessionProbe, parseTasks, parseVerifierOutput, parseWrapperLogs } from "./parse.ts";

/** The read-only PowerShell readers in `readers/host/`. */
export type HostScript = "tasks" | "boot" | "sessions" | "preconditions" | "environment";

/** A command that ran: its exit code, or null when it did not finish (timeout, could not start), and what it printed. */
export interface CommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
}

/** A file read: its text and the SHA-256 of its bytes, or that it does not exist, or why it could not be read. */
export type FileRead =
  | { readonly kind: "text"; readonly text: string; readonly sha256: string }
  | { readonly kind: "absent" }
  | { readonly kind: "error"; readonly reason: string };

export type PortResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

export interface ObservationPorts {
  readonly now: () => number;
  readonly runHostScript: (script: HostScript) => Promise<CommandResult>;
  readonly runVerifier: (expectEnabled: boolean) => Promise<CommandResult>;
  readonly readText: (file: string) => Promise<FileRead>;
  /** The first line only: the long-run journal grows to hundreds of megabytes (tools/measure-longrun-scale.mjs). */
  readonly readFirstLine: (file: string) => Promise<FileRead>;
  /** The entry names of a directory; null when it does not exist. */
  readonly listDirectory: (directory: string) => Promise<PortResult<readonly string[] | null>>;
  readonly appendLine: (file: string, line: string) => Promise<PortResult<true>>;
  readonly freeDiskBytes: (directory: string) => Promise<PortResult<number>>;
  readonly healthchecks: () => Promise<HealthchecksReading>;
  /** The competition account's number, read-only — the one permitted touch of that account (spec §7). */
  readonly competitionAccountNumber: () => Promise<PortResult<string>>;
  readonly devAccountBook: () => Promise<PortResult<DevAccountObservation>>;
  readonly preflight: () => Promise<CommandResult>;
  readonly analystTokenPresent: () => Promise<boolean>;
  readonly analystProbe: () => Promise<ProbeOutcome>;
  readonly validateCertificate: CertificateValidator["validate"];
  readonly parseJournal: JournalCodec;
}

export interface ObservationConfig {
  readonly repoRoot: string;
  readonly activationRoot: string;
  /** The long run's STATE_DIR (spec §3: `longrun-1`), where the wrapper logs and the journal live. */
  readonly longRunStateDir: string;
  readonly taskNames: TaskNames;
  readonly canonicalTradingOrigin: string;
}

export interface ObservationPlan {
  readonly preflight: boolean;
  /** Only together with the preflight: a probe is not spent on an analyst that did not even start. */
  readonly analystProbe: boolean;
  readonly devAccount: boolean;
}

export const SESSION_SAMPLE_LOG = "session-samples.jsonl";
export const ALERT_CONFIRMATIONS = "alert-confirmations.jsonl";

function known<T>(value: T): Reading<T> {
  return { known: true, value };
}

function unknown<T>(reason: string): Reading<T> {
  return { known: false, reason };
}

function notTaken<T>(what: string): Reading<T> {
  return unknown(`${what} not taken in this invocation`);
}

function commandOutput(result: CommandResult, name: string): Reading<string> {
  if (result.exitCode === null) return unknown(`${name} did not finish`);
  if (result.exitCode !== 0) return unknown(`${name} exited ${String(result.exitCode)}`);
  return known(result.stdout);
}

function portReading<T>(result: PortResult<T>, name: string): Reading<T> {
  return result.ok ? known(result.value) : unknown(`${name}: ${result.reason}`);
}

async function readEnv(ports: ObservationPorts, config: ObservationConfig): Promise<Reading<EnvObservation>> {
  const dotEnv = await ports.readText(path.join(config.repoRoot, ".env"));
  if (dotEnv.kind === "absent") return unknown(".env does not exist");
  if (dotEnv.kind === "error") return unknown(`.env: ${dotEnv.reason}`);
  const output = commandOutput(await ports.runHostScript("environment"), "environment reader");
  const shadow = output.known ? parseEnvironmentShadow(output.value) : output;
  if (!shadow.known) return unknown(`environment: ${shadow.reason}`);
  return known(parseEnv({ dotEnvText: dotEnv.text, sha256: dotEnv.sha256, userEnvironment: shadow.value.user, machineEnvironment: shadow.value.machine }));
}

async function readCertificate(ports: ObservationPorts, config: ObservationConfig, digests: Reading<DigestPair>): Promise<Reading<CertificateObservation | null>> {
  const directory = path.join(config.repoRoot, "evidence", "pre-arm");
  const listing = await ports.listDirectory(directory);
  if (!listing.ok) return unknown(`certificates: ${listing.reason}`);
  const name = listing.value === null ? null : latestCertificateName(listing.value);
  if (name === null) return known(null);
  // The verdict comes only from the runtime's validator against this deployment's digests; without them there is no verdict.
  if (!digests.known) return unknown(`the certificate cannot be validated without the deployment's digests (${digests.reason})`);
  const file = path.join(directory, name);
  const read = await ports.readText(file);
  if (read.kind !== "text") return unknown(`certificate ${name}: ${read.kind === "error" ? read.reason : "vanished"}`);
  return parseCertificateFile(read.text, file, { expectations: { ...digests.value, canonicalTradingOrigin: config.canonicalTradingOrigin }, validate: ports.validateCertificate });
}

async function readLog(ports: ObservationPorts, directory: string, names: readonly string[]): Promise<Reading<readonly LogLine[]>> {
  const files: LogFile[] = [];
  for (const name of names) {
    const read = await ports.readText(path.join(directory, name));
    if (read.kind === "error") return unknown(`${name}: ${read.reason}`);
    files.push({ name, text: read.kind === "text" ? read.text : null });
  }
  return parseWrapperLogs(files);
}

/**
 * One sample per invocation, appended to the sample log before the log is read back. A probe that
 * failed or an append that failed loses this invocation's sample only; step 9 then finds a gap in
 * its window and aborts, which is the fail-closed answer for a sample that was never taken.
 */
async function sampleSessions(ports: ObservationPorts, config: ObservationConfig, nowUtcMs: number): Promise<readonly SessionSample[]> {
  const output = commandOutput(await ports.runHostScript("sessions"), "session probe");
  const sample = output.known ? parseSessionProbe(output.value, nowUtcMs) : output;
  const log = path.join(config.activationRoot, SESSION_SAMPLE_LOG);
  if (sample.known) await ports.appendLine(log, sessionSampleLine(sample.value));
  const read = await ports.readText(log);
  return read.kind === "text" ? parseSessionSampleLog(read.text) : [];
}

async function hashWrappers(ports: ObservationPorts, config: ObservationConfig): Promise<Reading<Readonly<Record<WrapperName, string>>>> {
  const hashes: Partial<Record<WrapperName, string>> = {};
  for (const name of ["cycle-run.ps1", "watchdog-run.ps1"] as const) {
    const read = await ports.readText(path.join(config.repoRoot, "tools", name));
    if (read.kind !== "text") return unknown(`${name}: ${read.kind === "error" ? read.reason : "does not exist"}`);
    hashes[name] = read.sha256;
  }
  const cycle = hashes["cycle-run.ps1"];
  const watchdog = hashes["watchdog-run.ps1"];
  return cycle === undefined || watchdog === undefined ? unknown("a wrapper was not hashed") : known({ "cycle-run.ps1": cycle, "watchdog-run.ps1": watchdog });
}

async function readConfirmation(ports: ObservationPorts, config: ObservationConfig): Promise<Reading<AlertConfirmation | null>> {
  const read = await ports.readText(path.join(config.activationRoot, ALERT_CONFIRMATIONS));
  if (read.kind === "absent") return known(null);
  if (read.kind === "error") return unknown(`alert confirmations: ${read.reason}`);
  return parseAlertConfirmations(read.text);
}

async function readVerifier(ports: ObservationPorts, expectEnabled: boolean): Promise<Reading<SchedulerCheckObservation>> {
  const result = await ports.runVerifier(expectEnabled);
  // A failing verifier exits 1 on purpose, so the exit code is the parser's to weigh against the verdict line.
  if (result.exitCode === null) return unknown("the scheduler verifier did not finish");
  return parseVerifierOutput(result.stdout, result.exitCode);
}

async function readBootstrap(ports: ObservationPorts, config: ObservationConfig): Promise<Reading<JournalBootstrapObservation | null>> {
  const read = await ports.readFirstLine(path.join(config.longRunStateDir, "journal.jsonl"));
  if (read.kind === "error") return unknown(`journal: ${read.reason}`);
  return parseJournalHead(read.kind === "text" ? read.text : null, ports.parseJournal);
}

async function readAnalyst(ports: ObservationPorts, plan: ObservationPlan, preflight: Reading<PreflightReport>): Promise<Reading<AnalystObservation>> {
  if (!plan.preflight || !plan.analystProbe) return notTaken("the analyst probe");
  if (!preflight.known) return unknown(`preflight: ${preflight.reason}`);
  return analystObservation(await ports.analystTokenPresent(), preflight, await ports.analystProbe());
}

export async function readObservations(ports: ObservationPorts, config: ObservationConfig, plan: ObservationPlan): Promise<Observations> {
  const nowUtcMs = ports.now();

  const taskList = commandOutput(await ports.runHostScript("tasks"), "task reader");
  const health = await ports.healthchecks();
  const env = await readEnv(ports, config);
  const accountNumber = await ports.competitionAccountNumber();
  const resolvedAccountMasked = accountNumber.ok ? maskAccountId(accountNumber.value) : unknown<string>(`account: ${accountNumber.reason}`);

  const preflightOutput = plan.preflight ? await ports.preflight() : null;
  // The report is the proof, not the exit code: a refused build prints no report and reads unknown either way.
  const preflight = preflightOutput === null ? notTaken<PreflightReport>("the preflight") : preflightOutput.exitCode === null ? unknown<PreflightReport>("the preflight did not finish") : parsePreflightOutput(preflightOutput.stdout);
  const deploymentDigests = preflight.known ? known(preflight.value.digests) : unknown<DigestPair>(`digests: ${preflight.reason}`);

  const boot = commandOutput(await ports.runHostScript("boot"), "boot reader");
  const preconditions = commandOutput(await ports.runHostScript("preconditions"), "host precondition reader");
  const longRunListing = await ports.listDirectory(config.longRunStateDir);

  return {
    nowUtcMs,
    nowLocal: berlinLocal(nowUtcMs),
    tasks: taskList.known ? parseTasks(taskList.value, config.taskNames) : taskList,
    checks: combineChecks(health.summaries, health.flips),
    apiIndependentRead: health.independent,
    env,
    resolvedAccountMasked,
    deploymentDigests,
    certificate: await readCertificate(ports, config, deploymentDigests),
    devAccount: plan.devAccount ? portReading(await ports.devAccountBook(), "dev account") : notTaken("the dev account read"),
    bootUtcMs: boot.known ? parseBootInstant(boot.value) : boot,
    cycleLog: await readLog(ports, config.longRunStateDir, ["cycle-run.log.1", "cycle-run.log"]),
    watchdogLog: await readLog(ports, config.longRunStateDir, ["watchdog-run.log"]),
    logFilesSearched: ["cycle-run.log", "cycle-run.log.1"],
    sessionSamples: await sampleSessions(ports, config, nowUtcMs),
    wrapperHashes: await hashWrappers(ports, config),
    hostPreconditions: preconditions.known ? parseHostPreconditions(preconditions.value) : preconditions,
    alertConfirmation: await readConfirmation(ports, config),
    longRunArtefacts: longRunListing.ok ? known(longRunListing.value ?? []) : unknown(`long-run state directory: ${longRunListing.reason}`),
    freeDiskBytes: portReading(await ports.freeDiskBytes(config.activationRoot), "free disk"),
    analyst: await readAnalyst(ports, plan, preflight),
    schedulerCheck: await readVerifier(ports, false),
    schedulerCheckExpectEnabled: await readVerifier(ports, true),
    disarm: taskList.known ? parseDisarm(taskList.value, config.taskNames) : taskList,
    bootstrapEntry: await readBootstrap(ports, config),
  };
}
