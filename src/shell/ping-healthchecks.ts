// The dead-man check port (S-G14-03): a healthchecks.io-style URL. The runner
// decides through the pure `planPing` whether a success or a failure ping is
// due; this port only delivers. The URL is a secret (redacted from the
// journal). Without a configured URL the port records locally so a dev run
// keeps its evidence.
import { appendFileSync } from "node:fs";
import type { PingPort } from "./cycle-runner.js";

export interface PingOptions {
  readonly url: string | null;
  /** Local fallback record when no URL is configured (dev runs). */
  readonly recordFile: string | null;
  readonly clock: () => number;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export function createPingPort(options: PingOptions): PingPort {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new RangeError("ping timeoutMs must be a positive integer");
  const record = (line: string): void => {
    if (options.recordFile === null) return;
    appendFileSync(options.recordFile, `${new Date(options.clock()).toISOString()} ${line}\n`, "utf8");
  };
  const send = async (url: string, init: RequestInit): Promise<void> => {
    const controller = new AbortController();
    let rejectTimeout: (reason: Error) => void = () => undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      rejectTimeout = reject;
    });
    const timer = setTimeout(() => {
        controller.abort();
        rejectTimeout(new Error(`PING_TIMEOUT after ${String(timeoutMs)} ms`));
    }, timeoutMs);
    try {
      await Promise.race([fetchImpl(url, { ...init, signal: controller.signal }), timeout]);
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    async success(): Promise<void> {
      record("success");
      if (options.url === null) return;
      await send(options.url, { method: "GET" });
    },
    async fail(conditions: readonly string[]): Promise<void> {
      record(`fail ${conditions.join(",")}`);
      if (options.url === null) return;
      await send(`${options.url}/fail`, { method: "POST", body: conditions.join("\n"), headers: { "Content-Type": "text/plain" } });
    },
  };
}
