// The ledger codec (spec §4). The ledger is the activation's only memory, so
// this module decides what counts as a line of it: a closed schema, a `seq`
// chain that starts at 1 and never skips, a clock that never runs backwards, a
// torn final line kept apart from the history, and evidence that cannot carry
// a credential.
//
// Pure: no I/O, no clock. `atUtcMs` is written into every line by the shell at
// append time, next to the human-readable `at`, precisely so that the core can
// order entries without ever parsing a date.
import type { EntryKind, LedgerEntry, Outcome, StepId } from "./types.ts";

export type LedgerDraft = Omit<LedgerEntry, "seq">;

export interface LedgerTail {
  readonly lastSeq: number;
  readonly lastAtUtcMs: number | null;
}

export type ValidatedEntry =
  | { readonly ok: true; readonly entry: LedgerEntry }
  | { readonly ok: false; readonly reason: string };

export type EncodedLine =
  | { readonly ok: true; readonly line: string; readonly entry: LedgerEntry }
  | { readonly ok: false; readonly reason: string };

export interface ParsedLedger {
  readonly entries: readonly LedgerEntry[];
  /** The bytes of an unterminated last line — a power cut mid-append — or null. */
  readonly torn: string | null;
  readonly corrupt: readonly { readonly line: number; readonly reason: string }[];
}

function stepIds(): readonly string[] {
  return [
    "0-preflight", "1-install", "2-certificate", "3-flat", "4-enable",
    "5a-watchdog-disable", "5b-watchdog-down", "5c-watchdog-reenable", "5d-watchdog-up",
    "6a-silence-disable", "6b-silence-down", "6c-silence-clear",
    "7-rearm", "8-reboot", "9-proof", "10-gate", "11-anchor",
  ];
}

function entryKinds(): readonly string[] {
  return ["intent", "result", "observation", "correction", "abort", "note"];
}

function outcomes(): readonly string[] {
  return ["ok", "failed", "already_in_target_state", "unknown"];
}

function ledgerFields(): readonly string[] {
  return ["seq", "at", "atUtcMs", "attempt", "anchorDay", "step", "kind", "outcome", "evidence", "nextOwnerAction"];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** All correction reference spellings accepted by the closed codec have one meaning. */
export function ledgerCorrectionSeq(evidence: unknown): number | null {
  if (!isRecord(evidence)) return null;
  const value = evidence["damagedSeq"] ?? evidence["correctedSeq"] ?? evidence["corrects"];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function isStepId(value: unknown): value is StepId {
  return typeof value === "string" && stepIds().includes(value);
}

function isEntryKind(value: unknown): value is EntryKind {
  return typeof value === "string" && entryKinds().includes(value);
}

function isOutcome(value: unknown): value is Outcome {
  return typeof value === "string" && outcomes().includes(value);
}

/**
 * A check's UUID is its ping credential, and a ping URL is one too: whoever holds
 * either can send success pings and suppress a silence alarm. The ledger is read
 * by people and by later sessions, so neither shape may enter it — a check is
 * named by name and `hc:` fingerprint only. Refused by shape, not by a list of
 * known secrets, because the point is to catch the one nobody listed.
 */
function secretShaped(text: string): boolean {
  return /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text)
    || /hc-ping\.com/i.test(text)
    || /healthchecks\.io\/(api|ping)/i.test(text)
    || /\bPA[A-Z0-9]{10}\b/.test(text)
    || /\bPK[A-Z0-9]{16,}\b/.test(text)
    || /\bsk-ant-[A-Za-z0-9_-]+/i.test(text)
    || /\bBearer\s+\S+/i.test(text);
}

function credentialField(key: string): boolean {
  const normalized = key.replace(/[^A-Za-z]/g, "").toLowerCase();
  return normalized.includes("apikey") || normalized.includes("apisecret")
    || normalized.includes("secretkey") || normalized.includes("accesstoken")
    || normalized.includes("authorization");
}

function inspectLedgerValue(value: unknown, seen: WeakSet<object>): "secret" | "invalid" | null {
  if (value === null || typeof value === "boolean") return null;
  if (typeof value === "string") return secretShaped(value) ? "secret" : null;
  if (typeof value === "number") return Number.isFinite(value) ? null : "invalid";
  if (typeof value !== "object") return "invalid";
  if (seen.has(value)) return "invalid";
  seen.add(value);
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    for (const item of items) {
      const hit = inspectLedgerValue(item, seen);
      if (hit !== null) return hit;
    }
    seen.delete(value);
    return null;
  }
  if (isRecord(value)) {
    const prototype: object | null = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) return "invalid";
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (secretShaped(key) || credentialField(key)) return "secret";
      if (!("value" in descriptor)) return "invalid";
      const hit = inspectLedgerValue(descriptor.value, seen);
      if (hit !== null) return hit;
    }
    seen.delete(value);
    return null;
  }
  return "invalid";
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysBeforeMonth(year: number, month: number): number {
  const starts = [0, 0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334] as const;
  return (starts[month] ?? 0) + (month > 2 && isLeapYear(year) ? 1 : 0);
}

