// One definition of "is now inside today's exchange session". It exists because
// the predicate had been written by hand four times — twice in the core, twice in
// the certificate CLI — and the CLI's two copies disagreed with the core's at the
// close instant, admitting a live run into a market the core already treats as
// shut. The boundary is asserted by tests/g6-session-tradability.spec.ts: a
// snapshot whose `closesAt` equals now is outside, because an order placed at the
// close instant is an order into a closed market.
export interface SessionBounds {
  readonly isTradingDay: boolean;
  readonly opensAt: number;
  readonly closesAt: number;
}

/** Open at `opensAt`, already closed at `closesAt`. */
export function isInsideSession(nowMs: number, session: SessionBounds): boolean {
  return session.isTradingDay && nowMs >= session.opensAt && nowMs < session.closesAt;
}

/**
 * Would the cycle after this one begin at or after the close? The end-of-session
 * safety stops — the stuck-eviction halt and the flatten assertion — fire only on
 * the cycle this answers `true` for, so it deliberately asks about the close edge
 * alone and says nothing about the open: before the open it must stay `false`, or
 * both stops would fire on a session that has not started, and after the close it
 * must stay `true`, or a late cycle would silence them.
 *
 * This is the fifth place the boundary was written by hand, and the one the first
 * extraction missed. It used `>` where the close edge is `<`, so it disagreed with
 * the core on exactly one millisecond.
 */
export function isFinalCycleOfSession(nowMs: number, cycleIntervalMs: number, session: SessionBounds): boolean {
  // A day the calendar does not list as a session arrives as
  // `{ isTradingDay: false, opensAt: 0, closesAt: 0 }`, and every instant is at
  // or after zero — so without this the flag reads `true` all day on a holiday
  // and the first cycle with an open eviction target halts `EXPIRY_EVICTION_STUCK`
  // on the reasoning that no further cycle precedes a close that does not exist.
  // A halt is sticky and needs a human to clear it.
  if (!session.isTradingDay) return false;
  return nowMs + cycleIntervalMs >= session.closesAt;
}
