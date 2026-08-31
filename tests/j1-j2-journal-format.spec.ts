import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { encodeJournalLine, isUtcIsoTimestamp, parseJournalText, planAppend, validateJournalEntry } from "../src/core/journal.js";
import { createMutationGateway, NO_BROKER_PORT } from "../src/shell/mutation-gateway.js";
import { resolveStateDir } from "../src/shell/state-dir.js";
import { TEST_ONLY_AT, TEST_ONLY_AT_MS, cycleEntry, draftOf, journalSnapshot, witnessEntry } from "./journal-fixtures.js";

const temporaryDirectories: string[] = [];
function temporaryStateDir(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "gbt-p2-"));
  temporaryDirectories.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function encodedLine(entry: Parameters<typeof encodeJournalLine>[0]): string {
  const encoded = encodeJournalLine(entry, []);
  if (!encoded.ok) throw new Error(encoded.reason);
  return encoded.line;
}

describe("S-J-01 journal format", () => {
  it("S-J-01 encodes one entry per line, appends only, and corrections reference the corrected entry", () => {
    const first = encodeJournalLine(cycleEntry(1), []);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.line.endsWith("\n")).toBe(true);
    expect(first.line.slice(0, -1)).not.toContain("\n");
    expect(first.line.slice(0, -1)).not.toContain("\r");
    const parsed = parseJournalText(first.line);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.torn).toBeNull();
    expect(parsed.corrupt).toEqual([]);

    // The gateway assigns `seq` under the writer lock; a draft never carries one.
    const tail = { lastSeq: 1, priorIntentRationales: [] as string[] };
    expect(planAppend(tail, draftOf(cycleEntry(9)), [])).toMatchObject({ ok: true, entry: { seq: 2 } });
    expect(planAppend(tail, cycleEntry(2), [])).toMatchObject({ ok: false, reason: "SEQ_ASSIGNED_BY_GATEWAY" });
    expect(planAppend(tail, draftOf(cycleEntry(2, { corrects: 1 })), [])).toMatchObject({ ok: true, entry: { seq: 2, corrects: 1 } });
    expect(planAppend(tail, draftOf(cycleEntry(2, { corrects: 2 })), [])).toMatchObject({ ok: false, reason: "CORRECTION_TARGET_INVALID" });
    expect(planAppend(tail, draftOf(cycleEntry(2, { corrects: 5 })), [])).toMatchObject({ ok: false, reason: "CORRECTION_TARGET_INVALID" });
    expect(planAppend(tail, draftOf(cycleEntry(2, { corrects: 0 })), [])).toMatchObject({ ok: false, reason: "CORRECTION_TARGET_INVALID" });
    expect(validateJournalEntry({ ...cycleEntry(2), corrects: "1" })).toMatchObject({ ok: false });
  });

  it("S-J-01 detects a torn last line in the parser and keeps every complete prior entry", () => {
    const one = encodedLine(cycleEntry(1));
    const two = encodedLine(cycleEntry(2));
    const parsed = parseJournalText(one + two + two.slice(0, 40));
    expect(parsed.entries.map(entry => entry.seq)).toEqual([1, 2]);
    expect(parsed.torn).toBe(two.slice(0, 40));
    expect(parsed.corrupt).toEqual([]);

    const midCorrupt = parseJournalText(one + "{not json}\n" + two);
    expect(midCorrupt.entries.map(entry => entry.seq)).toEqual([1]);
    expect(midCorrupt.corrupt).toHaveLength(2);
    expect(midCorrupt.torn).toBeNull();

    const gap = parseJournalText(one + encodedLine(cycleEntry(3)));
    expect(gap.corrupt).toEqual([{ line: 2, reason: "SEQ_NOT_CONTIGUOUS" }]);
    expect(parseJournalText("")).toEqual({ entries: [], torn: null, corrupt: [] });
  });

  it("S-J-01 quarantines a torn tail on open, appends after it on a clean boundary, and never rewrites history", async () => {
    const stateDir = temporaryStateDir();
    const paths = resolveStateDir(stateDir);
    if (!paths.ok) throw new Error(paths.reason);
    const one = encodedLine(cycleEntry(1));
    const two = encodedLine(cycleEntry(2));
    const tornFragment = two.slice(0, 57);
    writeFileSync(paths.value.journal, one + two + tornFragment, "utf8");
    writeFileSync(paths.value.epoch, JSON.stringify({ epoch: 1, holderId: "writer-a", acquiredAt: TEST_ONLY_AT }), "utf8");

    const gateway = createMutationGateway({ paths: paths.value, secrets: [], clock: () => TEST_ONLY_AT_MS, brokerPort: NO_BROKER_PORT, instanceId: "writer-a", lockTakeoverBoundMs: 60_000 });
    const opened = await gateway.openJournal();
    expect(opened.entries.map(entry => entry.seq)).toEqual([1, 2]);
    expect(opened.quarantined).toHaveLength(1);
    const quarantineFiles = readdirSync(paths.value.quarantineDir);
    expect(quarantineFiles).toHaveLength(1);
    expect(readFileSync(path.join(paths.value.quarantineDir, quarantineFiles[0]!), "utf8")).toBe(tornFragment);
    expect(readFileSync(paths.value.journal, "utf8")).toBe(one + two);

    const appended = await gateway.dispatch({ class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: draftOf(cycleEntry(3)) } });
    expect(appended).toMatchObject({ ok: true, seq: 3 });
    const text = readFileSync(paths.value.journal, "utf8");
    expect(text.startsWith(one + two)).toBe(true);
    expect(parseJournalText(text).entries.map(entry => entry.seq)).toEqual([1, 2, 3]);

    const reopened = await gateway.openJournal();
    expect(reopened.quarantined).toHaveLength(0);
    expect(reopened.entries).toHaveLength(3);
  });

  it("S-J-01 refuses to open a journal whose history (not its tail) is corrupt", async () => {
    const stateDir = temporaryStateDir();
    const paths = resolveStateDir(stateDir);
    if (!paths.ok) throw new Error(paths.reason);
    writeFileSync(paths.value.journal, encodedLine(cycleEntry(1)) + "{garbage}\n" + encodedLine(cycleEntry(3)), "utf8");
    writeFileSync(paths.value.epoch, JSON.stringify({ epoch: 1, holderId: "writer-a", acquiredAt: TEST_ONLY_AT }), "utf8");
    const gateway = createMutationGateway({ paths: paths.value, secrets: [], clock: () => TEST_ONLY_AT_MS, brokerPort: NO_BROKER_PORT, instanceId: "writer-a", lockTakeoverBoundMs: 60_000 });
    await expect(gateway.openJournal()).rejects.toThrow(/corrupt/u);
    const appended = await gateway.dispatch({ class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: draftOf(cycleEntry(4)) } });
    expect(appended).toMatchObject({ ok: false, reason: "JOURNAL_CORRUPT" });
  });
});

