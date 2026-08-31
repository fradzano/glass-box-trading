import type { JournalDraft, JournalEntry, JournalSnapshot } from "../src/core/journal.js";

export const TEST_ONLY_AT = "2026-08-31T13:30:00.000Z";
export const TEST_ONLY_AT_MS = 1_788_183_000_000;
export const TEST_ONLY_ACCOUNT_ID = "TEST_ONLY_PA000000000";
export const TEST_ONLY_ORIGIN = "https://paper-api.alpaca.markets";

export function journalSnapshot(overrides: Partial<JournalSnapshot> = {}): JournalSnapshot {
  return {
    accountId: TEST_ONLY_ACCOUNT_ID,
    snapshotAt: TEST_ONLY_AT,
    cashCents: 10_000_000,
    equityCents: 10_000_000,
    positions: [],
    openOrders: [],
    quoteSamples: {
      SPY: {
        SPY260904C00500000: { bidCents: 100, askCents: 102, bidSize: 20, askSize: 20, quotedAt: TEST_ONLY_AT, brokerQuotedAt: "2026-08-31T13:29:59.871234567Z" },
      },
    },
    ...overrides,
  };
}

export function cycleEntry(seq: number, overrides: Record<string, unknown> = {}): JournalEntry {
  return {
    seq,
    at: TEST_ONLY_AT,
    epoch: 1,
    type: "CYCLE",
    cycleIndex: 7,
    tradingDay: "2026-08-31",
    reasonCodes: [],
    snapshot: journalSnapshot(),
    batchVerdicts: [],
    candidateVerdicts: [],
    ...overrides,
  } as unknown as JournalEntry;
}

export function intentEntry(seq: number, overrides: Record<string, unknown> = {}): JournalEntry {
  return {
    seq,
    at: TEST_ONLY_AT,
    epoch: 1,
    type: "INTENT",
    clientOrderId: "entry:2026-08-31:7:abc",
    exposureLifecycleId: "exposure-1",
    sleeve: "convex",
    structureType: "long_option",
    legs: [{ contractId: "SPY260904C00500000", underlying: "SPY", expiry: "2026-09-04", strikeCents: 50_000, right: "call", side: "buy", ratio: 1 }],
    quantity: 1,
    submittedLimit: { kind: "debit", priceCents: 101 },
    reservedMaxLossCents: 10_100,
    gateVector: [
      { gate: "G1", passed: true, code: "PASS", reasons: [] },
      { gate: "G2", passed: true, code: "PASS", reasons: [] },
      { gate: "G3", passed: true, code: "PASS", reasons: [] },
      { gate: "G4", passed: true, code: "PASS", reasons: [] },
      { gate: "G5", passed: true, code: "PASS", reasons: [] },
      { gate: "G6", passed: true, code: "PASS", reasons: [] },
      { gate: "G7", passed: true, code: "PASS", reasons: [] },
      { gate: "G8", passed: true, code: "PASS", reasons: [] },
    ],
    rationale: {
      paidFrom: "convex_tail",
      snapshotReferences: ["quote:SPY260904C00500000:bid=100,ask=102@2026-08-31T13:30:00.000Z"],
      text: "SPY long_option call 500 buys a convex tail into the Sep 4 expiry against a 1.00/1.02 quote.",
    },
    binding: { profile: "dev", tradingOrigin: TEST_ONLY_ORIGIN, accountId: TEST_ONLY_ACCOUNT_ID },
    ...overrides,
  } as unknown as JournalEntry;
}

export function bootstrapEntry(seq: number, overrides: Record<string, unknown> = {}): JournalEntry {
  return { seq, at: TEST_ONLY_AT, epoch: 1, type: "BOOTSTRAP", snapshot: journalSnapshot(), epochSeeded: true, ...overrides } as unknown as JournalEntry;
}

export function haltEntry(seq: number, overrides: Record<string, unknown> = {}): JournalEntry {
  return { seq, at: TEST_ONLY_AT, epoch: 1, type: "HALT", reason: "MANUAL", detail: "operator halt", sticky: false, ...overrides } as unknown as JournalEntry;
}

/** A draft is an entry without `seq`: the gateway assigns the sequence number under the writer lock. */
export function draftOf(entry: JournalEntry): JournalDraft {
  return Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "seq"));
}

export function witnessEntry(seq: number, type: "SUPPRESSED" | "FENCED_OUT", overrides: Record<string, unknown> = {}): JournalEntry {
  const base = type === "SUPPRESSED"
    ? { instanceId: "second-instance", holderId: "first-instance", reason: "LOCK_HELD" }
    : { instanceId: "old-writer", staleEpoch: 1, observedEpoch: 2 };
  return { seq, at: TEST_ONLY_AT, epoch: null, type, ...base, ...overrides };
}
