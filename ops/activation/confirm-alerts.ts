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
// `.env`, reads the three checks and each check's flip history through
// `readers/healthchecks-io.ts`, and appends one line to
// `<state root>/alert-confirmations.jsonl` with an fsync — or, with `--dry-run`, prints
// what it would write and writes nothing. It refuses, and writes nothing, when any read
// fails, when the statement does not fit the flip history, or when a receipt lies after
// the moment of writing.
//
// A check's UUID and every `*_url` field are credentials (DECISIONS, 2026-09-12). They
// stay inside `healthchecks-io.ts` for the length of a request; nothing here sees them.
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import path from "node:path";
import { buildConfirmation, parseConfirmArgs } from "./confirm/record.ts";
import { readHealthchecks } from "./readers/healthchecks-io.ts";
import { berlinLocal, parseDotEnvAsRuntime } from "./readers/parse.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const CONFIRMATION_VALID_MS = 14 * 24 * 60 * 60 * 1000;

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

  const health = await readHealthchecks({ fetchImpl: fetch, apiKey: key, sleep: ms => new Promise(resolve => { setTimeout(resolve, ms); }) });
  const result = buildConfirmation(args, health.summaries, health.flips, Date.now());
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
