import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isPrimaryEntryType,
  isWitnessEntryType,
  journalEntryTypes,
  latestQuoteSamples,
  outcomeStatuses,
  planAppend,
  primaryEntryTypes,
  reasonCodes,
  requestClassOf,
  validateJournalEntry,
  witnessEntryTypes,
} from "../src/core/journal.js";
import type { JournalEntry, JournalEntryType } from "../src/core/journal.js";
import { TEST_ONLY_ACCOUNT_ID, TEST_ONLY_AT, TEST_ONLY_ORIGIN, cycleEntry, draftOf, intentEntry, journalSnapshot, witnessEntry } from "./journal-fixtures.js";

const binding = { profile: "dev", tradingOrigin: TEST_ONLY_ORIGIN, accountId: TEST_ONLY_ACCOUNT_ID };
const envelope = { at: TEST_ONLY_AT, epoch: 1 };

/** One minimal valid entry per closed-set type: the schema oracle for S-J-03. */
export function minimalEntry(type: JournalEntryType, seq = 1): JournalEntry {
  const bodies: Record<JournalEntryType, Record<string, unknown>> = {
    CYCLE: { cycleIndex: 7, tradingDay: "2026-08-31", reasonCodes: [], snapshot: journalSnapshot(), batchVerdicts: [], candidateVerdicts: [] },
    BOOTSTRAP: { snapshot: journalSnapshot(), epochSeeded: true },
    INTENT: intentEntry(seq),
    OUTCOME: { clientOrderId: "entry:x", status: "filled", brokerOrderId: "b-1", brokerTimestamps: { filled_at: "2026-08-31T09:31:00.123456-04:00" }, filledQuantity: 1, avgFillPriceCents: 101, reasonCodes: [], binding },
    RECONCILIATION: { reasonCodes: ["WORLD_PARTIAL"], items: [{ kind: "order", brokerId: "b-1", classification: "MATCHED" }] },
    HUMAN_ACTION: { operator: "felix", description: "manual note" },
    GAP: { reasonCodes: [], snapshot: null, detail: "empty journal facing a non-empty account" },
    SKIP: { reasonCodes: ["WORLD_UNREACHABLE"], snapshot: null },
    SUPPRESSED: { instanceId: "second", holderId: "first", reason: "LOCK_HELD" },
    FENCED_OUT: { instanceId: "old", staleEpoch: 1, observedEpoch: 2 },
    HALT: { reason: "MANUAL", detail: "operator halt", sticky: false },
    UNHALT: { operator: "felix", reason: "resumed after review", actor: "human" },
    KILL: { equityCents: 9_000_000, thresholdCents: 9_500_000 },
    DEADLINE_RECONCILIATION: { reasonCodes: [], snapshot: journalSnapshot() },
    TERMINAL: { reasonCodes: [], snapshot: journalSnapshot() },
  };
  const body = Object.fromEntries(Object.entries(bodies[type]).filter(([key]) => key !== "seq" && key !== "at" && key !== "type" && key !== "epoch"));
  const epoch = isWitnessEntryType(type) ? null : 1;
  return { seq, ...envelope, epoch, type, ...body };
}

