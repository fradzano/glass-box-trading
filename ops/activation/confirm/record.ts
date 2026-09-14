// The pure half of `activation confirm-alerts` (owner ruling and review, 2026-09-14).
//
// The owner types what only his mailbox knows: when each alert mail arrived — or that
// one mail named all three checks — when a reminder arrived, and which checks it listed.
// The command reads the rest from healthchecks.io, the three fingerprints and each
// check's flip history, and this module decides whether the statement fits that history
// before any line is written. Nothing here reads a mailbox, and nothing here writes.
import { crossCheckAlerts } from "../core/confirmation.ts";
import type { AlertCrossCheck } from "../core/confirmation.ts";
import type { CheckFlip, CheckName, Reading } from "../core/types.ts";
import type { CheckSummary } from "../readers/parse-healthchecks.ts";
import { parseIsoInstant } from "../readers/parse.ts";

export interface ConfirmArgs {
  readonly operator: string;
  readonly stateRoot: string;
  readonly alertReceivedAt: Readonly<Record<CheckName, string>>;
  readonly bundledAlert: boolean;
  readonly reminderReceivedAt: string;
  readonly reminderListed: readonly CheckName[];
  readonly dryRun: boolean;
}

export type ParsedConfirmArgs = { readonly ok: true; readonly args: ConfirmArgs } | { readonly ok: false; readonly reason: string };

export type ConfirmationResult =
  | { readonly ok: true; readonly line: string; readonly cross: Extract<AlertCrossCheck, { readonly ok: true }>; readonly fingerprints: Readonly<Record<CheckName, string>> }
  | { readonly ok: false; readonly reasons: readonly string[] };

function refuse(reason: string): ParsedConfirmArgs {
  return { ok: false, reason };
}

function knownFlags(): readonly string[] {
  return ["--operator", "--state-root", "--alert", "--alert-liveness", "--alert-readiness", "--alert-watchdog", "--reminder", "--reminder-lists"];
}

function isCheckName(value: string): value is CheckName {
  return value === "liveness" || value === "readiness" || value === "watchdog";
}

/**
 * The command line. Every instant must be ISO 8601 with a zone. `--alert` is one mail that
 * named all three checks; `--alert-liveness`, `--alert-readiness` and `--alert-watchdog`
 * are one mail per check. The two forms never mix, and the per-check form needs all three.
 */
