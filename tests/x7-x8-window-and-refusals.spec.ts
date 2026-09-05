// S-X-07 the cycle's market observation covers the book, and S-X-08 a
// management refusal is journaled rather than only printed. Both cases come
// from the 2026-09-03 incident (scenarios #72–#75, axioms A29 and A4): the
// runner priced its closes in the window it discovers entries in, so three
// structures expiring the next session had no quote and were refused, and the
// refusals lived only in a printed report the scheduled task discarded.
import { describe, expect, it } from "vitest";
import { closingWindow, cycleWindow, entryWindow, ENTRY_EXPIRY_COUNT, ENTRY_STRIKE_WINDOW_BPS, heldOptionContractIds } from "../src/shell/market-window.js";
import type { WindowConfig } from "../src/shell/market-window.js";
import type { MarketWindow } from "../src/shell/alpaca-broker.js";
import type { CalendarDay } from "../src/shell/market-calendar.js";
import { journalEntryTypes, primaryEntryTypes, validateJournalEntry } from "../src/core/journal.js";
import type { MarketObservation } from "../src/core/execution.js";
import { createAlpacaBroker } from "../src/shell/alpaca-broker.js";
import { cycleMarketPort } from "../src/shell/agent-runtime.js";
import { projectPerformance } from "../src/core/projection.js";
import { renderDashboard } from "../src/shell/render-dashboard.js";
import { expectationFor } from "../src/shell/publisher.js";
import { TEST_ONLY_ACCOUNT_ID } from "./journal-fixtures.js";
import { assessFreshness } from "../src/core/projection.js";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT_FOR_ASSETS = path.resolve();
const PROJECTION_EXPECTATIONS = { initialCapitalCents: 10_000_000, expectedAccountId: TEST_ONLY_ACCOUNT_ID, flattenDate: "2026-09-03", profile: "dev" as const, qualification: null };
import { BrokerHttpError, httpStatusOf } from "../src/shell/broker-errors.js";
import { classifyBrokerFailure } from "../src/core/startup.js";
import { defaultLifecycleDeps, lifecycleHarness, lifecycleMarket } from "./lifecycle-fixtures.js";
import { SHORT_CALL, LONG_CALL } from "./execution-fixtures.js";
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

// ---------------------------------------------------------------------------
// The wiring, not only the pure builder. A mutation probe on 2026-09-05 showed
// that every pure decision below was measured and every SHELL seam that
// carries it was not: dropping the held identities in phase 1, in the
// watchdog, or in the adapter, and skipping the refusal append entirely, all
// survived the suite. These cases close that.
// ---------------------------------------------------------------------------

/** Records the held identities each observation was asked for, and answers as the default fixture does. */
function recordingMarket(clock: () => number, calls: string[][], overrides: Parameters<typeof lifecycleMarket>[1] = {}) {
  const inner = lifecycleMarket(clock, overrides);
  return (heldContractIds: readonly string[] = []): Promise<MarketObservation> => {
    calls.push([...heldContractIds]);
    return inner();
  };
}

describe("S-X-07 wiring — the cycle asks for the identities its own book holds", () => {
  it("passes no identity on an empty book and every held identity once a structure is filled", async () => {
    const harness = await lifecycleHarness();
    const calls: string[][] = [];
    const market = recordingMarket(() => harness.clock.now, calls);

    await harness.cycle({ market });
    expect(calls[0], "the first cycle starts flat").toEqual([]);
    expect(await harness.fake.read.positions()).not.toHaveLength(0);

    await harness.cycle({ market });
    const held = (await harness.fake.read.positions()).map(position => position.contractId).sort();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(held);
    expect(calls[1]).toEqual(expect.arrayContaining([SHORT_CALL, LONG_CALL]));
  });
});

