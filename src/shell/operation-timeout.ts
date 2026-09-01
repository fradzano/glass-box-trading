// Bound an external lifecycle operation without trusting it to honor cancellation.
export function withOperationTimeout<T>(work: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) return Promise.reject(new Error(`${label}: invalid timeout ${String(timeoutMs)}`));
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error(`${label} after ${String(timeoutMs)} ms`)); }, timeoutMs);
    work.then(
      value => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))); },
    );
  });
}