function daysBeforeYear(year: number): number {
  const previous = year - 1;
  return 365 * previous + Math.floor(previous / 4) - Math.floor(previous / 100) + Math.floor(previous / 400);
}

/** Pure ISO-offset decoder: core architecture forbids Date/Intl. */
function isoAtUtcMs(at: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?([+-])(\d{2}):(\d{2})$/.exec(at);
  if (match === null) return null;
  const [year, month, day, hour, minute, second, millisecond, offsetHour, offsetMinute] = [
    match[1], match[2], match[3], match[4], match[5], match[6], (match[7] ?? "0").padEnd(3, "0"), match[9], match[10],
  ].map(part => Number(part));
  if (year === undefined || month === undefined || day === undefined || hour === undefined || minute === undefined
    || second === undefined || millisecond === undefined || offsetHour === undefined || offsetMinute === undefined) return null;
  const monthLengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > (monthLengths[month - 1] ?? 0)
    || hour > 23 || minute > 59 || second > 59 || offsetHour > 14 || offsetMinute > 59
    || (offsetHour === 14 && offsetMinute !== 0)) return null;
  const days = daysBeforeYear(year) - daysBeforeYear(1970) + daysBeforeMonth(year, month) + day - 1;
  const localMs = (((days * 24 + hour) * 60 + minute) * 60 + second) * 1_000 + millisecond;
  const offsetMs = (offsetHour * 60 + offsetMinute) * 60_000 * (match[8] === "+" ? 1 : -1);
  const utcMs = localMs - offsetMs;
  return Number.isSafeInteger(utcMs) && utcMs >= 0 ? utcMs : null;
}

function refuse(reason: string): { readonly ok: false; readonly reason: string } {
  return { ok: false, reason };
}

/** The closed schema of one line. Missing and unknown fields are both refusals: a line is either exactly this or not a line. */
function validateLedgerEntryUnsafe(value: unknown): ValidatedEntry {
  if (!isRecord(value)) return refuse("ENTRY_NOT_A_RECORD");
  for (const key of Object.keys(value)) {
    if (!ledgerFields().includes(key)) return refuse(`UNKNOWN_FIELD:${key}`);
  }
  for (const key of ledgerFields()) {
    if (!Object.hasOwn(value, key)) return refuse(`MISSING_FIELD:${key}`);
  }
  const { seq, at, atUtcMs, attempt, anchorDay, step, kind, outcome, evidence, nextOwnerAction } = value;

  if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 1) return refuse("SEQ_INVALID");
  // Local time with its offset, so a reader needs no table; `Z` is refused on purpose.
  if (typeof at !== "string" || isoAtUtcMs(at) === null) return refuse("AT_INVALID");
  if (typeof atUtcMs !== "number" || !Number.isSafeInteger(atUtcMs) || atUtcMs < 0) return refuse("AT_UTC_MS_INVALID");
  if (isoAtUtcMs(at) !== atUtcMs) return refuse("AT_UTC_MS_MISMATCH");
  if (typeof attempt !== "string" || !/^[A-Za-z0-9._:-]{1,64}$/.test(attempt)) return refuse("ATTEMPT_INVALID");
  if (typeof anchorDay !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(anchorDay)
    || isoAtUtcMs(`${anchorDay}T00:00:00+00:00`) === null) return refuse("ANCHOR_DAY_INVALID");
  if (step !== null && !isStepId(step)) return refuse("STEP_INVALID");
  if (!isEntryKind(kind)) return refuse("KIND_INVALID");

  if (kind === "result") {
    if (!isOutcome(outcome)) return refuse("RESULT_WITHOUT_OUTCOME");
  } else if (outcome !== null) {
    return refuse("OUTCOME_ON_NON_RESULT");
  }
  if (kind === "result" || kind === "intent") {
    if (step === null) return refuse("STEP_REQUIRED");
  }
  const correctionSeq = ledgerCorrectionSeq(evidence);
  if (kind === "correction" && (correctionSeq === null || correctionSeq < 1 || correctionSeq > seq)) {
    return refuse("CORRECTION_SEQ_REQUIRED");
  }

  if (!isRecord(evidence)) return refuse("EVIDENCE_NOT_A_RECORD");
  const evidenceInspection = inspectLedgerValue(evidence, new WeakSet<object>());
  if (evidenceInspection === "secret") return refuse("SECRET_SHAPED_VALUE");
  if (evidenceInspection === "invalid") return refuse("EVIDENCE_NOT_JSON");

  if (nextOwnerAction !== null && (typeof nextOwnerAction !== "string" || nextOwnerAction.trim().length === 0)) return refuse("NEXT_OWNER_ACTION_INVALID");
  if (kind === "abort" && nextOwnerAction === null) return refuse("ABORT_WITHOUT_NEXT_OWNER_ACTION");
  if (typeof nextOwnerAction === "string") {
    if (secretShaped(nextOwnerAction)) return refuse("SECRET_SHAPED_VALUE");
  }

  return {
    ok: true,
    entry: {
      seq,
      at,
      atUtcMs,
      attempt,
      anchorDay,
      step,
      kind,
      outcome: kind === "result" && isOutcome(outcome) ? outcome : null,
      evidence,
      nextOwnerAction,
    },
  };
}