export function parseConfirmArgs(argv: readonly string[]): ParsedConfirmArgs {
  const values: Record<string, string> = {};
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index] ?? "";
    if (flag === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (!knownFlags().includes(flag)) return refuse(`unknown argument ${flag}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) return refuse(`${flag} needs a value`);
    if (Object.hasOwn(values, flag)) return refuse(`${flag} is given twice`);
    values[flag] = value;
    index += 1;
  }

  const operator = (values["--operator"] ?? "").trim();
  if (operator.length === 0) return refuse("--operator is required");
  const stateRoot = values["--state-root"] ?? "";
  if (stateRoot.length === 0) return refuse("--state-root is required");

  const bundled = values["--alert"];
  const perCheck = { liveness: values["--alert-liveness"], readiness: values["--alert-readiness"], watchdog: values["--alert-watchdog"] };
  const anyPerCheck = perCheck.liveness !== undefined || perCheck.readiness !== undefined || perCheck.watchdog !== undefined;
  if (bundled !== undefined && anyPerCheck) return refuse("--alert (one mail for all three) and --alert-<check> (one mail per check) cannot be combined");
  let alertReceivedAt: Readonly<Record<CheckName, string>>;
  if (bundled !== undefined) {
    alertReceivedAt = { liveness: bundled, readiness: bundled, watchdog: bundled };
  } else if (perCheck.liveness !== undefined && perCheck.readiness !== undefined && perCheck.watchdog !== undefined) {
    alertReceivedAt = { liveness: perCheck.liveness, readiness: perCheck.readiness, watchdog: perCheck.watchdog };
  } else {
    return refuse("give --alert, or all three of --alert-liveness, --alert-readiness and --alert-watchdog");
  }
  for (const [name, iso] of Object.entries(alertReceivedAt)) {
    if (parseIsoInstant(iso) === null) return refuse(`the ${name} alert time is not an ISO instant with a zone`);
  }

  const reminderReceivedAt = values["--reminder"] ?? "";
  if (parseIsoInstant(reminderReceivedAt) === null) return refuse("--reminder must be an ISO instant with a zone");

  const listed = (values["--reminder-lists"] ?? "").split(",").map(item => item.trim()).filter(item => item.length > 0);
  const reminderListed: CheckName[] = [];
  for (const item of listed) {
    if (!isCheckName(item)) return refuse(`--reminder-lists names ${item}, which is not a check`);
    if (reminderListed.includes(item)) return refuse(`--reminder-lists names ${item} twice`);
    reminderListed.push(item);
  }
  if (reminderListed.length === 0) return refuse("--reminder-lists is required: the checks the reminder mail listed");

  return { ok: true, args: { operator, stateRoot, alertReceivedAt, bundledAlert: bundled !== undefined, reminderReceivedAt, reminderListed, dryRun } };
}

function instantOf(iso: string): number {
  return parseIsoInstant(iso) ?? Number.NaN;
}

/**
 * The line to append, or why none may be written. Any API reading that could not be taken
 * refuses (A1); the cross-check of `core/confirmation.ts` must pass, against the moment of
 * writing, so that no receipt after it is written (review of 2026-09-14, point 2); and a
 * line that would carry anything credential-shaped is refused by shape, whatever produced it.
 */
export function buildConfirmation(
  args: ConfirmArgs,
  summaries: Reading<Readonly<Record<CheckName, CheckSummary>>>,
  flips: Readonly<Record<CheckName, Reading<readonly CheckFlip[]>>>,
  nowUtcMs: number,
): ConfirmationResult {
  if (!summaries.known) return { ok: false, reasons: [`checks: ${summaries.reason}`] };
  const liveness = flips.liveness;
  const readiness = flips.readiness;
  const watchdog = flips.watchdog;
  const unreadable: string[] = [];
  if (!liveness.known) unreadable.push(`liveness flips: ${liveness.reason}`);
  if (!readiness.known) unreadable.push(`readiness flips: ${readiness.reason}`);
  if (!watchdog.known) unreadable.push(`watchdog flips: ${watchdog.reason}`);
  if (!liveness.known || !readiness.known || !watchdog.known) return { ok: false, reasons: unreadable };

  const cross = crossCheckAlerts({
    operator: args.operator,
    alertReceivedUtcMs: { liveness: instantOf(args.alertReceivedAt.liveness), readiness: instantOf(args.alertReceivedAt.readiness), watchdog: instantOf(args.alertReceivedAt.watchdog) },
    bundledAlert: args.bundledAlert,
    reminderReceivedUtcMs: instantOf(args.reminderReceivedAt),
    reminderListed: args.reminderListed,
  }, { liveness: liveness.value, readiness: readiness.value, watchdog: watchdog.value }, nowUtcMs);
  if (!cross.ok) return { ok: false, reasons: cross.reasons };

  const fingerprints = { liveness: summaries.value.liveness.fingerprint, readiness: summaries.value.readiness.fingerprint, watchdog: summaries.value.watchdog.fingerprint };
  const line = JSON.stringify({
    operator: args.operator,
    alertReceivedAt: args.alertReceivedAt,
    bundledAlert: args.bundledAlert,
    reminderReceivedAt: args.reminderReceivedAt,
    reminderListed: args.reminderListed,
    fingerprints,
    downFlips: {
      liveness: new Date(cross.downFlipUtcMs.liveness).toISOString(),
      readiness: new Date(cross.downFlipUtcMs.readiness).toISOString(),
      watchdog: new Date(cross.downFlipUtcMs.watchdog).toISOString(),
    },
    crossCheck: "passed",
    recordedAt: new Date(nowUtcMs).toISOString(),
  });
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(line) || /hc-ping\.com|healthchecks\.io/i.test(line)) {
    return { ok: false, reasons: ["the line would carry a credential-shaped value"] };
  }
  return { ok: true, line, cross, fingerprints };
}
