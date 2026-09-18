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