describe("S-J-02 timestamps", () => {
  it("S-J-02 accepts only UTC ISO-8601 for journal times and keeps broker timestamps verbatim beside them", () => {
    expect(isUtcIsoTimestamp("2026-08-31T13:30:00.000Z")).toBe(true);
    expect(isUtcIsoTimestamp("2026-08-31T13:30:00Z")).toBe(true);
    expect(isUtcIsoTimestamp("2026-08-31T15:30:00+02:00")).toBe(false);
    expect(isUtcIsoTimestamp("2026-08-31 13:30:00Z")).toBe(false);
    expect(isUtcIsoTimestamp("2026-08-31T13:30:00.000")).toBe(false);
    expect(isUtcIsoTimestamp("2026-13-31T13:30:00Z")).toBe(false);
    expect(isUtcIsoTimestamp("2026-02-30T13:30:00Z")).toBe(false);
    expect(isUtcIsoTimestamp("2026-08-31T24:00:00Z")).toBe(false);
    expect(isUtcIsoTimestamp("2026-08-31T13:30:00.1234567Z")).toBe(false);

    expect(validateJournalEntry(cycleEntry(1, { at: "2026-08-31T15:30:00+02:00" }))).toMatchObject({ ok: false, reason: expect.stringContaining("at") });
    expect(validateJournalEntry(cycleEntry(1, { snapshot: journalSnapshot({ snapshotAt: "2026-08-31T15:30:00 CEST" }) }))).toMatchObject({ ok: false });
    const verbatim = "2026-08-31T13:29:59.871234567-04:00";
    const entry = cycleEntry(1, {
      snapshot: journalSnapshot({
        quoteSamples: { SPY: { SPY260904C00500000: { bidCents: 100, askCents: 102, bidSize: 20, askSize: 20, quotedAt: TEST_ONLY_AT, brokerQuotedAt: verbatim } } },
        openOrders: [{ brokerOrderId: "b-1", clientOrderId: "entry:x", status: "accepted", brokerSubmittedAt: "2026-08-31T09:29:59.87-04:00" }],
      }),
    });
    expect(validateJournalEntry(entry)).toMatchObject({ ok: true });
    const line = encodedLine(entry);
    expect(line).toContain(verbatim);
    expect(line).toContain("2026-08-31T09:29:59.87-04:00");
    expect(line).toContain(`"quotedAt":"${TEST_ONLY_AT}"`);
    expect(validateJournalEntry(witnessEntry(1, "SUPPRESSED", { at: "31.08.2026 15:30" }))).toMatchObject({ ok: false });
  });
});
