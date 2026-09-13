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
    || /healthchecks\.io\/(api|ping)/i.test(text);
}

function findSecretShapedValue(value: unknown, where: string): string | null {
  if (typeof value === "string") return secretShaped(value) ? where : null;
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    for (const [index, item] of items.entries()) {
      const hit = findSecretShapedValue(item, `${where}[${String(index)}]`);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (secretShaped(key)) return `${where}.${key}`;
      const hit = findSecretShapedValue(item, `${where}.${key}`);
      if (hit !== null) return hit;
    }
  }
  return null;
}

function refuse(reason: string): { readonly ok: false; readonly reason: string } {
  return { ok: false, reason };
}

/** The closed schema of one line. Missing and unknown fields are both refusals: a line is either exactly this or not a line. */
export function validateLedgerEntry(value: unknown): ValidatedEntry {
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
  if (typeof at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?[+-]\d{2}:\d{2}$/.test(at)) return refuse("AT_INVALID");
  if (typeof atUtcMs !== "number" || !Number.isSafeInteger(atUtcMs) || atUtcMs < 0) return refuse("AT_UTC_MS_INVALID");
  if (typeof attempt !== "string" || !/^[A-Za-z0-9._:-]{1,64}$/.test(attempt)) return refuse("ATTEMPT_INVALID");
  if (typeof anchorDay !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(anchorDay)) return refuse("ANCHOR_DAY_INVALID");
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

  if (!isRecord(evidence)) return refuse("EVIDENCE_NOT_A_RECORD");
  const leak = findSecretShapedValue(evidence, "evidence");
  if (leak !== null) return refuse(`SECRET_SHAPED_VALUE:${leak}`);

  if (nextOwnerAction !== null && (typeof nextOwnerAction !== "string" || nextOwnerAction.trim().length === 0)) return refuse("NEXT_OWNER_ACTION_INVALID");
  if (kind === "abort" && nextOwnerAction === null) return refuse("ABORT_WITHOUT_NEXT_OWNER_ACTION");
  if (typeof nextOwnerAction === "string") {
    const leakInAction = findSecretShapedValue(nextOwnerAction, "nextOwnerAction");
    if (leakInAction !== null) return refuse(`SECRET_SHAPED_VALUE:${leakInAction}`);
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
export function parseLedgerText(text: string): ParsedLedger {
  const entries: LedgerEntry[] = [];
  const corrupt: { line: number; reason: string }[] = [];
  const segments = text.split("\n");
  const torn = segments.at(-1) ?? "";
  const terminated = segments.slice(0, -1);
  let expectedSeq = 1;
  let lastAtUtcMs: number | null = null;
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
