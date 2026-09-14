// The healthchecks.io management API, read (build log, unit 7). This is the one place the
// activation holds healthchecks.io credentials: the API key, a check's UUID and every
// `*_url` field built from it (DECISIONS, 2026-09-12). They stay inside this module for the
// length of a request, are never returned, printed or put into a reason, and error text is
// reduced to a status or an error name before it leaves.
//
// Each request is retried with a bounded backoff on 429, 5xx and network errors, so a single
// throttled answer does not end a drill night (ACT-47); whatever still fails after the last
// attempt is an unknown reading, and unknown is never green (A1).
//
// `fetch` and the sleep are handed in, so the tests can prove, with answers that carry real-
// shaped credentials, that none of them comes out.
import { createHash } from "node:crypto";
import type { CheckFlip, CheckName, Reading } from "../core/types.ts";
import type { CheckSummary } from "./parse-healthchecks.ts";
import { checkNamesOnAccount, parseCheckList, parseFlips } from "./parse-healthchecks.ts";
import { parseIndependentRead } from "./parse-host.ts";

export const HEALTHCHECKS_API = "https://healthchecks.io/api/v3";

export type HealthchecksFetch = (url: string, init: { readonly headers: Readonly<Record<string, string>>; readonly signal: AbortSignal }) => Promise<{ readonly ok: boolean; readonly status: number; text(): Promise<string> }>;

export interface HealthchecksOptions {
  readonly fetchImpl: HealthchecksFetch;
  readonly apiKey: string;
  readonly sleep: (ms: number) => Promise<void>;
  /** Per request; the default keeps three attempts with their pauses well inside one five-minute invocation. */
  readonly timeoutMs?: number;
}

export interface HealthchecksReading {
  readonly summaries: Reading<Readonly<Record<CheckName, CheckSummary>>>;
  readonly flips: Readonly<Record<CheckName, Reading<readonly CheckFlip[]>>>;
  readonly independent: Reading<true>;
}

/** The `hc:` fingerprint `tools/healthchecks-provision.mjs` prints: enough to tell three endpoints apart, nothing to ping with. */
export function fingerprint(pingUrl: string): string {
  return `hc:${createHash("sha256").update(pingUrl, "utf8").digest("hex").slice(0, 8)}`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type Answer = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: string };

const BACKOFF_MS: readonly number[] = [1_000, 3_000];

async function getOnce(options: HealthchecksOptions, url: string): Promise<Answer & { readonly retryable: boolean }> {
  try {
    const response = await options.fetchImpl(url, { headers: { "X-Api-Key": options.apiKey }, signal: AbortSignal.timeout(options.timeoutMs ?? 10_000) });
    if (response.ok) return { ok: true, text: await response.text(), retryable: false };
    return { ok: false, reason: `HTTP ${String(response.status)}`, retryable: response.status === 429 || response.status >= 500 };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.name : "request failed", retryable: true };
  }
}

/** One GET with at most three attempts; the reason of the last failure is a status or an error name, never response text. */
export async function getWithBackoff(options: HealthchecksOptions, url: string): Promise<Answer> {
  let answer = await getOnce(options, url);
  for (const pause of BACKOFF_MS) {
    if (answer.ok || !answer.retryable) break;
    await options.sleep(pause);
    answer = await getOnce(options, url);
  }
  return answer.ok ? { ok: true, text: answer.text } : { ok: false, reason: answer.reason };
}

/** The per-check update URLs, which name the flips endpoint. They are credentials: held here, used here, never returned from this module. */
function updateUrls(listText: string): Partial<Record<CheckName, string>> {
  const urls: Partial<Record<CheckName, string>> = {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(listText);
  } catch {
    return urls;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed["checks"])) return urls;
  const entries: readonly unknown[] = parsed["checks"];
  const names = checkNamesOnAccount();
  for (const check of ["liveness", "readiness", "watchdog"] as const) {
    const matches = entries.filter(entry => isRecord(entry) && entry["name"] === names[check]);
    const entry = matches[0];
    if (matches.length === 1 && isRecord(entry) && typeof entry["update_url"] === "string") urls[check] = entry["update_url"];
  }
  return urls;
}

/**
 * The three checks with their flip histories, and the independent read the drills rely on
 * (`GET /channels/`). Without an API key every part is unknown; a failed check list makes the
 * flips unknown too, because the flips are fetched from URLs only the list names.
 */
export async function readHealthchecks(options: HealthchecksOptions): Promise<HealthchecksReading> {
  const notRead = (reason: string): Reading<never> => ({ known: false, reason });
  if (options.apiKey.length === 0) {
    const absent = notRead("HEALTHCHECK_IO_API_KEY is not set");
    return { summaries: absent, flips: { liveness: absent, readiness: absent, watchdog: absent }, independent: absent };
  }
  const list = await getWithBackoff(options, `${HEALTHCHECKS_API}/checks/`);
  const summaries = list.ok ? parseCheckList(list.text, fingerprint) : notRead(`check list ${list.reason}`);
  const urls = list.ok ? updateUrls(list.text) : {};
  const flips: Record<CheckName, Reading<readonly CheckFlip[]>> = { liveness: notRead("not read"), readiness: notRead("not read"), watchdog: notRead("not read") };
  for (const check of ["liveness", "readiness", "watchdog"] as const) {
    const url = urls[check];
    if (url === undefined) {
      flips[check] = notRead(list.ok ? "no update URL for this check" : `check list ${list.reason}`);
      continue;
    }
    const answer = await getWithBackoff(options, `${url}/flips/`);
    flips[check] = answer.ok ? parseFlips(answer.text) : notRead(`flips ${answer.reason}`);
  }
  const channels = await getWithBackoff(options, `${HEALTHCHECKS_API}/channels/`);
  const independent = channels.ok ? parseIndependentRead(channels.text) : notRead(`independent read ${channels.reason}`);
  return { summaries, flips, independent };
}
