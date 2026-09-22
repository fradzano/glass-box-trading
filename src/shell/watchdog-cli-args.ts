export interface WatchdogCliNumbers {
  readonly now: number;
  readonly opensAt: number;
  readonly closesAt: number;
  readonly deadManBoundMs: number;
}

export type WatchdogCliNumberResult =
  | { readonly ok: true; readonly value: WatchdogCliNumbers }
  | { readonly ok: false; readonly reason: "WATCHDOG_ARGUMENT_INVALID" };

export function parseWatchdogCliNumbers(nowArgument: string, opensArgument: string, closesArgument: string, boundArgument: string): WatchdogCliNumberResult {
  const value: WatchdogCliNumbers = {
    now: Number(nowArgument),
    opensAt: Number(opensArgument),
    closesAt: Number(closesArgument),
    deadManBoundMs: Number(boundArgument),
  };
  if (![value.now, value.opensAt, value.closesAt, value.deadManBoundMs].every(Number.isSafeInteger)) {
    return { ok: false, reason: "WATCHDOG_ARGUMENT_INVALID" };
  }
  if (value.opensAt >= value.closesAt || value.deadManBoundMs <= 0) {
    return { ok: false, reason: "WATCHDOG_ARGUMENT_INVALID" };
  }
  return { ok: true, value };
}
