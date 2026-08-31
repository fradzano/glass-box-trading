// The one error shape broker adapters (real or fake) use to carry an HTTP
// status to the runner. The decision about what a status MEANS is pure
// (`classifyBrokerFailure` in src/core/startup.ts); this module only
// transports and extracts the observation.
export class BrokerHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "BrokerHttpError";
  }
}

export function httpStatusOf(error: unknown): number | null {
  return error instanceof BrokerHttpError ? error.status : null;
}
