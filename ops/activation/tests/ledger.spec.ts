// Spec §4: what counts as a line of the activation ledger. Every refusal here is
// a way a later session could otherwise misread the only memory the activation
// has — a skipped seq, a clock running backwards, a torn line read as a
// completed step, or a ping credential written where people read.
import { describe, expect, it } from "vitest";
import { ledgerIntegrity, ledgerTail, parseLedgerText, planLedgerAppend, validateLedgerEntry } from "../core/ledger.ts";
import type { LedgerDraft } from "../core/ledger.ts";

function draft(overrides: Partial<LedgerDraft> = {}): LedgerDraft {
  return {
    at: "2026-09-21T15:35:02+02:00",
    atUtcMs: 1_789_997_702_000,
    attempt: "a1",
    anchorDay: "2026-09-22",
    step: "0-preflight",
    kind: "intent",
    outcome: null,
    evidence: {},
    nextOwnerAction: null,
    ...overrides,
  };
}

function encode(entries: readonly LedgerDraft[]): string {
  let text = "";
  let tail = { lastSeq: 0, lastAtUtcMs: null as number | null };
  for (const entry of entries) {
    const planned = planLedgerAppend(tail, entry);
    if (!planned.ok) throw new Error(planned.reason);
    text += planned.line;
    tail = { lastSeq: planned.entry.seq, lastAtUtcMs: planned.entry.atUtcMs };
  }
  return text;
}

describe("activation ledger — the codec", () => {
  it("round-trips entries, assigning seq from 1 and keeping a stable field order", () => {
    const text = encode([draft(), draft({ kind: "result", outcome: "ok", atUtcMs: 1_789_997_703_000, at: "2026-09-21T15:35:03+02:00" })]);
    const parsed = parseLedgerText(text);
    expect(parsed.corrupt).toEqual([]);
    expect(parsed.torn).toBeNull();
    expect(parsed.entries.map(entry => entry.seq)).toEqual([1, 2]);
    expect(parsed.entries[1]?.outcome).toBe("ok");
    expect(text.split("\n")[0]?.startsWith('{"seq":1,"at":')).toBe(true);
    expect(ledgerIntegrity(parsed)).toBe("intact");
    expect(ledgerTail(parsed)).toEqual({ lastSeq: 2, lastAtUtcMs: 1_789_997_703_000 });
  });

  it("reads an empty ledger as no entries, not as a torn line", () => {
    const parsed = parseLedgerText("");
    expect(parsed.entries).toEqual([]);
    expect(parsed.torn).toBeNull();
    expect(ledgerTail(parsed)).toEqual({ lastSeq: 0, lastAtUtcMs: null });
  });

  it("keeps a torn final line apart from the history instead of reading it as a completed step", () => {
    const whole = encode([draft()]);
    const partial = encode([draft(), draft({ kind: "result", outcome: "ok" })]).slice(whole.length, -10);
    const parsed = parseLedgerText(whole + partial);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.torn).not.toBeNull();
    expect(ledgerIntegrity(parsed)).toBe("torn");
  });

  it("refuses a seq gap and trusts nothing after it", () => {
    const text = encode([draft(), draft()]);
    const lines = text.split("\n");
    const gapped = [lines[0], (lines[1] ?? "").replace('"seq":2', '"seq":3'), lines[0]?.replace('"seq":1', '"seq":4'), ""].join("\n");
    const parsed = parseLedgerText(gapped);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.corrupt).toEqual([{ line: 2, reason: "SEQ_NOT_CONTIGUOUS" }, { line: 3, reason: "AFTER_CORRUPT_LINE" }]);
    expect(ledgerIntegrity(parsed)).toBe("corrupt");
  });

  it("refuses a clock that runs backwards, at append and at read", () => {
    const planned = planLedgerAppend(
      { lastSeq: 1, lastAtUtcMs: 1_789_997_703_000 },
      draft({ at: "2026-09-21T15:35:02+02:00", atUtcMs: 1_789_997_702_000 }),
    );
    expect(planned).toEqual({ ok: false, reason: "AT_NOT_MONOTONIC" });

    const text = encode([draft({ at: "2026-09-21T15:35:03+02:00", atUtcMs: 1_789_997_703_000 })])
      + encode([draft({ at: "2026-09-21T15:35:02+02:00", atUtcMs: 1_789_997_702_000 })]).replace('"seq":1', '"seq":2');
    expect(parseLedgerText(text).corrupt).toEqual([{ line: 2, reason: "AT_NOT_MONOTONIC" }]);
  });

  it("binds the offset timestamp to atUtcMs and refuses impossible civil times", () => {
    expect(validateLedgerEntry({ seq: 1, ...draft({ at: "2026-09-20T15:35:02+02:00" }) }))
      .toEqual({ ok: false, reason: "AT_UTC_MS_MISMATCH" });
    expect(validateLedgerEntry({ seq: 1, ...draft({ at: "2026-99-99T99:99:99+14:30" }) }))
      .toEqual({ ok: false, reason: "AT_INVALID" });
    expect(validateLedgerEntry({ seq: 1, ...draft({ at: "2026-02-30T15:35:02+02:00", atUtcMs: 1_772_458_502_000 }) }))
      .toEqual({ ok: false, reason: "AT_INVALID" });
    expect(validateLedgerEntry({ seq: 1, ...draft({ at: "2026-09-21T15:35:02+14:30", atUtcMs: 1_789_952_702_000 }) }))
      .toEqual({ ok: false, reason: "AT_INVALID" });
  });

  it("refuses byte-regenerated lines including CRLF and duplicate JSON keys", () => {
    const line = encode([draft()]).slice(0, -1);
    expect(parseLedgerText(`${line}\r\n`).corrupt).toEqual([{ line: 1, reason: "NON_CANONICAL_LINE" }]);
    const duplicated = line.replace('"evidence":{}', '"evidence":{"shadow":"Bearer hidden"},"evidence":{}');
    expect(parseLedgerText(`${duplicated}\n`).corrupt).toEqual([{ line: 1, reason: "NON_CANONICAL_LINE" }]);
  });

  it("refuses a line that is not JSON", () => {
    expect(parseLedgerText("not json\n").corrupt).toEqual([{ line: 1, reason: "NOT_JSON" }]);
  });
});

