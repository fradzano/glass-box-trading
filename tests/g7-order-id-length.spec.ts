// G7 / S-G7-01 — every client order id the core derives stays within Alpaca's
// synchronous 128-character limit. Found live, not by any fake: the first dev
// certificate run on 2026-09-02 had every entry rejected with
// `client_order_id must be <= 128 characters` because the structure identity
// was hex-encoded (four characters per contract-id character, 177 in total).
// The fake broker now enforces the same limit with the same message, so a
// runner test sees the OUTCOME rejection the live run saw.
import { describe, expect, it } from "vitest";
import type { CloseRoute, DecisionSnapshot, EntryCandidate } from "../src/core/domain.js";
import { integerUnit, lotCount } from "../src/core/domain.js";
import { MAX_CLIENT_ORDER_ID_LENGTH, closeAttemptId, closeLifecycleId, entryClientOrderId } from "../src/core/order-identity.js";
import { P1_RECORDED_CANDIDATES, P1_RECORDED_SNAPSHOT } from "../src/fixtures/p1-recorded-cycle.js";
import { createFakeBroker } from "../src/shell/fake-broker.js";
import { creditVertical } from "./execution-fixtures.js";
import { P5_BINDING } from "./lifecycle-fixtures.js";

const ENTRY_ID_SHAPE = /^entry:\d{4}-\d{2}-\d{2}:\d+:[0-9a-f]{24}$/u;

/** The longest structure the whitelist could admit: four legs on a long-ticker underlying, wide ratios. */
function fourLegCandidate(): EntryCandidate {
  const base = creditVertical();
  const template = base.legs[0]!;
  const legOf = (contractId: string, side: "buy" | "sell", right: "call" | "put"): EntryCandidate["legs"][number] =>
    ({ ...template, contractId, underlying: "QQQQQ", side, right, ratio: lotCount(10) });
  return {
    ...base,
    candidateId: "IRON-CONDOR-LONG-TICKER",
    legs: [
      legOf("QQQQQ260904P00500000", "buy", "put"),
      legOf("QQQQQ260904P00510000", "sell", "put"),
      legOf("QQQQQ260904C00790000", "sell", "call"),
      legOf("QQQQQ260904C00800000", "buy", "call"),
    ],
  };
}

const LATE_CYCLE_SNAPSHOT: DecisionSnapshot = { ...P1_RECORDED_SNAPSHOT, cycleIndex: integerUnit(999_999, "Quantity") };
const P1_CANDIDATE: EntryCandidate = (() => {
  if (P1_RECORDED_CANDIDATES.kind !== "candidates") throw new Error("the recorded P1 batch has candidates");
  return P1_RECORDED_CANDIDATES.candidates[0]!;
})();

describe("G7 — client order ids stay within the broker's 128-character limit", () => {
  it("the bound is the broker's actual limit, 128, not whatever the constant happens to say (R38 C1)", () => {
    expect(MAX_CLIENT_ORDER_ID_LENGTH).toBe(128);
  });

  it("the recorded P1 candidate's entry id has the short digest shape and is far below the limit", () => {
    const id = entryClientOrderId(P1_RECORDED_SNAPSHOT, P1_CANDIDATE);
    expect(id).toMatch(ENTRY_ID_SHAPE);
    expect(id.length).toBeLessThanOrEqual(MAX_CLIENT_ORDER_ID_LENGTH);
    expect(id.length).toBeLessThan(64);
  });

  it("a four-leg structure with long contract ids at a late cycle index stays below the limit, and so do its exposure, close lifecycle and close attempt ids", () => {
    const entryId = entryClientOrderId(LATE_CYCLE_SNAPSHOT, fourLegCandidate());
    expect(entryId).toMatch(ENTRY_ID_SHAPE);
    const exposureLifecycleId = `exposure:${entryId}`;
    expect(exposureLifecycleId.length).toBeLessThanOrEqual(MAX_CLIENT_ORDER_ID_LENGTH);
    for (const route of ["ordinary", "emergency", "expiry", "kill", "watchdog", "residue", "deadline"] as const satisfies readonly CloseRoute[]) {
      const lifecycleId = closeLifecycleId(exposureLifecycleId, route);
      const attemptId = closeAttemptId(lifecycleId, integerUnit(999_999, "Quantity"));
      expect(attemptId.length, attemptId).toBeLessThanOrEqual(MAX_CLIENT_ORDER_ID_LENGTH);
    }
  });

  it("is deterministic and order-independent in the legs, and distinguishes structures and cycles (S-G7-01)", () => {
    const candidate = fourLegCandidate();
    const a = entryClientOrderId(P1_RECORDED_SNAPSHOT, candidate);
    expect(entryClientOrderId(P1_RECORDED_SNAPSHOT, { ...candidate, legs: [...candidate.legs].reverse() })).toBe(a);
    const otherRatio = { ...candidate, legs: candidate.legs.map((item, index) => (index === 0 ? { ...item, ratio: lotCount(11) } : item)) };
    expect(entryClientOrderId(P1_RECORDED_SNAPSHOT, otherRatio)).not.toBe(a);
    const otherSide = { ...candidate, legs: candidate.legs.map((item, index) => (index === 0 ? { ...item, side: "sell" as const } : item)) };
    expect(entryClientOrderId(P1_RECORDED_SNAPSHOT, otherSide)).not.toBe(a);
    const otherContract = { ...candidate, legs: candidate.legs.map((item, index) => (index === 0 ? { ...item, contractId: "QQQQQ260904P00505000" } : item)) };
    expect(entryClientOrderId(P1_RECORDED_SNAPSHOT, otherContract)).not.toBe(a);
    expect(entryClientOrderId(LATE_CYCLE_SNAPSHOT, candidate)).not.toBe(a);
  });

  it("the fake broker refuses an over-long id synchronously with Alpaca's message, and accepts one at the limit", async () => {
    const broker = createFakeBroker({ accountId: P5_BINDING.accountId, cashCents: 10_000_000, equityCents: 10_000_000, clock: () => 1_756_800_000_000 });
    const vertical = creditVertical();
    const payload = { legs: vertical.legs, quantity: 1, limit: { kind: "credit", priceCents: 200 }, intent: "entry" };
    const submit = (clientOrderId: string) => broker.port.mutate({ kind: "submit_order", clientOrderId, binding: P5_BINDING, payload });
    const tooLong = await submit(`entry:2026-09-02:3:${"f".repeat(MAX_CLIENT_ORDER_ID_LENGTH)}`);
    expect(tooLong).toEqual({ ok: false, reason: "REJECTED:client_order_id must be <= 128 characters" });
    const atLimit = await submit(`entry:${"a".repeat(MAX_CLIENT_ORDER_ID_LENGTH - 6)}`);
    expect(atLimit.ok).toBe(true);
  });
});
