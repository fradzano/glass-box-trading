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
}

export function createPingPort(options: PingOptions): PingPort {
  const fetchImpl = options.fetchImpl ?? fetch;
  const record = (line: string): void => {
    if (options.recordFile === null) return;
    appendFileSync(options.recordFile, `${new Date(options.clock()).toISOString()} ${line}\n`, "utf8");
  };
  return {
    async success(): Promise<void> {
      record("success");
      if (options.url === null) return;
      await fetchImpl(options.url, { method: "GET" });
    },
    async fail(conditions: readonly string[]): Promise<void> {
      record(`fail ${conditions.join(",")}`);
      if (options.url === null) return;
      await fetchImpl(`${options.url}/fail`, { method: "POST", body: conditions.join("\n"), headers: { "Content-Type": "text/plain" } });
    },
  };
}
