// `activation confirm-alerts` — records the owner's confirmation of gate condition 4
// (owner ruling and review, 2026-09-14).
//
//   node ops/activation/confirm-alerts.ts --operator felix --state-root <activation root>
//     --alert <ISO with zone>            one mail named all three checks
//     | --alert-liveness <ISO> --alert-readiness <ISO> --alert-watchdog <ISO>
//     --reminder <ISO with zone> --reminder-lists liveness,readiness,watchdog
//     [--dry-run]
//
// The thin I/O around `confirm/record.ts`: it reads the healthchecks.io API key from
// `.env`, reads the three checks and each check's flip history, and appends one line to
// `<state root>/alert-confirmations.jsonl` with an fsync — or, with `--dry-run`, prints
// what it would write and writes nothing. It refuses, and writes nothing, when any read
// fails or the statement does not fit the flip history.
//
// A check's UUID and every `*_url` field are credentials (DECISIONS, 2026-09-12). They
// stay inside this process for the length of a request, are never printed, and error text
// is reduced to a status or an error name before it is shown.
import { createHash } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import path from "node:path";
import { buildConfirmation, parseConfirmArgs } from "./confirm/record.ts";
import type { CheckFlip, CheckName, Reading } from "./core/types.ts";
import { checkNamesOnAccount, parseCheckList, parseFlips } from "./readers/parse-healthchecks.ts";
import { berlinLocal, parseDotEnvAsRuntime } from "./readers/parse.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const API = "https://healthchecks.io/api/v3";
const CONFIRMATION_VALID_MS = 14 * 24 * 60 * 60 * 1000;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fingerprint(pingUrl: string): string {
  return `hc:${createHash("sha256").update(pingUrl, "utf8").digest("hex").slice(0, 8)}`;
}

async function getText(url: string, key: string): Promise<{ readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: string }> {
  try {
    const response = await fetch(url, { headers: { "X-Api-Key": key }, signal: AbortSignal.timeout(15_000) });
    const text = await response.text();
    return response.ok ? { ok: true, text } : { ok: false, reason: `HTTP ${String(response.status)}` };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.name : "request failed" };
  }
}

/** The per-check update URLs, which name the flips endpoint. Held here only; never returned to the printing code. */
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
  for (const [check, accountName] of Object.entries(names)) {
    const matches = entries.filter(entry => isRecord(entry) && entry["name"] === accountName);
    const entry = matches[0];
    if (matches.length === 1 && isRecord(entry) && typeof entry["update_url"] === "string" && (check === "liveness" || check === "readiness" || check === "watchdog")) urls[check] = entry["update_url"];
  }
  return urls;
}

function formatLocal(utcMs: number): string {
  const local = berlinLocal(utcMs);
  return `${local.date} ${String(Math.floor(local.minute / 60)).padStart(2, "0")}:${String(local.minute % 60).padStart(2, "0")} Europe/Berlin`;
}

async function main(): Promise<number> {
  const parsedArgs = parseConfirmArgs(process.argv.slice(2));
  if (!parsedArgs.ok) {
    process.stderr.write(`refusing: ${parsedArgs.reason}\n`);
    return 2;
  }
  const args = parsedArgs.args;

  let key = "";
  try {
    key = parseDotEnvAsRuntime(readFileSync(path.join(REPO_ROOT, ".env"), "utf8")).values["HEALTHCHECK_IO_API_KEY"] ?? "";
  } catch {
    // An unreadable .env leaves the key empty, which is refused just below.
  }
  if (key.length === 0) {
    process.stderr.write("refusing: HEALTHCHECK_IO_API_KEY is not set in .env\n");
    return 2;
  }

  const list = await getText(`${API}/checks/`, key);
  const summaries = list.ok ? parseCheckList(list.text, fingerprint) : { known: false as const, reason: `check list ${list.reason}` };
  const urls = list.ok ? updateUrls(list.text) : {};
  const pending: Reading<readonly CheckFlip[]> = { known: false, reason: "not read" };
  const flips: Record<CheckName, Reading<readonly CheckFlip[]>> = { liveness: pending, readiness: pending, watchdog: pending };
  for (const check of ["liveness", "readiness", "watchdog"] as const) {
    const url = urls[check];
    if (url === undefined) {
      flips[check] = { known: false, reason: "no update URL for this check" };
      continue;
    }
    const answer = await getText(`${url}/flips/`, key);
    flips[check] = answer.ok ? parseFlips(answer.text) : { known: false, reason: answer.reason };
  }

  const result = buildConfirmation(args, summaries, flips, Date.now());
  if (!result.ok) {
    process.stderr.write(`refusing, nothing written:\n${result.reasons.map(reason => `  ${reason}`).join("\n")}\n`);
    return 1;
  }

  for (const check of ["liveness", "readiness", "watchdog"] as const) {
    process.stdout.write(`${check.padEnd(10)} ${result.fingerprints[check]}  down since ${formatLocal(result.cross.downFlipUtcMs[check])}\n`);
  }
  const oldest = result.cross.oldestReceiptUtcMs;
  process.stdout.write(`oldest receipt ${formatLocal(oldest)}; valid for step 0 until ${formatLocal(oldest + CONFIRMATION_VALID_MS)}\n`);

  if (args.dryRun) {
    process.stdout.write(`dry run, nothing written. The line would be:\n${result.line}\n`);
    return 0;
  }
  mkdirSync(args.stateRoot, { recursive: true });
  const file = path.join(args.stateRoot, "alert-confirmations.jsonl");
  const descriptor = openSync(file, "a");
  try {
    writeSync(descriptor, `${result.line}\n`);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  process.stdout.write(`written to ${file}\n`);
  return 0;
}

process.exitCode = await main();
