// Pure parsers for the healthchecks.io management API (build log, unit 7).
//
// The API's answers carry the ping credentials: a check's `uuid` is the credential
// (the ping URL is the ping host followed by it), and so is every `*_url` field built
// from it (DECISIONS, 2026-09-12). The ping host is not spelled out here, so that this
// file adds no hit to `tools/scan-secrets.ps1`, whose pattern matches any mention. These parsers therefore never return any of them. A check is named by
// its name and by the `hc:` fingerprint `tools/healthchecks-provision.mjs` prints; the
// hash itself is computed by the caller and handed in, so this module needs no crypto
// and a test can prove that no credential-shaped value comes out.
//
// Which URL the flips are fetched from stays in the I/O layer, the one place that
// holds a credential for the length of a request.
import type { CheckFlip, CheckName, CheckObservation, Reading } from "../core/types.ts";
import { parseIsoInstant } from "./parse.ts";

function known<T>(value: T): Reading<T> {
  return { known: true, value };
}

function unknown<T>(reason: string): Reading<T> {
  return { known: false, reason };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

/** The three checks as `tools/healthchecks-provision.mjs` creates them. */
export function checkNamesOnAccount(): Readonly<Record<CheckName, string>> {
  return { liveness: "gbt-liveness", readiness: "gbt-readiness", watchdog: "gbt-watchdog" };
}

export interface CheckSummary {
  readonly fingerprint: string;
  readonly status: string;
  readonly lastPingUtcMs: number | null;
}

/**
 * `GET /api/v3/checks/` → the three activation checks, each exactly once. The
 * fingerprint comes from `fingerprintOf(ping_url)`; a check without a ping URL has no
 * fingerprint and makes the reading unknown. Other checks on the account are ignored.
 */
export function parseCheckList(text: string, fingerprintOf: (pingUrl: string) => string): Reading<Readonly<Record<CheckName, CheckSummary>>> {
  const parsed = parseJson(text);
  if (!parsed.ok || !isRecord(parsed.value) || !Array.isArray(parsed.value["checks"])) return unknown("check list is not {\"checks\": [...]}");
  const entries: readonly unknown[] = parsed.value["checks"];
  const names = checkNamesOnAccount();
  const summarise = (name: string): Reading<CheckSummary> => {
    const found = entries.filter(entry => isRecord(entry) && entry["name"] === name);
    const check = found[0];
    if (found.length !== 1 || !isRecord(check)) return unknown(`${name} appears ${String(found.length)} times`);
    const status = check["status"];
    if (typeof status !== "string" || status.length === 0) return unknown(`${name} has no status`);
    const pingUrl = check["ping_url"];
    if (typeof pingUrl !== "string" || pingUrl.length === 0) return unknown(`${name} has no ping URL to fingerprint`);
    const lastPing = check["last_ping"];
    let lastPingUtcMs: number | null = null;
    if (lastPing !== null && lastPing !== undefined) {
      lastPingUtcMs = typeof lastPing === "string" ? parseIsoInstant(lastPing) : null;
      if (lastPingUtcMs === null) return unknown(`${name} has an unreadable last_ping`);
    }
    return known({ fingerprint: fingerprintOf(pingUrl), status, lastPingUtcMs });
  };
  const liveness = summarise(names.liveness);
  if (!liveness.known) return liveness;
  const readiness = summarise(names.readiness);
  if (!readiness.known) return readiness;
  const watchdog = summarise(names.watchdog);
  if (!watchdog.known) return watchdog;
  return known({ liveness: liveness.value, readiness: readiness.value, watchdog: watchdog.value });
}

/**
 * `GET <update_url>/flips/` → the check's up/down transitions, **newest first** whatever
 * order the API used. `up` must be 1, 0, true or false; the field shape is taken from
 * the API documentation and the 2026-09-12 probe notes, not yet from a stored answer,
 * so anything else is refused rather than interpreted.
 */
export function parseFlips(text: string): Reading<readonly CheckFlip[]> {
  const parsed = parseJson(text);
  if (!parsed.ok) return unknown("flips are not JSON");
  const list = Array.isArray(parsed.value) ? parsed.value : isRecord(parsed.value) && Array.isArray(parsed.value["flips"]) ? parsed.value["flips"] : null;
  if (list === null) return unknown("flips are neither a list nor {\"flips\": [...]}");
  const items: readonly unknown[] = list;
  const flips: CheckFlip[] = [];
  for (const item of items) {
    if (!isRecord(item) || typeof item["timestamp"] !== "string") return unknown("a flip has no timestamp");
    const utcMs = parseIsoInstant(item["timestamp"]);
    if (utcMs === null) return unknown("a flip has an unreadable timestamp");
    const up = item["up"];
    if (up !== 1 && up !== 0 && up !== true && up !== false) return unknown("a flip's up is neither 0/1 nor a boolean");
    flips.push({ utcMs, up: up === 1 || up === true });
  }
  return known([...flips].sort((left, right) => right.utcMs - left.utcMs));
}

/** The observation the core consumes: each summary with its flips. Any unknown part makes the whole reading unknown (A1). */
export function combineChecks(summaries: Reading<Readonly<Record<CheckName, CheckSummary>>>, flips: Readonly<Record<CheckName, Reading<readonly CheckFlip[]>>>): Reading<Readonly<Record<CheckName, CheckObservation>>> {
  if (!summaries.known) return summaries;
  const with_ = (name: CheckName): Reading<CheckObservation> => {
    const flipReading = flips[name];
    if (!flipReading.known) return unknown(`${name} flips: ${flipReading.reason}`);
    return known({ ...summaries.value[name], flips: flipReading.value });
  };
  const liveness = with_("liveness");
  if (!liveness.known) return liveness;
  const readiness = with_("readiness");
  if (!readiness.known) return readiness;
  const watchdog = with_("watchdog");
  if (!watchdog.known) return watchdog;
  return known({ liveness: liveness.value, readiness: readiness.value, watchdog: watchdog.value });
}