describe("S-X-08 wiring — the refusal reaches the journal, not only the report", () => {
  it("reproduces 2026-09-03: the held structure has no quote, the close is refused, and the refusal is journaled", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle(); // the entry fills under the normal calendar

    // The 2026-09-03 shape, without the calendar: the observation carries no
    // quote for either leg of the held structure, so the ladder cannot price
    // its close. Before this change the refusal existed only in the printed
    // report, which the scheduled task discarded.
    const blind = async (): Promise<MarketObservation> => {
      const full = await lifecycleMarket(() => harness.clock.now)();
      const drop = <T,>(record: Readonly<Record<string, T>>): Record<string, T> =>
        Object.fromEntries(Object.entries(record).filter(([id]) => id !== SHORT_CALL && id !== LONG_CALL));
      return { ...full, quotesByContract: drop(full.quotesByContract), contractsById: drop(full.contractsById) };
    };
    const report = await harness.cycle({
      market: blind,
      tradingDay: "2026-09-03",
      lifecycle: defaultLifecycleDeps({ nextTradingDay: "2026-09-04" }),
    });

    expect(report.managementRefusals).not.toHaveLength(0);
    expect(report.managementRefusals[0]).toMatchObject({ route: "deadline", reason: expect.stringContaining("PRICE_UNAVAILABLE") });
    expect(report.managementCloses).toHaveLength(0);

    const journaled = harness.entries().filter(entry => entry.type === "MANAGEMENT_REFUSAL");
    expect(journaled, "the journal, not the printed report, is the record a judge has").not.toHaveLength(0);
    expect(journaled[0]).toMatchObject({
      exposureLifecycleId: report.managementRefusals[0]?.exposureLifecycleId,
      route: report.managementRefusals[0]?.route,
      reason: report.managementRefusals[0]?.reason,
    });
    // Two invocations, two primary entries: the refusals are additions beside
    // the CYCLE entry, never a second primary for the same cycle (S-J-03).
    expect(harness.entries().filter(entry => entry.type === "CYCLE")).toHaveLength(2);
    expect(journaled.every(entry => typeof entry["generation"] === "number" || entry["generation"] === null)).toBe(true);
  });

  it("journals nothing when nothing was refused", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    expect(harness.entries().filter(entry => entry.type === "MANAGEMENT_REFUSAL")).toHaveLength(0);
  });
});

describe("S-X-07 wiring — the adapter quotes a held identity the chain walk never produced", () => {
  const SPOT = { bp: 500.0, ap: 500.1, bs: 100, as: 100, t: "2026-08-31T13:30:59.871234567Z" };
  const HELD = "SPY260904P00300000"; // far outside any band the walk would take

  function fakeFetch(seen: string[]) {
    return (url: string): Promise<Response> => {
      seen.push(url);
      const json = (body: unknown): Promise<Response> => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
      if (url.includes("/v2/stocks/quotes/latest")) return json({ quotes: { SPY: { bp: SPOT.bp, ap: SPOT.ap, bs: SPOT.bs, as: SPOT.as, t: SPOT.t } } });
      if (url.includes("/v2/options/contracts/")) {
        return json({ symbol: HELD, underlying_symbol: "SPY", expiration_date: "2026-09-04", strike_price: "300", type: "put", tradable: false });
      }
      if (url.includes("/v2/options/contracts?")) return json({ option_contracts: [], next_page_token: null });
      if (url.includes("/v1beta1/options/quotes/latest")) return json({ quotes: {} });
      throw new Error(`unexpected request ${url}`);
    };
  }

  it("resolves the held contract by identity and keeps it even when the broker returns no quote for it", async () => {
    const seen: string[] = [];
    const broker = createAlpacaBroker({
      credentials: { keyId: "k", secretKey: "s" },
      tradingOrigin: "https://paper-api.alpaca.markets",
      dataOrigin: "https://data.alpaca.markets",
      clock: () => Date.parse("2026-09-03T14:00:00.000Z"),
      fetchImpl: fakeFetch(seen) as unknown as typeof fetch,
    });

    const observation = await broker.market({ underlyings: ["SPY"], expiries: ["2026-09-09"], strikeWindowBps: 300, heldContractIds: [HELD] });
    expect(seen.some(url => url.includes(`/v2/options/contracts/${HELD}`)), "the held identity is resolved directly").toBe(true);
    // It has no quote, and it is still in the observation: the management step
    // must report a missing price for a contract it holds, not for one it has
    // never heard of.
    expect(Object.keys(observation.contractsById)).toContain(HELD);
    expect(observation.quotesByContract[HELD]).toBeUndefined();
  });

  it("does not look up a held identity the chain walk already produced, nor an underlying", async () => {
    const seen: string[] = [];
    const broker = createAlpacaBroker({
      credentials: { keyId: "k", secretKey: "s" },
      tradingOrigin: "https://paper-api.alpaca.markets",
      dataOrigin: "https://data.alpaca.markets",
      clock: () => Date.parse("2026-09-03T14:00:00.000Z"),
      fetchImpl: fakeFetch(seen) as unknown as typeof fetch,
    });

    await broker.market({ underlyings: ["SPY"], expiries: ["2026-09-09"], strikeWindowBps: 300, heldContractIds: ["SPY"] });
    expect(seen.some(url => url.includes("/v2/options/contracts/SPY?") || url.endsWith("/v2/options/contracts/SPY"))).toBe(false);
  });
});

