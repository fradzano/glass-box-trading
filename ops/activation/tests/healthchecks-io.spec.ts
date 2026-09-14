// Unit 7, the healthchecks.io read. The fake API below answers the way the management API does,
// with credential-shaped UUIDs in `ping_url`, `update_url` and `unique_key`; the first test is the
// one that matters most: none of them comes out of the reading. Hosts are example hosts, so this
// file adds no hit to tools/scan-secrets.ps1.
import { describe, expect, it } from "vitest";
import type { HealthchecksFetch, HealthchecksOptions } from "../readers/healthchecks-io.ts";
import { HEALTHCHECKS_API, fingerprint, readHealthchecks } from "../readers/healthchecks-io.ts";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const KEY = "test-only-api-key";

function uuidFor(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function checkEntry(name: string, n: number): Record<string, unknown> {
  return { name, status: "up", last_ping: "2026-09-22T12:00:01+00:00", ping_url: `https://ping.example/${uuidFor(n)}`, update_url: `${HEALTHCHECKS_API}/checks/${uuidFor(n)}`, unique_key: uuidFor(n + 10) };
}

const LIST = JSON.stringify({ checks: [checkEntry("gbt-liveness", 1), checkEntry("gbt-readiness", 2), checkEntry("gbt-watchdog", 3), checkEntry("someone-else", 4)] });
const FLIPS = JSON.stringify({ flips: [{ timestamp: "2026-09-11T20:01:00+00:00", up: 0 }, { timestamp: "2026-09-11T23:30:01+00:00", up: 1 }] });

type Script = (url: string) => { readonly status: number; readonly body: string } | Error;

interface Recorded {
  readonly urls: string[];
  readonly keys: string[];
  readonly sleeps: number[];
  readonly redirects: string[];
}

function api(script: Script): { readonly options: HealthchecksOptions; readonly recorded: Recorded } {
  const recorded: Recorded = { urls: [], keys: [], sleeps: [], redirects: [] };
  const fetchImpl: HealthchecksFetch = (url, init) => {
    recorded.urls.push(url);
    recorded.keys.push(init.headers["X-Api-Key"] ?? "");
    recorded.redirects.push(init.redirect);
    const answer = script(url);
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve({ ok: answer.status >= 200 && answer.status < 300, status: answer.status, text: () => Promise.resolve(answer.body) });
  };
  return { options: { fetchImpl, apiKey: KEY, sleep: ms => { recorded.sleeps.push(ms); return Promise.resolve(); } }, recorded };
}

function healthy(url: string): { readonly status: number; readonly body: string } {
  if (url === `${HEALTHCHECKS_API}/checks/`) return { status: 200, body: LIST };
  if (url === `${HEALTHCHECKS_API}/channels/`) return { status: 200, body: "{\"channels\":[]}" };
  if (url.endsWith("/flips/")) return { status: 200, body: FLIPS };
  return { status: 404, body: "" };
}

describe("healthchecks-io — what comes out", () => {
  it("returns the three checks by fingerprint with their flips, and not one credential", async () => {
    const { options, recorded } = api(healthy);
    const reading = await readHealthchecks(options);
    expect(reading.summaries).toEqual({
      known: true,
      value: {
        liveness: { fingerprint: fingerprint(`https://ping.example/${uuidFor(1)}`), status: "up", lastPingUtcMs: Date.UTC(2026, 8, 22, 12, 0, 1) },
        readiness: { fingerprint: fingerprint(`https://ping.example/${uuidFor(2)}`), status: "up", lastPingUtcMs: Date.UTC(2026, 8, 22, 12, 0, 1) },
        watchdog: { fingerprint: fingerprint(`https://ping.example/${uuidFor(3)}`), status: "up", lastPingUtcMs: Date.UTC(2026, 8, 22, 12, 0, 1) },
      },
    });
    expect(reading.flips.watchdog).toEqual({ known: true, value: [{ utcMs: Date.UTC(2026, 8, 11, 23, 30, 1), up: true }, { utcMs: Date.UTC(2026, 8, 11, 20, 1), up: false }] });
    expect(reading.independent).toEqual({ known: true, value: true });
    const text = JSON.stringify(reading);
    expect(text).not.toMatch(UUID);
    expect(text).not.toContain("example");
    expect(text).not.toContain(KEY);
    // The flips come from each check's own update URL, and the key goes only into the header.
    expect(recorded.urls).toContain(`${HEALTHCHECKS_API}/checks/${uuidFor(3)}/flips/`);
    expect(new Set(recorded.keys)).toEqual(new Set([KEY]));
    expect(recorded.urls.some(url => url.includes(KEY))).toBe(false);
  });

  it("never sends X-Api-Key to a foreign update_url", async () => {
    const hostile = JSON.stringify({ checks: [
      { ...checkEntry("gbt-liveness", 1), update_url: `https://attacker.example/api/v3/checks/${uuidFor(1)}` },
      checkEntry("gbt-readiness", 2),
      checkEntry("gbt-watchdog", 3),
    ] });
    const { options, recorded } = api(url => url === `${HEALTHCHECKS_API}/checks/` ? { status: 200, body: hostile } : healthy(url));
    const reading = await readHealthchecks(options);
    expect(recorded.urls.some(url => url.startsWith("https://attacker.example/"))).toBe(false);
    expect(reading.flips.liveness).toEqual({ known: false, reason: "no trusted update URL for this check" });
  });

  it("does not follow a redirect and therefore never forwards X-Api-Key to its foreign target", async () => {
    const { options, recorded } = api(url => url === `${HEALTHCHECKS_API}/checks/`
      ? { status: 302, body: "https://attacker.example/steal" }
      : healthy(url));
    const reading = await readHealthchecks(options);
    expect(recorded.urls).toEqual([`${HEALTHCHECKS_API}/checks/`, `${HEALTHCHECKS_API}/channels/`]);
    expect(recorded.urls.some(url => url.includes("attacker.example"))).toBe(false);
    expect(recorded.redirects).toEqual(["manual", "manual"]);
    expect(reading.summaries).toEqual({ known: false, reason: "check list HTTP 302" });
  });

  it("asks nothing and reads nothing without an API key", async () => {
    const { options, recorded } = api(healthy);
    const reading = await readHealthchecks({ ...options, apiKey: "" });
    expect(recorded.urls).toEqual([]);
    expect(reading.summaries).toEqual({ known: false, reason: "HEALTHCHECK_IO_API_KEY is not set" });
    expect(reading.flips.liveness.known || reading.independent.known).toBe(false);
  });
});

describe("healthchecks-io — the independent read", () => {
  it("reads a 200 that is not a channel list as an independent read that failed", async () => {
    const { options } = api(url => (url === `${HEALTHCHECKS_API}/channels/` ? { status: 200, body: "<html>maintenance</html>" } : healthy(url)));
    expect((await readHealthchecks(options)).independent).toEqual({ known: false, reason: "the independent read is not {\"channels\": [...]}" });
  });
});

describe("healthchecks-io — bounded backoff", () => {
  it("retries a 429 and a 5xx and reads the answer that follows, pausing 1 s and then 3 s", async () => {
    let listCalls = 0;
    const { options, recorded } = api(url => {
      if (url === `${HEALTHCHECKS_API}/checks/`) {
        listCalls += 1;
        if (listCalls === 1) return { status: 429, body: "slow down" };
        if (listCalls === 2) return { status: 503, body: "" };
      }
      return healthy(url);
    });
    const reading = await readHealthchecks(options);
    expect(reading.summaries.known).toBe(true);
    expect(listCalls).toBe(3);
    expect(recorded.sleeps).toEqual([1_000, 3_000]);
  });

  it("gives up after three attempts, and the flips it could not locate are unknown too", async () => {
    const { options, recorded } = api(url => (url === `${HEALTHCHECKS_API}/checks/` ? { status: 429, body: `{"detail":"${uuidFor(9)}"}` } : healthy(url)));
    const reading = await readHealthchecks(options);
    expect(reading.summaries).toEqual({ known: false, reason: "check list HTTP 429" });
    expect(reading.flips.readiness).toEqual({ known: false, reason: "check list HTTP 429" });
    expect(recorded.urls.filter(url => url === `${HEALTHCHECKS_API}/checks/`)).toHaveLength(3);
    expect(recorded.sleeps).toEqual([1_000, 3_000]);
    expect(JSON.stringify(reading)).not.toMatch(UUID);
  });

  it("does not retry a refusal that will not change, such as a 401", async () => {
    const { options, recorded } = api(url => (url === `${HEALTHCHECKS_API}/checks/` ? { status: 401, body: "" } : healthy(url)));
    expect((await readHealthchecks(options)).summaries).toEqual({ known: false, reason: "check list HTTP 401" });
    expect(recorded.sleeps).toEqual([]);
  });

  it("reduces a network error to its name, never its message", async () => {
    const { options } = api(url => (url.endsWith("/flips/") ? new TypeError(`fetch failed for ${url} with ${KEY}`) : healthy(url)));
    const reading = await readHealthchecks(options);
    expect(reading.flips.liveness).toEqual({ known: false, reason: "flips TypeError" });
    expect(JSON.stringify(reading)).not.toContain(KEY);
    expect(JSON.stringify(reading)).not.toMatch(UUID);
  });
});
