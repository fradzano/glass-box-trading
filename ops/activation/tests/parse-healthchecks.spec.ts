// Unit 7: the healthchecks.io parsers. The first test is the one that matters most:
// an API answer carries the ping credentials, and nothing credential-shaped may come
// out of these parsers into an observation, a ledger line or a printed report. The
// UUIDs and hosts below are invented for the test; none of them is a check on the account.
import { describe, expect, it } from "vitest";
import { combineChecks, parseCheckList, parseFlips } from "../readers/parse-healthchecks.ts";

const FAKE = {
  liveness: "11111111-2222-4333-8444-555555555555",
  readiness: "66666666-7777-4888-9999-aaaaaaaaaaaa",
  watchdog: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
  other: "00000000-1111-4222-8333-444444444444",
};

function check(name: string, uuid: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name,
    status: "up",
    last_ping: "2026-09-21T20:15:03+00:00",
    n_pings: 12,
    uuid,
    ping_url: `https://ping.example/${uuid}`,
    update_url: `https://api.example/v3/checks/${uuid}`,
    pause_url: `https://api.example/v3/checks/${uuid}/pause`,
    ...fields,
  };
}

function list(checks: readonly Record<string, unknown>[]): string {
  return JSON.stringify({ checks });
}

const fingerprint = (url: string): string => `hc:${url.length.toString(16).padStart(8, "0")}`;

const ACCOUNT = list([check("gbt-liveness", FAKE.liveness), check("gbt-readiness", FAKE.readiness, { status: "paused", last_ping: null }), check("gbt-watchdog", FAKE.watchdog), check("unrelated", FAKE.other)]);

describe("parse-healthchecks — the check list", () => {
  it("returns no UUID, no ping URL and no API URL, whatever the answer carried", () => {
    const reading = parseCheckList(ACCOUNT, fingerprint);
    expect(reading.known).toBe(true);
    const printed = JSON.stringify(reading);
    expect(printed).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(printed).not.toMatch(/ping\.example|api\.example|https?:/);
  });

  it("names each check by fingerprint, status and last ping, and ignores other checks", () => {
    expect(parseCheckList(ACCOUNT, fingerprint)).toEqual({
      known: true,
      value: {
        liveness: { fingerprint: fingerprint(`https://ping.example/${FAKE.liveness}`), status: "up", lastPingUtcMs: Date.UTC(2026, 8, 21, 20, 15, 3) },
        readiness: { fingerprint: fingerprint(`https://ping.example/${FAKE.readiness}`), status: "paused", lastPingUtcMs: null },
        watchdog: { fingerprint: fingerprint(`https://ping.example/${FAKE.watchdog}`), status: "up", lastPingUtcMs: Date.UTC(2026, 8, 21, 20, 15, 3) },
      },
    });
  });

  it("refuses a missing check, a duplicated one, one without a ping URL, and an unreadable last ping", () => {
    expect(parseCheckList(list([check("gbt-liveness", FAKE.liveness), check("gbt-readiness", FAKE.readiness)]), fingerprint)).toEqual({ known: false, reason: "gbt-watchdog appears 0 times" });
    expect(parseCheckList(list([check("gbt-liveness", FAKE.liveness), check("gbt-liveness", FAKE.other), check("gbt-readiness", FAKE.readiness), check("gbt-watchdog", FAKE.watchdog)]), fingerprint).known).toBe(false);
    expect(parseCheckList(list([check("gbt-liveness", FAKE.liveness, { ping_url: undefined }), check("gbt-readiness", FAKE.readiness), check("gbt-watchdog", FAKE.watchdog)]), fingerprint).known).toBe(false);
    expect(parseCheckList(list([check("gbt-liveness", FAKE.liveness, { ping_url: "" }), check("gbt-readiness", FAKE.readiness), check("gbt-watchdog", FAKE.watchdog)]), fingerprint)).toEqual({ known: false, reason: "gbt-liveness has no ping URL to fingerprint" });
    expect(parseCheckList(list([check("gbt-liveness", FAKE.liveness, { last_ping: "yesterday" }), check("gbt-readiness", FAKE.readiness), check("gbt-watchdog", FAKE.watchdog)]), fingerprint).known).toBe(false);
    expect(parseCheckList("<html>429 Too Many Requests</html>", fingerprint).known).toBe(false);
  });
});

describe("parse-healthchecks — flips", () => {
  it("returns the flips newest first whatever the order of the answer, in either envelope", () => {
    const flips = [{ timestamp: "2026-09-21T20:40:00+00:00", up: 1 }, { timestamp: "2026-09-21T21:35:00+00:00", up: 0 }];
    const expected = { known: true, value: [{ utcMs: Date.UTC(2026, 8, 21, 21, 35), up: false }, { utcMs: Date.UTC(2026, 8, 21, 20, 40), up: true }] };
    expect(parseFlips(JSON.stringify(flips))).toEqual(expected);
    expect(parseFlips(JSON.stringify({ flips }))).toEqual(expected);
    expect(parseFlips(JSON.stringify([{ timestamp: "2026-09-21T20:40:00+00:00", up: true }]))).toEqual({ known: true, value: [{ utcMs: Date.UTC(2026, 8, 21, 20, 40), up: true }] });
  });

  it("refuses a flip whose up is not 0, 1 or a boolean, or whose timestamp cannot be read", () => {
    expect(parseFlips(JSON.stringify([{ timestamp: "2026-09-21T20:40:00+00:00", up: "down" }])).known).toBe(false);
    expect(parseFlips(JSON.stringify([{ timestamp: "2026-09-21 20:40", up: 1 }])).known).toBe(false);
    expect(parseFlips(JSON.stringify({ status: "error" })).known).toBe(false);
  });
});

describe("parse-healthchecks — combining", () => {
  it("attaches each check's flips, and makes the whole reading unknown when any flips could not be read (A1)", () => {
    const summaries = parseCheckList(ACCOUNT, fingerprint);
    const none = { known: true as const, value: [] };
    const combined = combineChecks(summaries, { liveness: none, readiness: none, watchdog: { known: true, value: [{ utcMs: 5, up: false }] } });
    expect(combined.known && combined.value.watchdog.flips).toEqual([{ utcMs: 5, up: false }]);
    expect(combineChecks(summaries, { liveness: none, readiness: { known: false, reason: "429" }, watchdog: none })).toEqual({ known: false, reason: "readiness flips: 429" });
    expect(combineChecks({ known: false, reason: "503" }, { liveness: none, readiness: none, watchdog: none })).toEqual({ known: false, reason: "503" });
  });
});
