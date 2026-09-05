// S-X-07 the cycle's market observation covers the book, and S-X-08 a
// management refusal is journaled rather than only printed. Both cases come
// from the 2026-09-03 incident (scenarios #72–#75, axioms A29 and A4): the
// runner priced its closes in the window it discovers entries in, so three
// structures expiring the next session had no quote and were refused, and the
// refusals lived only in a printed report the scheduled task discarded.
import { describe, expect, it } from "vitest";
import { closingWindow, cycleWindow, entryWindow, ENTRY_EXPIRY_COUNT, ENTRY_STRIKE_WINDOW_BPS, heldOptionContractIds } from "../src/shell/market-window.js";
import type { WindowConfig } from "../src/shell/market-window.js";
import type { CalendarDay } from "../src/shell/market-calendar.js";
import { journalEntryTypes, primaryEntryTypes, validateJournalEntry } from "../src/core/journal.js";
import { managementRefusalDraft } from "../src/core/execution.js";

const CONFIG: WindowConfig = { underlyingUniverse: ["SPY", "QQQ"], expiryMinSessions: 2, expiryMaxSessions: 30, maxStrikeDistanceBps: 1000 };

/** Ten consecutive sessions starting on the day the cycle runs. */
const DAYS: readonly CalendarDay[] = ["2026-09-03", "2026-09-04", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17"].map(date => ({ date, open: "09:30", close: "16:00" }));
const TRADING_DAY = "2026-09-03";

describe("S-X-07 the cycle's market observation covers the book", () => {
  it("the entry window is unchanged: the nearest three eligible expiries in a narrow band, no held identities", () => {
    const window = entryWindow(DAYS, TRADING_DAY, CONFIG);
    expect(window.expiries).toEqual(["2026-09-08", "2026-09-09", "2026-09-10"]);
    expect(window.expiries.length).toBe(ENTRY_EXPIRY_COUNT);
    expect(window.strikeWindowBps).toBe(ENTRY_STRIKE_WINDOW_BPS);
    expect(window.heldContractIds).toEqual([]);
    // The defect itself: the next session's expiry is NOT in the entry window.
    expect(window.expiries).not.toContain("2026-09-04");
  });

  it("the closing window starts at zero remaining sessions and uses the full configured strike distance", () => {
    const window = closingWindow(DAYS, TRADING_DAY, CONFIG);
    expect(window.expiries[0]).toBe("2026-09-03");
    expect(window.expiries).toContain("2026-09-04");
    expect(window.strikeWindowBps).toBe(CONFIG.maxStrikeDistanceBps);
  });

  it("the cycle window carries every held identity while keeping the entry band", () => {
    const held = ["SPY260904C00768000", "SPY260904P00762000"];
    const window = cycleWindow(DAYS, TRADING_DAY, CONFIG, held);
    expect(window.expiries).toEqual(entryWindow(DAYS, TRADING_DAY, CONFIG).expiries);
    expect(window.strikeWindowBps).toBe(ENTRY_STRIKE_WINDOW_BPS);
    // The 2026-09-03 structures: their expiry is outside the walked chain and
    // they are still priceable, because they are named by identity.
    expect(window.heldContractIds).toEqual(held);
  });

  it("held identities come from the book, exclude flat rows, and exclude share residue in an underlying", () => {
    const positions = [
      { contractId: "SPY260904C00768000", quantity: -3, avgEntryPriceCents: 120 },
      { contractId: "SPY260904C00769000", quantity: 3, avgEntryPriceCents: 80 },
      { contractId: "SPY", quantity: 100, avgEntryPriceCents: 76_500 },
      { contractId: "QQQ260909P00712000", quantity: 0, avgEntryPriceCents: 700 },
      { contractId: "SPY260904C00768000", quantity: -3, avgEntryPriceCents: 120 },
    ];
    expect(heldOptionContractIds(positions, CONFIG.underlyingUniverse)).toEqual(["SPY260904C00768000", "SPY260904C00769000"]);
  });

  it("a strike that drifted out of the entry band is still named, because identity does not depend on spot", () => {
    const drifted = "SPY261016P00600000";
    expect(cycleWindow(DAYS, TRADING_DAY, CONFIG, [drifted]).heldContractIds).toContain(drifted);
  });

  it("the closing window carries held identities too: the flattener is the last place that may lose a contract to a band", () => {
    // The watchdog and the deadline runtime price the closes nobody else will.
    // Their window starts at zero sessions, which covers a near expiry, but it
    // is still a band around spot and a drifted strike falls out of it.
    const drifted = "SPY261016P00600000";
    const window = closingWindow(DAYS, TRADING_DAY, CONFIG, [drifted]);
    expect(window.heldContractIds).toEqual([drifted]);
    expect(window.expiries).toContain("2026-09-04");
    // Called without a book (the fence-only watchdog composition), it degrades
    // to exactly the window it built before this change.
    expect(closingWindow(DAYS, TRADING_DAY, CONFIG).heldContractIds).toEqual([]);
  });
});

describe("S-X-08 a management refusal is journaled, not merely printed", () => {
  const envelope = { seq: 8, at: "2026-09-03T16:01:12.000Z", epoch: 27 };
  const refusal = { ...envelope, type: "MANAGEMENT_REFUSAL", exposureLifecycleId: "exposure:entry:2026-09-02:5:abc:g0", route: "deadline", generation: 0, reason: "PRICE_UNAVAILABLE: QUOTE_MISSING" };

  it("the refusal the 2026-09-03 cycles had no place for is a valid entry of its own", () => {
    expect(validateJournalEntry(refusal)).toMatchObject({ ok: true });
  });

  it("it is not a primary entry: a cycle keeps writing exactly one CYCLE beside any number of refusals", () => {
    expect(journalEntryTypes()).toContain("MANAGEMENT_REFUSAL");
    expect(primaryEntryTypes()).not.toContain("MANAGEMENT_REFUSAL");
  });

  it("a refusal before any attempt carries a null generation", () => {
    expect(validateJournalEntry({ ...refusal, generation: null, reason: "PLAN_VETO: book changed since the plan" })).toMatchObject({ ok: true });
  });

  it("a malformed refusal is rejected rather than absorbed", () => {
    expect(validateJournalEntry({ ...refusal, exposureLifecycleId: "" })).toMatchObject({ ok: false, reason: "MANAGEMENT_REFUSAL_INVALID" });
    expect(validateJournalEntry({ ...refusal, reason: "" })).toMatchObject({ ok: false, reason: "MANAGEMENT_REFUSAL_INVALID" });
    expect(validateJournalEntry({ ...refusal, generation: -1 })).toMatchObject({ ok: false, reason: "MANAGEMENT_REFUSAL_INVALID" });
    expect(validateJournalEntry({ ...refusal, route: "not-a-route" })).toMatchObject({ ok: false, reason: "MANAGEMENT_REFUSAL_ROUTE_INVALID" });
  });

  it("the draft the runner appends carries the four fields and nothing else", () => {
    const draft = managementRefusalDraft({ atIso: "2026-09-03T16:01:12.000Z", epoch: 27 }, { exposureLifecycleId: "exposure:entry:2026-09-02:5:abc:g0", route: "expiry", generation: 2, reason: "NOT_ELIGIBLE: position no longer in the book" });
    expect(draft).toEqual({ at: "2026-09-03T16:01:12.000Z", epoch: 27, type: "MANAGEMENT_REFUSAL", exposureLifecycleId: "exposure:entry:2026-09-02:5:abc:g0", route: "expiry", generation: 2, reason: "NOT_ELIGIBLE: position no longer in the book" });
    expect(validateJournalEntry({ seq: 9, ...draft })).toMatchObject({ ok: true });
  });
});