describe("activation ledger — the closed schema", () => {
  const valid = { seq: 1, ...draft() };

  it("accepts exactly the schema", () => {
    expect(validateLedgerEntry(valid).ok).toBe(true);
  });

  it("refuses unknown and missing fields alike", () => {
    expect(validateLedgerEntry({ ...valid, extra: 1 })).toEqual({ ok: false, reason: "UNKNOWN_FIELD:extra" });
    const missing = Object.fromEntries(Object.entries(valid).filter(([key]) => key !== "attempt"));
    expect(validateLedgerEntry(missing)).toEqual({ ok: false, reason: "MISSING_FIELD:attempt" });
  });

  it("requires an offset in `at` and refuses a bare UTC `Z`, so a reader never needs a table", () => {
    expect(validateLedgerEntry({ ...valid, at: "2026-09-21T13:35:02Z" })).toEqual({ ok: false, reason: "AT_INVALID" });
  });

  it("ties `outcome` to results and requires a step on intents and results", () => {
    expect(validateLedgerEntry({ ...valid, kind: "result", outcome: null })).toEqual({ ok: false, reason: "RESULT_WITHOUT_OUTCOME" });
    expect(validateLedgerEntry({ ...valid, kind: "intent", outcome: "ok" })).toEqual({ ok: false, reason: "OUTCOME_ON_NON_RESULT" });
    expect(validateLedgerEntry({ ...valid, step: null })).toEqual({ ok: false, reason: "STEP_REQUIRED" });
    expect(validateLedgerEntry({ ...valid, step: "12-bogus" })).toEqual({ ok: false, reason: "STEP_INVALID" });
  });

  it("requires every abort to name the owner's next action, and allows the owner's own abort without a step", () => {
    expect(validateLedgerEntry({ ...valid, kind: "abort" })).toEqual({ ok: false, reason: "ABORT_WITHOUT_NEXT_OWNER_ACTION" });
    expect(validateLedgerEntry({ ...valid, kind: "abort", step: null, nextOwnerAction: "Nothing is armed; decide whether to retry tomorrow." }).ok).toBe(true);
    expect(validateLedgerEntry({ ...valid, kind: "abort", nextOwnerAction: "   " })).toEqual({ ok: false, reason: "NEXT_OWNER_ACTION_INVALID" });
  });

  it("refuses evidence that carries a check UUID or a ping URL, and accepts a fingerprint", () => {
    expect(validateLedgerEntry({ ...valid, evidence: { check: "00000000-0000-4000-8000-000000000000" } })).toEqual({ ok: false, reason: "SECRET_SHAPED_VALUE" });
    expect(validateLedgerEntry({ ...valid, evidence: { pings: ["ok", "https://hc-ping.com/abc"] } })).toEqual({ ok: false, reason: "SECRET_SHAPED_VALUE" });
    expect(validateLedgerEntry({ ...valid, kind: "abort", nextOwnerAction: "resume via https://healthchecks.io/api/v3/checks" })).toEqual({ ok: false, reason: "SECRET_SHAPED_VALUE" });
    expect(validateLedgerEntry({ ...valid, evidence: { readiness: "hc:c4ad5b69", status: "up" } }).ok).toBe(true);
  });

  it("refuses other credential shapes without echoing the credential in its reason", () => {
    for (const value of ["PA349COOGKZ1", "PKABCDEFGHIJKLMNOP", "sk-ant-api03-secret", "Bearer secret-value"]) {
      const result = validateLedgerEntry({ ...valid, evidence: { value } });
      expect(result).toEqual({ ok: false, reason: "SECRET_SHAPED_VALUE" });
      if (!result.ok) expect(result.reason).not.toContain(value);
    }
  });

  it("rejects credential-bearing evidence field names and unreferenced corrections", () => {
    expect(validateLedgerEntry({ ...valid, evidence: { apiKey: "masked-ish" } }))
      .toEqual({ ok: false, reason: "SECRET_SHAPED_VALUE" });
    expect(validateLedgerEntry({ ...valid, kind: "correction", step: null, evidence: {} }))
      .toEqual({ ok: false, reason: "CORRECTION_SEQ_REQUIRED" });
    expect(validateLedgerEntry({ ...valid, kind: "correction", step: null, evidence: { correctedSeq: 1 } }).ok).toBe(true);
  });

  it("rejects nested credential-like field names without invoking accessors", () => {
    for (const key of ["alpacaSecretKey", "serviceAccessToken", "authorizationHeader"]) {
      expect(validateLedgerEntry({ ...valid, evidence: { [key]: "opaque" } }))
        .toEqual({ ok: false, reason: "SECRET_SHAPED_VALUE" });
    }
    const evidence = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(evidence, "value", { enumerable: true, get() { throw new Error("Bearer must-not-escape"); } });
    expect(validateLedgerEntry({ ...valid, evidence })).toEqual({ ok: false, reason: "EVIDENCE_NOT_JSON" });
    const hostile = new Proxy({}, { ownKeys() { throw new Error("Bearer must-not-escape"); } });
    expect(validateLedgerEntry({ ...valid, evidence: hostile })).toEqual({ ok: false, reason: "ENTRY_ACCESS_FAILED" });
  });

  it("requires corrections to reference a real-or-damaged sequence no later than themselves", () => {
    for (const correctedSeq of [-1, 0, 2, 999_999]) {
      expect(validateLedgerEntry({ ...valid, kind: "correction", step: null, evidence: { correctedSeq } }))
        .toEqual({ ok: false, reason: "CORRECTION_SEQ_REQUIRED" });
    }
    expect(validateLedgerEntry({ ...valid, kind: "correction", step: null, evidence: { damagedSeq: 1 } }).ok).toBe(true);
  });

  it("rejects impossible anchor days", () => {
    expect(validateLedgerEntry({ ...valid, anchorDay: "2026-99-99" })).toEqual({ ok: false, reason: "ANCHOR_DAY_INVALID" });
    expect(validateLedgerEntry({ ...valid, anchorDay: "2026-02-30" })).toEqual({ ok: false, reason: "ANCHOR_DAY_INVALID" });
  });

  it("refuses evidence that JSON cannot represent as the same closed value", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    for (const evidence of [{ value: 1n }, { value: Number.NaN }, { value: undefined }, cyclic]) {
      expect(validateLedgerEntry({ ...valid, evidence })).toEqual({ ok: false, reason: "EVIDENCE_NOT_JSON" });
    }
  });
});
