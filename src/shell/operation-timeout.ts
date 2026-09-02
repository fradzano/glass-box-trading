// Bound an external lifecycle operation without trusting it to honor cancellation.

/** Opaque timer handle: whatever a port's own `setTimeout` returned, handed back to that port's `clearTimeout`. */
export type OperationTimerHandle = unknown;

/**
 * Clock and timer seam. Production passes nothing and gets the real clock and
 * the real timers; a test injects a controlled queue so that a busy machine
 * cannot decide which bound expired first — the success path below compares
 * elapsed time against the budget, so on the real clock a port that resolves in
 * a single microtask can still be measured as an overrun under CPU contention.
 */
export interface OperationTimers {
  now(): number;
  setTimeout(handler: () => void, timeoutMs: number): OperationTimerHandle;
  clearTimeout(handle: OperationTimerHandle): void;
}

const REAL_TIMERS: OperationTimers = {
  now: () => Date.now(),
  setTimeout: (handler, timeoutMs) => globalThis.setTimeout(handler, timeoutMs),
  // The handle can only be one this port's `setTimeout` produced.
  clearTimeout: handle => { globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>); },
};

export function withOperationTimeout<T>(work: () => Promise<T> | T, timeoutMs: number, label: string, timers: OperationTimers = REAL_TIMERS): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) return Promise.reject(new Error(`${label}: invalid timeout ${String(timeoutMs)}`));
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const startedAt = timers.now();
    const timeout = (): void => {
      if (settled) return;
      settled = true;
      reject(new Error(`${label} after ${String(timeoutMs)} ms`));
    };
    const timer = timers.setTimeout(timeout, timeoutMs);
    queueMicrotask(() => {
      if (settled) return;
      let pending: Promise<T>;
      try {
        pending = Promise.resolve(work());
      } catch (error) {
        timers.clearTimeout(timer);
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      pending.then(
        value => {
          if (settled) return;
          if (timers.now() - startedAt >= timeoutMs) {
            timers.clearTimeout(timer);
            timeout();
            return;
          }
          timers.clearTimeout(timer);
          settled = true;
          resolve(value);
        },
        (error: unknown) => {
          if (settled) return;
          timers.clearTimeout(timer);
          settled = true;
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  });
}
