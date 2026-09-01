// Aggregate shell deadline for one cycle. The runner propagates the absolute
// deadline to gateway actions and real broker requests; this race guarantees
// the caller itself also regains control at the configured hard ceiling.
export async function runWithinCycleWalltime<T>(budgetMs: number, clock: () => number, work: (deadlineAtMs: number) => Promise<T>): Promise<T> {
  if (!Number.isSafeInteger(budgetMs) || budgetMs < 1) throw new RangeError("cycle walltime budget must be a positive integer");
  const deadlineAtMs = clock() + budgetMs;
  let rejectTimeout: (reason: Error) => void = () => undefined;
  const timeout = new Promise<never>((_resolve, reject) => { rejectTimeout = reject; });
  const timer = setTimeout(() => { rejectTimeout(new Error(`CYCLE_WALLTIME_EXCEEDED after ${String(budgetMs)} ms`)); }, budgetMs);
  try {
    return await Promise.race([work(deadlineAtMs), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
