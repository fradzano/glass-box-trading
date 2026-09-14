// Pure parsers for the host readers that complete unit 7 (build log, "Unit 7 — the I/O
// readers"). The contract is parse.ts's: text in, a `Reading` out, never a guess, and
// nothing about the activation decided here — they only say what the host said. The
// fixtures in their tests are this host's own output, taken read-only on 2026-09-14,
// wherever the host could produce it.
import type { AnalystObservation, JournalBootstrapObservation, Reading, SessionSample } from "../core/types.ts";
import type { ProbeOutcome } from "./analyst-probe.ts";
import type { PreflightReport } from "./parse.ts";
import { berlinLocal, parseIsoInstant } from "./parse.ts";

function known<T>(value: T): Reading<T> {
  return { known: true, value };
}

function unknown<T>(reason: string): Reading<T> {
  return { known: false, reason };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

/** PowerShell 5.1 writes a UTF-8 byte-order mark in front of files it creates; Node keeps it. */
function withoutBom(text: string): string {
  return text.startsWith(String.fromCharCode(0xfeff)) ? text.slice(1) : text;
}

function textRecord(value: unknown): Readonly<Record<string, string>> | null {
  if (!isRecord(value)) return null;
  const result: Record<string, string> = {};
  for (const [name, item] of Object.entries(value)) {
    if (typeof item !== "string") return null;
    result[name] = item;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Host preconditions (spec §3)
// ---------------------------------------------------------------------------

/**
 * The flat name → text object `host/read-preconditions.ps1` prints. Every value must be text,
 * because the core compares them as text against the schedule's expectation, name by name in
 * both directions; an empty object is no reading.
 */
export function parseHostPreconditions(text: string): Reading<Readonly<Record<string, string>>> {
  const parsed = parseJson(withoutBom(text).trim());
  if (!parsed.ok) return unknown("host preconditions are not JSON");
  const values = textRecord(parsed.value);
  if (values === null) return unknown("host preconditions are not an object of text values");
  if (Object.keys(values).length === 0) return unknown("host preconditions are empty");
  return known(values);
}

// ---------------------------------------------------------------------------
// The environment outside .env (owner ruling 2026-09-14)
// ---------------------------------------------------------------------------

export interface EnvironmentShadow {
  readonly user: Readonly<Record<string, string>>;
  readonly machine: Readonly<Record<string, string>>;
}

function shadowableKeys(): readonly string[] {
  return ["PRE_ARM_CERTIFICATE", "ALPACA_PROFILE", "STATE_DIR"];
}

/**
 * `host/read-environment.ps1`: per scope, the keys among PRE_ARM_CERTIFICATE, ALPACA_PROFILE and
 * STATE_DIR that are set, with their values. A key outside those three means the reader asked
 * for more than it should, and is refused rather than passed on.
 */
export function parseEnvironmentShadow(text: string): Reading<EnvironmentShadow> {
  const parsed = parseJson(withoutBom(text).trim());
  if (!parsed.ok || !isRecord(parsed.value)) return unknown("environment reading is not a JSON object");
  const user = textRecord(parsed.value["user"]);
  const machine = textRecord(parsed.value["machine"]);
  if (user === null || machine === null) return unknown("environment reading lacks a user or machine object of text values");
  const unexpected = [...Object.keys(user), ...Object.keys(machine)].filter(key => !shadowableKeys().includes(key));
  if (unexpected.length > 0) return unknown("environment reading carries a key it was not asked for");
  return known({ user, machine });
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/**
 * The broker's account number (`account_number`), masked the way the ledger and the schedule
 * name accounts: the first four and the last three characters. Anything that is not an account
 * number of that shape is refused rather than masked, so an error text can never pass as an
 * identity.
 */
export function maskAccountId(accountId: string): Reading<string> {
  if (!/^[A-Z0-9]{8,32}$/.test(accountId)) return unknown("the broker's account number is not of the expected shape");
  return known(`${accountId.slice(0, 4)}…${accountId.slice(-3)}`);
}

// ---------------------------------------------------------------------------
// Session samples (build log, unit 5, design point 3)
// ---------------------------------------------------------------------------

/** One line of the activation's append-only sample log. The local time is not stored: it is derived again from the instant whenever the log is read. */
export function sessionSampleLine(sample: SessionSample): string {
  return `${JSON.stringify({ utcMs: sample.utcMs, interactiveSessions: sample.interactiveSessions, explorerProcesses: sample.explorerProcesses })}\n`;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * The sample log, read back. Every line must read: one that does not makes the whole log empty,
 * so that step 9 finds no bracketing sample and aborts, rather than proving signed-out execution
 * from a log it could only partly read.
 */
export function parseSessionSampleLog(text: string): readonly SessionSample[] {
  const samples: SessionSample[] = [];
  for (const row of withoutBom(text).split(/\r?\n/)) {
    if (row.trim().length === 0) continue;
    const parsed = parseJson(row);
    if (!parsed.ok || !isRecord(parsed.value)) return [];
    const utcMs = count(parsed.value["utcMs"]);
    const interactiveSessions = count(parsed.value["interactiveSessions"]);
    const explorerProcesses = count(parsed.value["explorerProcesses"]);
    if (utcMs === null || interactiveSessions === null || explorerProcesses === null) return [];
    samples.push({ utcMs, local: berlinLocal(utcMs), interactiveSessions, explorerProcesses });
  }
  return samples;
}

// ---------------------------------------------------------------------------
// The long-run journal's first entry (step 11)
// ---------------------------------------------------------------------------

/**
 * The runtime's own journal codec (`parseJournalText` in `src/core/journal.ts`), handed in: the entry is
 * judged by the schema the runtime wrote it with. A line that fails that schema is not among `entries`.
 */
export type JournalCodec = (text: string) => {
  readonly entries: readonly { readonly seq: number; readonly at: string; readonly type: string }[];
};

/**
 * The first line of the long-run journal. No journal, or an empty one, is a fact: the measurement
 * period has not started. A first entry that is not a valid BOOTSTRAP is unknown, because the run
 * then did not start the way step 11 records it.
 */
export function parseJournalHead(firstLine: string | null, codec: JournalCodec): Reading<JournalBootstrapObservation | null> {
  if (firstLine === null || firstLine.trim().length === 0) return known(null);
  const parsed = codec(`${withoutBom(firstLine)}\n`);
  const entry = parsed.entries[0];
  if (entry === undefined) return unknown("the journal's first line does not read as an entry");
  if (entry.type !== "BOOTSTRAP") return unknown(`the journal starts with ${entry.type}, not BOOTSTRAP`);
  const utcMs = parseIsoInstant(entry.at);
  if (utcMs === null) return unknown("the BOOTSTRAP entry's time does not read");
  return known({ seq: entry.seq, utcMs });
}

// ---------------------------------------------------------------------------
// Certificates, the independent API read, the analyst, the expected node
// ---------------------------------------------------------------------------

/**
 * The newest certificate the dev live test wrote. `certificate-run.ts` names each file by its end
 * instant with `:` and `.` replaced (`2026-09-02T16-20-48-944Z.json`, as found in evidence/pre-arm
 * on 2026-09-14), so the names sort in time order. Anything else in the directory is ignored.
 */
export function latestCertificateName(names: readonly string[]): string | null {
  return names.filter(name => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/.test(name)).sort().at(-1) ?? null;
}

/** `GET /api/v3/channels/`: a management read the drills do not touch. Only its shape is checked, and nothing of it is kept. */
export function parseIndependentRead(text: string): Reading<true> {
  const parsed = parseJson(text);
  if (!parsed.ok || !isRecord(parsed.value) || !Array.isArray(parsed.value["channels"])) return unknown("the independent read is not {\"channels\": [...]}");
  return known(true);
}

/**
 * Step 0's and the gate's analyst reading, from its three sources: whether the token is present, the
 * dev `--preflight` report (which prints only after the MCP child was started and verified), and the
 * live-token probe. A preflight that printed no report is unknown; a probe that failed is a known
 * "not live" with its class, because the probe ran and answered.
 */
export function analystObservation(tokenPresent: boolean, preflight: Reading<PreflightReport>, probe: ProbeOutcome): Reading<AnalystObservation> {
  if (!preflight.known) return unknown(`preflight: ${preflight.reason}`);
  return known({ oauthTokenPresent: tokenPresent, childStartVerified: preflight.value.mcpTools > 0, tokenLive: probe.ok, tokenProbeClass: probe.ok ? null : probe.failureClass });
}

/**
 * The node the disarm one-shot must run (review of 2026-09-14, point 4): the one this activation
 * runs on, and only if it is the version the repository pins — an absolute path to node.exe whose
 * version is `.node-version`. The schedule takes its `nodePath` from here, never from the
 * registration it is then compared against.
 */
export function expectedNodePath(execPath: string, runningVersion: string, pinnedVersionText: string): Reading<string> {
  const pinned = pinnedVersionText.trim();
  if (!/^\d+\.\d+\.\d+$/.test(pinned)) return unknown(".node-version does not name a version");
  if (runningVersion !== `v${pinned}`) return unknown(`this node is ${runningVersion}; the repository pins v${pinned}`);
  if (!/^[A-Za-z]:\\/.test(execPath) || !execPath.toLowerCase().endsWith("\\node.exe")) return unknown("this node's path is not an absolute path to node.exe");
  return known(execPath);
}
