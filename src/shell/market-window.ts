// The one place a market observation window is defined (S-X-07, A29).
//
// Three callers needed a window and each built its own: the cycle runner an
// entry window, the watchdog and the deadline runtime a close-oriented one.
// That divergence is exactly what broke on 2026-09-03 — the runner priced its
// closes in the band it discovers entries in, so a structure expiring the next
// session dropped out of its own quote universe. The functions below are pure
// (calendar days and configuration in, a window out); they live in the shell
// only because `expiriesWithin` does, and that lives here because session
// arithmetic needs the platform's time-zone tables.
import type { MarketWindow } from "./alpaca-broker.js";
import { expiriesWithin } from "./market-calendar.js";
import type { CalendarDay } from "./market-calendar.js";
import type { BrokerPosition } from "../core/execution.js";

/** How many of the eligible expiries the entry window walks — the nearest few, in calendar order. */
export const ENTRY_EXPIRY_COUNT = 3;
/** The entry window's strike band, capped well inside `MAX_STRIKE_DISTANCE_BPS`: a discovery device, not a risk bound. */
export const ENTRY_STRIKE_WINDOW_BPS = 300;

/** The configuration a window needs; the callers pass their validated `config.decision` fields. */
export interface WindowConfig {
  readonly underlyingUniverse: readonly string[];
  readonly expiryMinSessions: number;
  readonly expiryMaxSessions: number;
  readonly maxStrikeDistanceBps: number;
}

/**
 * The contract identities a cycle must be able to price because it holds them.
 * Share residue in an underlying is excluded: the underlying is quoted anyway
 * as its own pseudo-contract, and asking the option-contract endpoint for
 * `SPY` would be a lookup for something that is not an option.
 */
export function heldOptionContractIds(positions: readonly BrokerPosition[], underlyings: readonly string[]): readonly string[] {
  const held = positions.filter(position => position.quantity !== 0 && !underlyings.includes(position.contractId)).map(position => position.contractId);
  return [...new Set(held)].sort();
}

/**
 * Discovery for what may be opened: the nearest `ENTRY_EXPIRY_COUNT` expiries
 * inside the policy's session bounds, within a narrow band around spot. It
 * carries no held identities on its own — `cycleWindow` adds those.
 */
export function entryWindow(days: readonly CalendarDay[], tradingDay: string, config: WindowConfig): MarketWindow {
  return {
    underlyings: config.underlyingUniverse,
    expiries: expiriesWithin(days, tradingDay, config.expiryMinSessions, config.expiryMaxSessions).slice(0, ENTRY_EXPIRY_COUNT),
    strikeWindowBps: Math.min(config.maxStrikeDistanceBps, ENTRY_STRIKE_WINDOW_BPS),
    heldContractIds: [],
  };
}

/**
 * The close-oriented window of the watchdog and the deadline runtime: a book
 * that must be flattened can hold anything that was openable once, so it starts
 * at zero remaining sessions and uses the full configured strike distance.
 * Held identities are added on top when the caller has read the book.
 */
export function closingWindow(days: readonly CalendarDay[], tradingDay: string, config: WindowConfig, heldContractIds: readonly string[] = []): MarketWindow {
  return {
    underlyings: config.underlyingUniverse,
    expiries: expiriesWithin(days, tradingDay, 0, config.expiryMaxSessions),
    strikeWindowBps: config.maxStrikeDistanceBps,
    heldContractIds,
  };
}

/**
 * The cycle's window: entry discovery plus every contract the book holds. The
 * held identities are quoted by identity and are deliberately NOT expressed as
 * a wider band — widening the walk would multiply the chain requests and the
 * journaled quote sample for every cycle, while still missing a contract whose
 * strike has drifted past the wider band. Identity has neither problem.
 */
export function cycleWindow(days: readonly CalendarDay[], tradingDay: string, config: WindowConfig, heldContractIds: readonly string[]): MarketWindow {
  return { ...entryWindow(days, tradingDay, config), heldContractIds };
}
