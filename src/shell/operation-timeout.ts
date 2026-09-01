// Bound an external lifecycle operation without trusting it to honor cancellation.
export function withOperationTimeout<T>(work: () => Promise<T> | T, timeoutMs: number, label: string): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) return Promise.reject(new Error(`${label}: invalid timeout ${String(timeoutMs)}`));
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const startedAt = Date.now();
    const timeout = (): void => {
      if (settled) return;
      settled = true;
      reject(new Error(`${label} after ${String(timeoutMs)} ms`));
    };
    const timer = setTimeout(timeout, timeoutMs);
    queueMicrotask(() => {
      if (settled) return;
      let pending: Promise<T>;
      try {
        pending = Promise.resolve(work());
      } catch (error) {
        clearTimeout(timer);
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      pending.then(
        value => {
          if (settled) return;
          if (Date.now() - startedAt >= timeoutMs) {
            clearTimeout(timer);
            timeout();
            return;
          }
          clearTimeout(timer);
          settled = true;
          resolve(value);
        },
        (error: unknown) => {
          if (settled) return;
          clearTimeout(timer);
          settled = true;
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  });
}
