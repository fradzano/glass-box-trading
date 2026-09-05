// Live finding six (2026-09-02): the entry-lifecycle terminality resolver
// registered every journaled close OUTCOME as an unknown, invalid entry, so
// the certificate driver refused its fence drill ("unresolved entry
// lifecycle(s): close:…:g0") as soon as a close fill had been journaled, and
// the certificate core would have failed a run whose close fill landed inside
// its window. The golden journal carries exactly that shape: an entry INTENT
// and its filled OUTCOME, then a deadline close INTENT and its filled OUTCOME.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { unresolvedEntryLifecycleIds } from "../src/core/execution.js";
import { parseJournalText } from "../src/core/journal.js";
import type { JournalEntry } from "../src/core/journal.js";

const GOLDEN = path.resolve("fixtures/golden-journal.jsonl");

function goldenEntries(): readonly JournalEntry[] {
  const parsed = parseJournalText(readFileSync(GOLDEN, "utf8"));
  if (parsed.entries.length === 0) throw new Error("golden journal is empty");
  return parsed.entries;
}

describe("entry-lifecycle terminality ignores close attempts (S-G7 close fold owns them)", () => {
  it("the golden journal — entry filled, deadline close filled — has no unresolved entry lifecycle", () => {
    const entries = goldenEntries();
    const closeIds = entries.filter(entry => entry.type === "INTENT" && entry["action"] === "close").map(entry => entry["clientOrderId"]);
    expect(closeIds).toHaveLength(1);
    expect(entries.some(entry => entry.type === "OUTCOME" && entry["clientOrderId"] === closeIds[0] && entry["status"] === "filled")).toBe(true);
    expect(unresolvedEntryLifecycleIds(entries)).toEqual([]);
  });

  it("a close OUTCOME without a close INTENT is still an unknown order and stays unresolved (foreign evidence is never adopted)", () => {
    const entries = goldenEntries();
    const closeOutcome = entries.find(entry => entry.type === "OUTCOME" && String(entry["clientOrderId"]).startsWith("close:"));
    if (closeOutcome === undefined) throw new Error("golden journal has no close OUTCOME");
    const withoutCloseIntent = entries.filter(entry => !(entry.type === "INTENT" && entry["action"] === "close"));
    expect(unresolvedEntryLifecycleIds(withoutCloseIntent)).toEqual([closeOutcome["clientOrderId"]]);
  });

  it("an entry whose close is still resting stays resolved on the entry side: the resting close is the close fold's business", () => {
    const entries = goldenEntries();
    const withoutCloseOutcome = entries.filter(entry => !(entry.type === "OUTCOME" && String(entry["clientOrderId"]).startsWith("close:")));
    expect(unresolvedEntryLifecycleIds(withoutCloseOutcome)).toEqual([]);
  });
});
