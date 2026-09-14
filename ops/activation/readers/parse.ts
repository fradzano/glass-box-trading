// Pure parsers for the activation's readers (build log, unit 7). Each takes the text a
// thin I/O call produced — a command's output, a file's contents — and returns a
// `Reading`: a value, or the reason it could not be taken, never a guess (spec A1).
//
// They are pure but live outside ops/activation/core: they need `Date` and `Intl`,
// which the architecture gate forbids there, and they decide nothing about the
// activation — they only say what the host said. Every fixture in their tests that
// can be taken from this host was taken from it, read-only, on 2026-09-14.
import type { AlertConfirmation, CertificateObservation, CheckName, DigestPair, DisarmObservation, EnvObservation, LocalInstant, LogLine, Reading, SchedulerCheckObservation, SessionSample, TaskName, TaskObservation } from "../core/types.ts";

function known<T>(value: T): Reading<T> {
  return { known: true, value };
}

function unknown<T>(reason: string): Reading<T> {
  return { known: false, reason };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** PowerShell 5.1's `ConvertTo-Json` writes a one-element array as that element; both shapes mean the same list. */
function asList(value: unknown): readonly unknown[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function parseJson(text: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

/** PowerShell 5.1 writes a UTF-8 byte-order mark when `Add-Content -Encoding utf8` creates a file; Node keeps it. */
function withoutBom(text: string): string {
  return text.startsWith("\uFEFF") ? text.slice(1) : text;
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/**
 * ISO 8601 with `Z` or an explicit offset and any number of fraction digits
 * (PowerShell's `'o'` format writes seven). Null for anything else — a missing zone,
 * a space instead of `T`, an impossible date — because a stamp that could mean two
 * instants is not a stamp.
 */
export function parseIsoInstant(text: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(text);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fraction = match[7];
  const zone = match[8] ?? "";
  const base = Date.UTC(year, month - 1, day, hour, minute, second);
  const roundTrip = new Date(base);
  if (year < 1970 || roundTrip.getUTCFullYear() !== year || roundTrip.getUTCMonth() !== month - 1 || roundTrip.getUTCDate() !== day
    || roundTrip.getUTCHours() !== hour || roundTrip.getUTCMinutes() !== minute || roundTrip.getUTCSeconds() !== second) {
    return null;
  }
  const millis = fraction === undefined ? 0 : Number(fraction.padEnd(3, "0").slice(0, 3));
  if (zone === "Z") return base + millis;
  const sign = zone.startsWith("-") ? -1 : 1;
  const offsetHours = Number(zone.slice(1, 3));
  const offsetMinutes = Number(zone.slice(4, 6));
  if (offsetHours > 14 || offsetMinutes > 59) return null;
  return base + millis - sign * (offsetHours * 60 + offsetMinutes) * 60_000;
}

/** The Europe/Berlin wall clock of a UTC instant, from the zone tables, so the core never converts time. */
export function berlinLocal(utcMs: number): LocalInstant {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(utcMs));
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find(item => item.type === type)?.value ?? "";
  return { date: `${part("year")}-${part("month")}-${part("day")}`, minute: Number(part("hour")) * 60 + Number(part("minute")) };
}

/** `LastBootUpTime`, which the reader prints as `.ToUniversalTime().ToString('o')`. */
export function parseBootInstant(text: string): Reading<number> {
  const utcMs = parseIsoInstant(text.trim());
  return utcMs === null ? unknown("boot time is not an ISO instant with a zone") : known(utcMs);
}

// ---------------------------------------------------------------------------
// Wrapper logs
// ---------------------------------------------------------------------------

export interface LogFile {
  /** The file name as it goes into the evidence, e.g. `cycle-run.log.1`. */
  readonly name: string;
  /** The file's text, or null when the file does not exist (a rotation file often does not). */
  readonly text: string | null;
}

/**
 * The wrapper logs: `<UTC ISO> <message>` per line, the message starting `run:`,
 * `skip:` or anything else. A line without a leading instant makes the whole reading
 * unknown — the silence drill's discriminator depends on seeing every line.
 */
export function parseWrapperLogs(files: readonly LogFile[]): Reading<readonly LogLine[]> {
  const lines: LogLine[] = [];
  for (const file of files) {
    if (file.text === null) continue;
    for (const [index, row] of withoutBom(file.text).split(/\r?\n/).entries()) {
      if (row.length === 0) continue;
      const space = row.indexOf(" ");
      const utcMs = space > 0 ? parseIsoInstant(row.slice(0, space)) : null;
      if (utcMs === null) return unknown(`${file.name}:${String(index + 1)} has no leading ISO instant`);
      const message = row.slice(space + 1);
      const shape = message.startsWith("run:") ? "run" : message.startsWith("skip:") ? "skip" : "other";
      lines.push({ file: file.name, utcMs, local: berlinLocal(utcMs), shape });
    }
  }
  return known([...lines].sort((left, right) => left.utcMs - right.utcMs));
}

// ---------------------------------------------------------------------------
// Scheduled tasks
// ---------------------------------------------------------------------------

export interface TaskNames {
  readonly cycle: string;
  readonly watchdog: string;
  readonly disarm: string;
}

interface RawTask {
  readonly name: string;
  readonly state: string;
  readonly actions: readonly { readonly execute: string; readonly argumentLine: string }[];
  readonly startBoundaries: readonly (string | null)[];
  readonly runLevel: string | null;
  readonly logonType: string | null;
  readonly startWhenAvailable: boolean | null;
}

/**
 * The reader's JSON: one object per task in the folder with `TaskName`, `State` (the
 * enum's name, not its number), `Actions` (every action, `Execute` and `Arguments`)
 * and `Triggers` (`StartBoundary`). An empty output means no task is registered.
 */
function parseTaskList(text: string): Reading<readonly RawTask[]> {
  if (text.trim().length === 0) return known([]);
  const parsed = parseJson(withoutBom(text));
  if (!parsed.ok) return unknown("task list is not JSON");
  const tasks: RawTask[] = [];
  for (const item of asList(parsed.value)) {
    if (!isRecord(item) || typeof item["TaskName"] !== "string" || typeof item["State"] !== "string") return unknown("task entry lacks TaskName or State");
    const actions: { execute: string; argumentLine: string }[] = [];
    for (const action of asList(item["Actions"])) {
      if (!isRecord(action) || typeof action["Execute"] !== "string") return unknown(`${item["TaskName"]}: action lacks Execute`);
      const argumentLine = action["Arguments"];
      if (argumentLine !== null && argumentLine !== undefined && typeof argumentLine !== "string") return unknown(`${item["TaskName"]}: Arguments is not text`);
      actions.push({ execute: action["Execute"], argumentLine: typeof argumentLine === "string" ? argumentLine : "" });
    }
    const startBoundaries: (string | null)[] = [];
    for (const trigger of asList(item["Triggers"])) {
      if (!isRecord(trigger)) return unknown(`${item["TaskName"]}: trigger is not an object`);
      const boundary = trigger["StartBoundary"];
      startBoundaries.push(typeof boundary === "string" ? boundary : null);
    }
    // Review of 2026-09-14, point 4. The reader prints the enums by name; a number means the reader changed, and is refused.
    const runLevel = item["RunLevel"] ?? null;
    if (runLevel !== null && typeof runLevel !== "string") return unknown(`${item["TaskName"]}: RunLevel is not text`);
    const logonType = item["LogonType"] ?? null;
    if (logonType !== null && typeof logonType !== "string") return unknown(`${item["TaskName"]}: LogonType is not text`);
    const startWhenAvailable = item["StartWhenAvailable"] ?? null;
    if (startWhenAvailable !== null && typeof startWhenAvailable !== "boolean") return unknown(`${item["TaskName"]}: StartWhenAvailable is not a boolean`);
    tasks.push({ name: item["TaskName"], state: item["State"], actions, startBoundaries, runLevel, logonType, startWhenAvailable });
  }
  return known(tasks);
}

function single(tasks: readonly RawTask[], name: string): Reading<RawTask | null> {
  const found = tasks.filter(task => task.name === name);
  if (found.length > 1) return unknown(`${name} is registered ${String(found.length)} times`);
  return known(found[0] ?? null);
}

/** Both deployment tasks, each with exactly one action — the verifier once passed a second `cmd.exe` action by reading only `Actions[0]`. */
export function parseTasks(text: string, names: TaskNames): Reading<Readonly<Record<TaskName, TaskObservation>>> {
  const list = parseTaskList(text);
  if (!list.known) return list;
  const observe = (name: string): Reading<TaskObservation> => {
    const task = single(list.value, name);
    if (!task.known) return task;
    if (task.value === null) return unknown(`${name} is not registered`);
    const action = task.value.actions[0];
    if (task.value.actions.length !== 1 || action === undefined) return unknown(`${name} has ${String(task.value.actions.length)} actions`);
    return known({ state: task.value.state, execute: action.execute, argumentLine: action.argumentLine });
  };
  const cycle = observe(names.cycle);
  if (!cycle.known) return cycle;
  const watchdog = observe(names.watchdog);
  if (!watchdog.known) return watchdog;
  return known({ cycle: cycle.value, watchdog: watchdog.value });
}

/** The disarm one-shot: absent is a fact, not a failure; registered means exactly one trigger with a zoned start, and all its actions as found. */
export function parseDisarm(text: string, names: TaskNames): Reading<DisarmObservation> {
  const list = parseTaskList(text);
  if (!list.known) return list;
  const task = single(list.value, names.disarm);
  if (!task.known) return task;
  if (task.value === null) return known({ registered: false, fires: null, state: null, actions: [], runLevel: null, logonType: null, startWhenAvailable: null });
  const boundary = task.value.startBoundaries[0];
  if (task.value.startBoundaries.length !== 1 || boundary === undefined || boundary === null) return unknown(`${names.disarm} has ${String(task.value.startBoundaries.length)} triggers`);
  const utcMs = parseIsoInstant(boundary);
  if (utcMs === null) return unknown(`${names.disarm} trigger has no zoned start`);
  // Every action, the state, the principal and the settings, verbatim: the core judges what the one-shot would run and how (review of 2026-09-14, points 2 and 4).
  return known({ registered: true, fires: berlinLocal(utcMs), state: task.value.state, actions: task.value.actions, runLevel: task.value.runLevel, logonType: task.value.logonType, startWhenAvailable: task.value.startWhenAvailable });
}

// ---------------------------------------------------------------------------
// The scheduler verifier
// ---------------------------------------------------------------------------

/** Exactly one verdict line, and an exit code that agrees with it; anything else is unknown (spec §7: the tool that did not run is not green). */
export function parseVerifierOutput(text: string, exitCode: number): Reading<SchedulerCheckObservation> {
  const rows = text.split(/\r?\n/).map(row => row.trim());
  const passed = rows.flatMap(row => {
    const match = /^SCHEDULER CHECK PASSED: (\d+) checks\.$/.exec(row);
    return match === null ? [] : [Number(match[1])];
  });
  const failed = rows.flatMap(row => {
    const match = /^SCHEDULER CHECK FAILED: (\d+) of (\d+) checks\./.exec(row);
    return match === null ? [] : [{ failedChecks: Number(match[1]), checkCount: Number(match[2]) }];
  });
  if (passed.length + failed.length !== 1) return unknown(`verifier printed ${String(passed.length + failed.length)} verdict lines`);
  const count = passed[0];
  if (count !== undefined) {
    if (exitCode !== 0) return unknown(`verifier passed but exited ${String(exitCode)}`);
    return known({ passed: true, checkCount: count, failedChecks: 0 });
  }
  const verdict = failed[0];
  if (verdict === undefined || exitCode === 0) return unknown("verifier failed but exited 0");
  if (verdict.failedChecks < 1 || verdict.failedChecks > verdict.checkCount) return unknown("verifier failure count is inconsistent");
  return known({ passed: false, checkCount: verdict.checkCount, failedChecks: verdict.failedChecks });
}

// ---------------------------------------------------------------------------
// Session samples
// ---------------------------------------------------------------------------

/**
 * The reader's JSON: `{ "sessions": [{ "type": 2, "accounts": ["HOST\\felix"] }], "explorer": 1 }`
 * for `Win32_LogonSession` of types 2, 10 and 11 with their `Win32_LoggedOnUser`
 * accounts. Counted are **distinct accounts**, not sessions: measured on this host on
 * 2026-09-14, one signed-in user holds two type-2 sessions (the split token of an
 * administrator). The window manager's and the font driver's own identities
 * (`DWM-n`, `UMFD-n`) are not people. What a signed-out host reports is not measured
 * yet (unit 13).
 */
export function parseSessionProbe(text: string, utcMs: number): Reading<SessionSample> {
  const parsed = parseJson(withoutBom(text));
  if (!parsed.ok || !isRecord(parsed.value)) return unknown("session probe is not a JSON object");
  const explorer = parsed.value["explorer"];
  if (typeof explorer !== "number" || !Number.isSafeInteger(explorer) || explorer < 0) return unknown("session probe lacks an explorer count");
  const accounts = new Set<string>();
  for (const session of asList(parsed.value["sessions"])) {
    if (!isRecord(session) || typeof session["type"] !== "number") return unknown("session entry lacks its type");
    if (session["type"] !== 2 && session["type"] !== 10 && session["type"] !== 11) continue;
    for (const account of asList(session["accounts"])) {
      if (typeof account !== "string") return unknown("session account is not text");
      const name = account.slice(account.lastIndexOf("\\") + 1);
      if (!/^(DWM|UMFD)-\d+$/i.test(name)) accounts.add(account.toLowerCase());
    }
  }
  return known({ utcMs, local: berlinLocal(utcMs), interactiveSessions: accounts.size, explorerProcesses: explorer });
}

// ---------------------------------------------------------------------------
// .env, as the runtime reads it
// ---------------------------------------------------------------------------

/**
 * A copy of the runtime's `parseDotEnv` (`src/shell/runtime-config.ts`) that also
 * reports duplicates. It must agree with the runtime line for line — the tests hold
 * it to that by running both — because the latch is whatever the **runtime** reads:
 * the last duplicate wins and `export KEY=` is a different key. A byte-order mark does
 * **not** hide the first key: `trim` removes U+FEFF, in the runtime and here alike.
 */
export function parseDotEnvAsRuntime(text: string): { readonly values: Readonly<Record<string, string>>; readonly duplicateKeys: readonly string[] } {
  const values: Record<string, string> = {};
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
    values[key] = value;
  }
  return { values, duplicateKeys: [...duplicates].sort() };
}

/** The variables whose value outside `.env` would override it for the runtime (`loadEnvironment` lets process variables win). */
function shadowableKeys(): readonly string[] {
  return ["PRE_ARM_CERTIFICATE", "ALPACA_PROFILE", "STATE_DIR"];
}

/** The environment reading is exactly the core's observation; `shadowedKeys` became part of it with the owner ruling of 2026-09-14. */
export type EnvReading = EnvObservation;

/**
 * `.env` plus the user and machine environment an S4U task inherits. The effective
 * value is the one the runtime would see: user over machine over `.env`. An empty
 * value is a present value — `PRE_ARM_CERTIFICATE=` is not an absent line.
 */
export function parseEnv(input: { readonly dotEnvText: string; readonly sha256: string; readonly userEnvironment: Readonly<Record<string, string>>; readonly machineEnvironment: Readonly<Record<string, string>> }): EnvReading {
  const { values, duplicateKeys } = parseDotEnvAsRuntime(input.dotEnvText);
  const effective = (key: string): string | null => input.userEnvironment[key] ?? input.machineEnvironment[key] ?? values[key] ?? null;
  const shadowedKeys = shadowableKeys().filter(key => Object.hasOwn(input.userEnvironment, key) || Object.hasOwn(input.machineEnvironment, key));
  return { certificatePath: effective("PRE_ARM_CERTIFICATE"), profile: effective("ALPACA_PROFILE"), hash: input.sha256, duplicateKeys, shadowedKeys };
}

// ---------------------------------------------------------------------------
// Certificate and preflight
// ---------------------------------------------------------------------------

export interface ArmingExpectationsInput {
  readonly runtimeDigest: string;
  readonly policyDigest: string;
  readonly canonicalTradingOrigin: string;
}

export type ArmingValidation = { readonly ok: true; readonly successfulDevLiveTestAt: string } | { readonly ok: false; readonly violations: readonly string[] };

/**
 * The runtime's own certificate validator — `validateArmingCertificate` from
 * `src/core/certificate.ts`, the function `evaluateArmingGate` calls — handed in with this
 * deployment's expectations, so the activation judges a certificate exactly as the arming
 * gate will judge it at 15:15.
 */
export interface CertificateValidator {
  readonly expectations: ArmingExpectationsInput;
  readonly validate: (raw: unknown, expectations: ArmingExpectationsInput) => ArmingValidation;
}

/**
 * A pre-arm certificate file. The flat fields are read first, so that a file that is not a
 * certificate at all is unknown rather than a verdict. The verdict itself comes only from the
 * runtime's full validator (review of 2026-09-14, point 1): exact schema, evidence digest,
 * dev role, canonical origin, both digests of this deployment. A document that says PASS and
 * fails any of that reads `REJECTED` with the validator's violations — never PASS.
 */
export function parseCertificateFile(text: string, path: string, validator: CertificateValidator): Reading<CertificateObservation> {
  const parsed = parseJson(withoutBom(text));
  if (!parsed.ok || !isRecord(parsed.value)) return unknown("certificate is not a JSON object");
  const certificate = parsed.value;
  if (certificate["schemaVersion"] !== 2) return unknown("certificate schema is not 2");
  if (certificate["role"] !== "dev") return unknown("certificate role is not dev");
  const verdict = certificate["verdict"];
  if (verdict !== "PASS" && verdict !== "FAIL") return unknown("certificate verdict is neither PASS nor FAIL");
  const runtimeDigest = certificate["runtimeDigest"];
  const policyDigest = certificate["policyDigest"];
  if (typeof runtimeDigest !== "string" || runtimeDigest.length === 0 || typeof policyDigest !== "string" || policyDigest.length === 0) return unknown("certificate digests missing");
  const validation = validator.validate(certificate, validator.expectations);
  if (validation.ok) return known({ path, verdict: "PASS", digests: { runtimeDigest, policyDigest }, violations: [] });
  return known({ path, verdict: verdict === "FAIL" ? "FAIL" : "REJECTED", digests: { runtimeDigest, policyDigest }, violations: validation.violations });
}

export interface PreflightReport {
  readonly digests: DigestPair;
  readonly mcpTools: number;
}

/**
 * `certificate-cli --preflight` prints its construction log line by line and then one
 * indented JSON object (`src/shell/certificate-cli.ts:41`). The report is that last
 * object; it must name the dev profile and a non-empty MCP inventory, which is what
 * "the analyst child started and verified" means in the code.
 */
export function parsePreflightOutput(stdout: string): Reading<PreflightReport> {
  const text = withoutBom(stdout).replace(/\r\n/g, "\n");
  const start = text.startsWith("{\n") ? 0 : text.lastIndexOf("\n{\n") + 1;
  if (start === 0 && !text.startsWith("{\n")) return unknown("preflight printed no report");
  const parsed = parseJson(text.slice(start));
  if (!parsed.ok || !isRecord(parsed.value)) return unknown("preflight report is not a JSON object");
  const report = parsed.value;
  if (report["profile"] !== "dev") return unknown("preflight did not run with the dev profile");
  const mcpTools = report["mcpTools"];
  if (typeof mcpTools !== "number" || !Number.isSafeInteger(mcpTools) || mcpTools < 1) return unknown("preflight reports no MCP inventory");
  const runtimeDigest = report["runtimeDigest"];
  const policyDigest = report["policyDigest"];
  if (typeof runtimeDigest !== "string" || runtimeDigest.length === 0 || typeof policyDigest !== "string" || policyDigest.length === 0) return unknown("preflight report lacks digests");
  return known({ digests: { runtimeDigest, policyDigest }, mcpTools });
}

// ---------------------------------------------------------------------------
// The human confirmation of gate condition 4
// ---------------------------------------------------------------------------

function instantsByCheck(value: unknown): Readonly<Record<CheckName, number>> | null {
  if (!isRecord(value)) return null;
  const read = (name: CheckName): number | null => {
    const raw = value[name];
    return typeof raw === "string" ? parseIsoInstant(raw) : null;
  };
  const liveness = read("liveness");
  const readiness = read("readiness");
  const watchdog = read("watchdog");
  return liveness === null || readiness === null || watchdog === null ? null : { liveness, readiness, watchdog };
}

/**
 * The confirmation file `activation confirm-alerts` appends to (owner ruling and review,
 * 2026-09-14), one JSON object per line:
 * `{ operator, alertReceivedAt: { liveness, readiness, watchdog }, bundledAlert,
 *    reminderReceivedAt, reminderListed: [...], fingerprints: {...}, downFlips: {...},
 *    crossCheck: "passed" }`, every instant ISO 8601 with a zone.
 * The latest line counts; a malformed latest line makes the reading unknown rather than
 * reviving an older confirmation the owner meant to replace. This parser checks shape
 * only: whether the story fits the flip history is `crossCheckAlerts`, which step 0
 * repeats against the live checks.
 */
export function parseAlertConfirmations(text: string): Reading<AlertConfirmation | null> {
  const rows = withoutBom(text).split(/\r?\n/).filter(row => row.trim().length > 0);
  const latest = rows.at(-1);
  if (latest === undefined) return known(null);
  const parsed = parseJson(latest);
  if (!parsed.ok || !isRecord(parsed.value)) return unknown("latest confirmation is not a JSON object");
  const line = parsed.value;
  const operator = line["operator"];
  if (typeof operator !== "string" || operator.trim().length === 0) return unknown("latest confirmation names no operator");
  if (line["crossCheck"] !== "passed") return unknown("latest confirmation did not pass the flip cross-check");
  const bundledAlert = line["bundledAlert"];
  if (typeof bundledAlert !== "boolean") return unknown("latest confirmation does not say whether the alert was one mail");
  const alertReceivedUtcMs = instantsByCheck(line["alertReceivedAt"]);
  if (alertReceivedUtcMs === null) return unknown("latest confirmation lacks a zoned alert receipt per check");
  const downFlipUtcMs = instantsByCheck(line["downFlips"]);
  if (downFlipUtcMs === null) return unknown("latest confirmation lacks a zoned down flip per check");
  const reminderReceivedUtcMs = typeof line["reminderReceivedAt"] === "string" ? parseIsoInstant(line["reminderReceivedAt"]) : null;
  if (reminderReceivedUtcMs === null) return unknown("latest confirmation lacks a zoned reminder receipt");
  const listed = line["reminderListed"];
  if (!Array.isArray(listed)) return unknown("latest confirmation does not list the reminder's checks");
  const items: readonly unknown[] = listed;
  const reminderListed: CheckName[] = [];
  for (const item of items) {
    if (item !== "liveness" && item !== "readiness" && item !== "watchdog") return unknown("the reminder lists something that is not a check");
    reminderListed.push(item);
  }
  const fingerprints = line["fingerprints"];
  if (!isRecord(fingerprints)) return unknown("latest confirmation lacks fingerprints");
  const liveness = fingerprints["liveness"];
  const readiness = fingerprints["readiness"];
  const watchdog = fingerprints["watchdog"];
  const shaped = (value: unknown): value is string => typeof value === "string" && /^hc:[0-9a-f]{8}$/.test(value);
  if (!shaped(liveness) || !shaped(readiness) || !shaped(watchdog)) return unknown("a fingerprint is not of the form hc:xxxxxxxx");
  return known({ operator, alertReceivedUtcMs, bundledAlert, reminderReceivedUtcMs, reminderListed, fingerprints: { liveness, readiness, watchdog }, downFlipUtcMs });
}