export function validateLedgerEntry(value: unknown): ValidatedEntry {
  try {
    return validateLedgerEntryUnsafe(value);
  } catch {
    return refuse("ENTRY_ACCESS_FAILED");
  }
}

/** Assigns `seq`, refuses a clock that runs backwards, and encodes one LF-terminated line with a stable field order. */
export function planLedgerAppend(tail: LedgerTail, draft: LedgerDraft): EncodedLine {
  if (!Number.isSafeInteger(tail.lastSeq) || tail.lastSeq < 0 || tail.lastSeq >= Number.MAX_SAFE_INTEGER) return refuse("TAIL_INVALID");
  const validated = validateLedgerEntry({ ...draft, seq: tail.lastSeq + 1 });
  if (!validated.ok) return validated;
  const entry = validated.entry;
  if (tail.lastAtUtcMs !== null && entry.atUtcMs < tail.lastAtUtcMs) return refuse("AT_NOT_MONOTONIC");
  const ordered = {
    seq: entry.seq,
    at: entry.at,
    atUtcMs: entry.atUtcMs,
    attempt: entry.attempt,
    anchorDay: entry.anchorDay,
    step: entry.step,
    kind: entry.kind,
    outcome: entry.outcome,
    evidence: entry.evidence,
    nextOwnerAction: entry.nextOwnerAction,
  };
  return { ok: true, line: `${JSON.stringify(ordered)}\n`, entry };
}

/**
 * Splits the ledger text. A final segment without its newline is torn; a
 * terminated line that is not valid JSON, fails the schema, breaks the `seq`
 * chain or runs the clock backwards is corrupt, and nothing after the first
 * corrupt line is trusted — the history is a chain.
 */
export function parseLedgerText(text: string, initialTail: LedgerTail = { lastSeq: 0, lastAtUtcMs: null }): ParsedLedger {
  const entries: LedgerEntry[] = [];
  const corrupt: { line: number; reason: string }[] = [];
  const segments = text.split("\n");
  const torn = segments.at(-1) ?? "";
  const terminated = segments.slice(0, -1);
  let expectedSeq = initialTail.lastSeq + 1;
  let lastAtUtcMs: number | null = initialTail.lastAtUtcMs;
  for (const [index, segment] of terminated.entries()) {
    const lineNumber = index + 1;
    if (corrupt.length > 0) {
      corrupt.push({ line: lineNumber, reason: "AFTER_CORRUPT_LINE" });
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(segment);
    } catch {
      corrupt.push({ line: lineNumber, reason: "NOT_JSON" });
      continue;
    }
    const validated = validateLedgerEntry(parsed);
    if (!validated.ok) {
      corrupt.push({ line: lineNumber, reason: validated.reason });
      continue;
    }
    if (JSON.stringify(validated.entry) !== segment) {
      corrupt.push({ line: lineNumber, reason: "NON_CANONICAL_LINE" });
      continue;
    }
    if (validated.entry.seq !== expectedSeq) {
      corrupt.push({ line: lineNumber, reason: "SEQ_NOT_CONTIGUOUS" });
      continue;
    }
    if (lastAtUtcMs !== null && validated.entry.atUtcMs < lastAtUtcMs) {
      corrupt.push({ line: lineNumber, reason: "AT_NOT_MONOTONIC" });
      continue;
    }
    entries.push(validated.entry);
    expectedSeq += 1;
    lastAtUtcMs = validated.entry.atUtcMs;
  }
  return { entries, torn: torn.length === 0 ? null : torn, corrupt };
}

/** The tail an append continues from: the last trusted entry, whatever came after it. */
export function ledgerTail(parsed: ParsedLedger): LedgerTail {
  const last = parsed.entries.at(-1);
  return { lastSeq: last?.seq ?? 0, lastAtUtcMs: last?.atUtcMs ?? null };
}

/** Whether the ledger can be trusted as it stands. Anything but `intact` means: the state is unknown, verify against the world. */
export function ledgerIntegrity(parsed: ParsedLedger): "intact" | "torn" | "corrupt" {
  if (parsed.corrupt.length > 0) return "corrupt";
  if (parsed.torn !== null) return "torn";
  return "intact";
}