describe("S-G12-06 / R41-B1 — a credential rejection on the held-identity lookup is a fence, not a missing price", () => {
  const SPOT = { bp: 500.0, ap: 500.1, bs: 100, as: 100, t: "2026-08-31T13:30:59.871234567Z" };
  const HELD = "SPY260904P00300000";

  function brokerWithHeldLookupStatus(status: number) {
    const fetchImpl = (url: string): Promise<Response> => {
      const json = (body: unknown, code = 200): Promise<Response> => Promise.resolve(new Response(JSON.stringify(body), { status: code, headers: { "content-type": "application/json" } }));
      if (url.includes("/v2/stocks/quotes/latest")) return json({ quotes: { SPY: SPOT } });
      if (url.includes("/v2/options/contracts/")) return json({ message: "forbidden" }, status);
      if (url.includes("/v2/options/contracts?")) return json({ option_contracts: [], next_page_token: null });
      if (url.includes("/v1beta1/options/quotes/latest")) return json({ quotes: {} });
      throw new Error(`unexpected request ${url}`);
    };
    return createAlpacaBroker({
      credentials: { keyId: "k", secretKey: "s" },
      tradingOrigin: "https://paper-api.alpaca.markets",
      dataOrigin: "https://data.alpaca.markets",
      clock: () => Date.parse("2026-09-03T14:00:00.000Z"),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
  }

  const window = { underlyings: ["SPY"], expiries: ["2026-09-09"], strikeWindowBps: 300, heldContractIds: [HELD] };

  it("401 and 403 escape the observation carrying their status, instead of degrading to a healthy-looking read", async () => {
    for (const status of [401, 403]) {
      const failure = await brokerWithHeldLookupStatus(status).market(window).then(() => null, (error: unknown) => error);
      expect(failure, `HTTP ${String(status)} must not be swallowed`).not.toBeNull();
      expect(httpStatusOf(failure)).toBe(status);
      expect(classifyBrokerFailure(httpStatusOf(failure))).toBe("AUTH_FAILURE");
    }
  });

  it("an ordinary lookup failure still degrades: the observation succeeds without that contract", async () => {
    for (const status of [404, 500]) {
      const observation = await brokerWithHeldLookupStatus(status).market(window);
      expect(Object.keys(observation.contractsById)).not.toContain(HELD);
      expect(Object.keys(observation.contractsById)).toContain("SPY");
    }
  });

  it("the cycle halts and journals AUTH_FAILURE when the observation is refused, not WORLD_UNREACHABLE", async () => {
    const harness = await lifecycleHarness();
    const rejected = (): Promise<MarketObservation> => Promise.reject(new BrokerHttpError(403, "GET /v2/options/contracts/SPY260904P00300000 failed"));
    const report = await harness.cycle({ market: rejected });

    expect(report.reasonCodes).toEqual(["AUTH_FAILURE"]);
    expect(report.entriesBlocked).toContain("AUTH_FAILURE");
    const halt = harness.entries().filter(entry => entry.type === "HALT" && entry["reason"] === "AUTH_FAILURE");
    expect(halt, "S-G12-06: the rejection is a durable fence, not a degraded world").toHaveLength(1);
  });

  it("a market failure that is not a credential rejection stays a world class", async () => {
    const harness = await lifecycleHarness();
    const down = (): Promise<MarketObservation> => Promise.reject(new BrokerHttpError(503, "GET /v1beta1/options/quotes/latest failed"));
    const report = await harness.cycle({ market: down });

    expect(report.reasonCodes).not.toContain("AUTH_FAILURE");
    expect(report.reasonCodes[0]).toMatch(/WORLD_(PARTIAL|UNREACHABLE)/u);
    expect(harness.entries().some(entry => entry.type === "HALT" && entry["reason"] === "AUTH_FAILURE")).toBe(false);
  });
});

describe("S-X-07 / R41-C2 — the runner's composition root forwards the identities it is given", () => {
  it("rebuilds the window per call around the caller's held identities, and passes the deadline through", async () => {
    const windows: { window: MarketWindow; deadlineAtMs: number | undefined }[] = [];
    const port = cycleMarketPort(
      (window: MarketWindow, deadlineAtMs?: number) => {
        windows.push({ window, deadlineAtMs });
        return Promise.resolve({ quotesByContract: {}, contractsById: {}, spotCentsByUnderlying: {} });
      },
      DAYS,
      TRADING_DAY,
      CONFIG,
    );

    await port(["SPY260904C00768000"], 1_700_000_000_000);
    await port([]);
    await port();

    expect(windows.map(item => item.window.heldContractIds)).toEqual([["SPY260904C00768000"], [], []]);
    expect(windows[0]?.deadlineAtMs).toBe(1_700_000_000_000);
    expect(windows[1]?.deadlineAtMs).toBeUndefined();
    // The band itself is the entry window every time: discovery does not widen
    // because the book happens to hold something.
    for (const item of windows) {
      expect(item.window.strikeWindowBps).toBe(ENTRY_STRIKE_WINDOW_BPS);
      expect(item.window.expiries).toEqual(entryWindow(DAYS, TRADING_DAY, CONFIG).expiries);
    }
  });
});

describe("R41-B2 — a refused close is visible on the public page, not only in the journal", () => {
  it("the projection labels the cycle refused and carries every reason; the journal alone is not the public record", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    const blind = async (): Promise<MarketObservation> => {
      const full = await lifecycleMarket(() => harness.clock.now)();
      const drop = <T,>(record: Readonly<Record<string, T>>): Record<string, T> =>
        Object.fromEntries(Object.entries(record).filter(([id]) => id !== SHORT_CALL && id !== LONG_CALL));
      return { ...full, quotesByContract: drop(full.quotesByContract), contractsById: drop(full.contractsById) };
    };
    const report = await harness.cycle({ market: blind, tradingDay: "2026-09-03", lifecycle: defaultLifecycleDeps({ nextTradingDay: "2026-09-04" }) });
    expect(report.managementRefusals).not.toHaveLength(0);

    const entries = harness.entries();
    const last = entries[entries.length - 1];
    const projection = projectPerformance(entries, "sha256:0123456789abcdef", { at: last?.at ?? "", kind: "latest" }, PROJECTION_EXPECTATIONS);

    const refusedCycle = projection.cycles.find(cycle => cycle.managementRefusals.length > 0);
    expect(refusedCycle, "the projection must carry the refusal, not silently advance lastSeq past it").toBeDefined();
    // CONCEPT and SUBMISSION-SPEC require trade/no-trade AND why: a cycle that
    // tried to close and was turned away is not a quiet cycle.
    expect(refusedCycle?.result).toBe("refused");
    expect(refusedCycle?.managementRefusals[0]?.reason).toContain("PRICE_UNAVAILABLE");
    expect(refusedCycle?.managementRefusals[0]?.exposureLifecycleId).toBe(report.managementRefusals[0]?.exposureLifecycleId);
    expect(refusedCycle?.managementRefusals[0]?.route).toBe("deadline");
  });

  it("the rendered page names the refusal, its route and its reason", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    const blind = async (): Promise<MarketObservation> => {
      const full = await lifecycleMarket(() => harness.clock.now)();
      const drop = <T,>(record: Readonly<Record<string, T>>): Record<string, T> =>
        Object.fromEntries(Object.entries(record).filter(([id]) => id !== SHORT_CALL && id !== LONG_CALL));
      return { ...full, quotesByContract: drop(full.quotesByContract), contractsById: drop(full.contractsById) };
    };
    await harness.cycle({ market: blind, tradingDay: "2026-09-03", lifecycle: defaultLifecycleDeps({ nextTradingDay: "2026-09-04" }) });

    const entries = harness.entries();
    const last = entries[entries.length - 1];
    const projection = projectPerformance(entries, "sha256:0123456789abcdef", { at: last?.at ?? "", kind: "latest" }, PROJECTION_EXPECTATIONS);
    const html = renderDashboard(projection, expectationFor(projection), {
      renderedAt: last?.at ?? "",
      freshness: assessFreshness(projection.lastUpdatedAt, Date.parse(last?.at ?? "") + 1_000, 900_000, 3_000_000),
      degradation: { degraded: false, explanation: "" },
      source: { repositoryUrl: "https://example.invalid/repo", journalRevisionUrl: null, corePath: "src/core/decision.ts", evidenceTestPath: "tests/g1-defined-risk.spec.ts", evidenceDebtRow: "RES-P1-01a" },
      pinned: [],
      routeLabel: "test",
      styles: readFileSync(path.join(REPO_ROOT_FOR_ASSETS, "assets", "dashboard.css"), "utf8"),
    });

    expect(html).toContain("Management closes planned and refused this cycle");
    expect(html).toContain("PRICE_UNAVAILABLE");
    expect(html).toContain("route <code>deadline</code>");
    // The summary row carries the count, so the table alone distinguishes the two.
    expect(html).toMatch(/result result--refused/u);
  });
});
