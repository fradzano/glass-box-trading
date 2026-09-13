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
    const planned = planLedgerAppend({ lastSeq: 1, lastAtUtcMs: 2_000 }, draft({ atUtcMs: 1_000 }));
    expect(planned).toEqual({ ok: false, reason: "AT_NOT_MONOTONIC" });

    const text = encode([draft({ atUtcMs: 5_000 })]) + encode([draft({ atUtcMs: 4_000 })]).replace('"seq":1', '"seq":2');
    expect(parseLedgerText(text).corrupt).toEqual([{ line: 2, reason: "AT_NOT_MONOTONIC" }]);
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
    expect(validateLedgerEntry({ ...valid, evidence: { check: "31a4eae7-f576-4e4a-8d49-a97c64ad5b58" } })).toEqual({ ok: false, reason: "SECRET_SHAPED_VALUE:evidence.check" });
    expect(validateLedgerEntry({ ...valid, evidence: { pings: ["ok", "https://hc-ping.com/abc"] } })).toEqual({ ok: false, reason: "SECRET_SHAPED_VALUE:evidence.pings[1]" });
    expect(validateLedgerEntry({ ...valid, kind: "abort", nextOwnerAction: "resume via https://healthchecks.io/api/v3/checks" })).toEqual({ ok: false, reason: "SECRET_SHAPED_VALUE:nextOwnerAction" });
    expect(validateLedgerEntry({ ...valid, evidence: { readiness: "hc:c4ad5b69", status: "up" } }).ok).toBe(true);
  });
});