describe("S-J-03 closed entry schemas", () => {
  it("S-J-03 accepts exactly the closed set of entry types and rejects everything outside it", () => {
    expect([...journalEntryTypes()].sort()).toEqual([
      "BOOTSTRAP", "CYCLE", "DEADLINE_RECONCILIATION", "FENCED_OUT", "GAP", "HALT", "HUMAN_ACTION", "INTENT", "KILL",
      "OUTCOME", "RECONCILIATION", "SKIP", "SUPPRESSED", "TERMINAL", "UNHALT",
    ]);
    for (const type of journalEntryTypes()) {
      expect(validateJournalEntry(minimalEntry(type)), type).toMatchObject({ ok: true });
    }
    expect(validateJournalEntry({ ...minimalEntry("CYCLE"), type: "WORLD_UNREACHABLE" })).toMatchObject({ ok: false, reason: "UNKNOWN_ENTRY_TYPE" });
    expect(validateJournalEntry({ ...minimalEntry("CYCLE"), type: "AUTH_FAILURE" })).toMatchObject({ ok: false, reason: "UNKNOWN_ENTRY_TYPE" });
    expect(validateJournalEntry({ ...minimalEntry("CYCLE"), extra: 1 })).toMatchObject({ ok: false, reason: "UNEXPECTED_KEY" });
    expect(validateJournalEntry({ ...minimalEntry("CYCLE"), env: { ALPACA_KEY: "x" } })).toMatchObject({ ok: false, reason: "UNEXPECTED_KEY" });
    expect(validateJournalEntry(null)).toMatchObject({ ok: false });
    expect(validateJournalEntry([])).toMatchObject({ ok: false });
    expect(validateJournalEntry(Object.create({ seq: 1 }))).toMatchObject({ ok: false });
    expect(validateJournalEntry({ ...minimalEntry("CYCLE"), seq: 0 })).toMatchObject({ ok: false });
    expect(validateJournalEntry({ ...minimalEntry("CYCLE"), seq: 1.5 })).toMatchObject({ ok: false });
    expect(validateJournalEntry({ ...minimalEntry("CYCLE"), epoch: null })).toMatchObject({ ok: false, reason: "EPOCH_REQUIRED" });
    expect(validateJournalEntry({ ...minimalEntry("SUPPRESSED"), epoch: 1 })).toMatchObject({ ok: false, reason: "WITNESS_CARRIES_NO_EPOCH" });
  });

  it("S-J-03 keeps reason codes and outcome statuses inside closed sets and makes a rejection unreadable as an execution", () => {
    expect([...reasonCodes()].sort()).toEqual([
      "AUDIT_GAP_EMERGENCY_CLOSE", "AUTH_FAILURE", "BROKER_PRICE_BREACH", "COMPETITIVENESS_AT_RISK", "CONFIG_INVALID", "CONFIG_INVALID_STATE_DIR",
      "DECLARED_EXPIRY_HOLD", "NOT_SUBMITTED", "PROVENANCE_BROKEN", "REVALIDATION_VOID", "SCHEMA_VETO", "STALE_SNAPSHOT", "WINNING_ACCEPTANCE_FAILED",
      "WORLD_PARTIAL", "WORLD_UNREACHABLE",
    ]);
    expect([...outcomeStatuses()].sort()).toEqual(["canceled", "confirmation_unclear", "expired", "filled", "partially_filled", "rejected"]);
    expect(validateJournalEntry(cycleEntry(1, { reasonCodes: ["AUTH_FAILURE", "WORLD_PARTIAL"] }))).toMatchObject({ ok: true });
    expect(validateJournalEntry(cycleEntry(1, { reasonCodes: ["HALTED"] }))).toMatchObject({ ok: false, reason: "UNKNOWN_REASON_CODE" });
    expect(validateJournalEntry(cycleEntry(1, { reasonCodes: "AUTH_FAILURE" }))).toMatchObject({ ok: false });
    const outcome = minimalEntry("OUTCOME") as unknown as Record<string, unknown>;
    expect(validateJournalEntry({ ...outcome, status: "executed" })).toMatchObject({ ok: false, reason: "UNKNOWN_OUTCOME_STATUS" });
    // Since P3 (S-X-03) a rejection must carry the broker's reason verbatim; a reasonless rejection is refused.
    expect(validateJournalEntry({ ...outcome, status: "rejected", filledQuantity: 0, avgFillPriceCents: null, brokerReason: "insufficient options buying power" })).toMatchObject({ ok: true });
    expect(validateJournalEntry({ ...outcome, status: "rejected", filledQuantity: 0, avgFillPriceCents: null })).toMatchObject({ ok: false, reason: "REJECTION_WITHOUT_BROKER_REASON" });
    expect(validateJournalEntry({ ...outcome, status: "rejected" })).toMatchObject({ ok: false, reason: "REJECTION_CARRIES_FILL" });
    expect(validateJournalEntry({ ...outcome, status: "rejected", filledQuantity: 0, avgFillPriceCents: 101 })).toMatchObject({ ok: false, reason: "REJECTION_CARRIES_FILL" });
    expect(validateJournalEntry({ ...outcome, status: "filled", filledQuantity: 0 })).toMatchObject({ ok: false });
    expect(validateJournalEntry({ ...outcome, brokerTimestamps: { filled_at: 1_788_183_000 } })).toMatchObject({ ok: false });
  });

  it("S-J-03 defines primary substitutes and the witness class from exactly one source (KGV-1-REG)", () => {
    expect([...primaryEntryTypes()].sort()).toEqual(["BOOTSTRAP", "CYCLE", "FENCED_OUT", "GAP", "SKIP", "SUPPRESSED"]);
    expect([...witnessEntryTypes()]).toEqual(["SUPPRESSED", "FENCED_OUT"]);
    expect(isPrimaryEntryType("FENCED_OUT")).toBe(true);
    expect(isWitnessEntryType("FENCED_OUT")).toBe(true);
    expect(requestClassOf("FENCED_OUT")).toBe("witness");
    expect(requestClassOf("SUPPRESSED")).toBe("witness");
    for (const type of journalEntryTypes()) {
      if (type !== "SUPPRESSED" && type !== "FENCED_OUT") expect(requestClassOf(type), type).toBe("authoritative");
    }
    expect(validateJournalEntry(witnessEntry(1, "FENCED_OUT"))).toMatchObject({ ok: true });
    // Exactly one array literal in src/** names the witness class; every other site derives from it.
    const sourceFiles: string[] = [];
    const walk = (directory: string): void => {
      for (const name of readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, name.name);
        if (name.isDirectory()) walk(full);
        else if (name.name.endsWith(".ts")) sourceFiles.push(full);
      }
    };
    walk(path.resolve("src"));
    const witnessLiteralSites = sourceFiles.filter(file => /\[\s*"SUPPRESSED"\s*,\s*"FENCED_OUT"\s*\]/u.test(readFileSync(file, "utf8")));
    expect(witnessLiteralSites.map(file => path.relative(path.resolve("src"), file).replaceAll("\\", "/"))).toEqual(["core/journal.ts"]);
    expect(readFileSync(path.resolve("src/core/journal.ts"), "utf8").match(/\[\s*"SUPPRESSED"\s*,\s*"FENCED_OUT"\s*\]/gu)).toHaveLength(1);
  });

  it("S-J-03 requires quote samples and the account summary on snapshot-bearing primaries and lets SUPPRESSED leave a hole (KGV-11)", () => {
    for (const type of ["CYCLE", "BOOTSTRAP", "DEADLINE_RECONCILIATION", "TERMINAL"] as const) {
      const base = minimalEntry(type) as unknown as Record<string, unknown>;
      expect(validateJournalEntry({ ...base, snapshot: null }), type).toMatchObject({ ok: false });
      const snapshotValue = base["snapshot"] as Record<string, unknown>;
      expect(validateJournalEntry({ ...base, snapshot: { ...snapshotValue, quoteSamples: undefined } }), type).toMatchObject({ ok: false });
      expect(validateJournalEntry({ ...base, snapshot: { ...snapshotValue, positions: undefined } }), type).toMatchObject({ ok: false });
      expect(validateJournalEntry({ ...base, snapshot: { ...snapshotValue, openOrders: "none" } }), type).toMatchObject({ ok: false });
      expect(validateJournalEntry({ ...base, snapshot: { ...snapshotValue, accountId: "" } }), type).toMatchObject({ ok: false });
      expect(validateJournalEntry({ ...base, snapshot: { ...snapshotValue, cashCents: 1.5 } }), type).toMatchObject({ ok: false });
    }
    const skipWithSnapshot = { ...(minimalEntry("SKIP") as unknown as Record<string, unknown>), snapshot: journalSnapshot() };
    expect(validateJournalEntry(skipWithSnapshot)).toMatchObject({ ok: true });
    expect(validateJournalEntry({ ...skipWithSnapshot, snapshot: journalSnapshot({ quoteSamples: {} }) })).toMatchObject({ ok: true });
    expect(validateJournalEntry({ ...(minimalEntry("SUPPRESSED") as unknown as Record<string, unknown>), snapshot: journalSnapshot() })).toMatchObject({ ok: false, reason: "UNEXPECTED_KEY" });

    const laterSample = journalSnapshot({
      snapshotAt: "2026-08-31T13:45:00.000Z",
      quoteSamples: { SPY: { SPY260904C00500000: { bidCents: 110, askCents: 112, bidSize: 5, askSize: 5, quotedAt: "2026-08-31T13:45:00.000Z", brokerQuotedAt: "x" } } },
    });
    const entries = [
      cycleEntry(1),
      { ...minimalEntry("SKIP", 2), snapshot: laterSample } as unknown as JournalEntry,
      { ...minimalEntry("SUPPRESSED", 3), at: "2026-08-31T14:00:00.000Z" } as unknown as JournalEntry,
    ];
    const latest = latestQuoteSamples(entries);
    expect(latest["SPY"]).toEqual({ observedAt: "2026-08-31T13:45:00.000Z", quotesByContract: laterSample.quoteSamples["SPY"] });
    expect(latestQuoteSamples([entries[2]!])).toEqual({});
    expect(latestQuoteSamples([entries[0]!, { ...minimalEntry("SKIP", 2), snapshot: null }])["SPY"]?.observedAt).toBe(TEST_ONLY_AT);
  });
});

describe("S-J-04 INTENT content", () => {
  it("S-J-04 carries the full intent and enforces the rationale floor: paid-from, a snapshot reference, naming, and lifetime uniqueness", () => {
    expect(validateJournalEntry(intentEntry(1))).toMatchObject({ ok: true });
    for (const key of ["sleeve", "structureType", "legs", "submittedLimit", "reservedMaxLossCents", "clientOrderId", "gateVector", "rationale", "binding", "quantity", "exposureLifecycleId"]) {
      const stripped = Object.fromEntries(Object.entries(intentEntry(1)).filter(([name]) => name !== key));
      expect(validateJournalEntry(stripped), key).toMatchObject({ ok: false });
    }
    expect(validateJournalEntry(intentEntry(1, { gateVector: [] }))).toMatchObject({ ok: false, reason: "GATE_VECTOR_INCOMPLETE" });
    expect(validateJournalEntry(intentEntry(1, { reservedMaxLossCents: 101.5 }))).toMatchObject({ ok: false });
    expect(validateJournalEntry(intentEntry(1, { submittedLimit: { kind: "market" } }))).toMatchObject({ ok: false });
    const rationale = (intentEntry(1) as unknown as { rationale: Record<string, unknown> }).rationale;
    expect(validateJournalEntry(intentEntry(1, { rationale: { ...rationale, snapshotReferences: [] } }))).toMatchObject({ ok: false, reason: "RATIONALE_WITHOUT_SNAPSHOT_REFERENCE" });
    expect(validateJournalEntry(intentEntry(1, { rationale: { ...rationale, paidFrom: "vibes" } }))).toMatchObject({ ok: false, reason: "RATIONALE_PAID_FROM_INVALID" });
    expect(validateJournalEntry(intentEntry(1, { rationale: { ...rationale, text: "gates passed" } }))).toMatchObject({ ok: false, reason: "RATIONALE_NOT_CANDIDATE_SPECIFIC" });
    expect(validateJournalEntry(intentEntry(1, { rationale: { ...rationale, text: "SPY convex tail without naming the structure." } }))).toMatchObject({ ok: false, reason: "RATIONALE_NOT_CANDIDATE_SPECIFIC" });
    expect(validateJournalEntry(intentEntry(1, { rationale: { ...rationale, text: "long_option convex tail without naming the underlying." } }))).toMatchObject({ ok: false, reason: "RATIONALE_NOT_CANDIDATE_SPECIFIC" });
    expect(validateJournalEntry(intentEntry(1, { rationale: "SPY long_option, gates passed" }))).toMatchObject({ ok: false });

    const priorText = (intentEntry(1) as unknown as { rationale: { text: string } }).rationale.text;
    expect(planAppend({ lastSeq: 4, priorIntentRationales: [priorText] }, draftOf(intentEntry(5)), [])).toMatchObject({ ok: false, reason: "RATIONALE_DUPLICATE" });
    expect(planAppend({ lastSeq: 4, priorIntentRationales: [priorText + " "] }, draftOf(intentEntry(5)), [])).toMatchObject({ ok: true });
    expect(planAppend({ lastSeq: 4, priorIntentRationales: [] }, draftOf(intentEntry(5)), [])).toMatchObject({ ok: true, entry: { seq: 5, type: "INTENT" } });
  });
});
