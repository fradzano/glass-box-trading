// The human release, as a command: `node dist/shell/unhalt-cli.js`.
//
// S-G12-04 and S-G12-08 both end with "until a human un-halts", and the runbook
// told the operator to run `dist/shell/manual-unhalt.js`. That file exports a
// function and has no entry point: invoking it exits 0, prints nothing and
// changes nothing, so a fenced deployment stayed fenced while the operator
// believed they had released it (R43-B10). This is the missing command.
//
// It refuses more than it accepts, on purpose. The release is the one moment a
// human overrides a safety stop, so it states what it is about to do, requires
// the operator's name and a reason, and requires `--confirm` — and it prints
// the fence procedure first, because a credential fence means we do not know
// what orders are resting at the broker.
import { readFileSync } from "node:fs";
import { manualUnhalt } from "./manual-unhalt.js";
import { manualReleasePrecondition } from "../core/lifecycle.js";
import { readEpochStore } from "./epoch-store.js";
import { readHaltState } from "./halt-state.js";
import { resolveStateDir } from "./state-dir.js";
import { loadEnvironment, secretValues } from "./runtime-config.js";
import { parseJournalText } from "../core/journal.js";

interface Parsed {
  readonly operator: string;
  readonly reason: string;
  readonly confirm: boolean;
  readonly stateDir: string | null;
  readonly expectedHaltSeq: number | null;
}

function parseArgs(argv: readonly string[]): { readonly ok: true; readonly value: Parsed } | { readonly ok: false; readonly usage: string } {
  const usage = [
    "usage: node dist/shell/unhalt-cli.js --operator <name> --reason \"<why>\" --confirm [--state-dir <path>] [--expect-halt-seq <n>]",
    "",
    "  --operator          who is releasing. Recorded in the journal.",
    "  --reason            why, in words a reader will understand months later.",
    "  --confirm           required. Without it this prints the state and exits 2.",
    "  --state-dir         overrides STATE_DIR from the environment or .env.",
    "  --expect-halt-seq   refuse unless this is still the sequence of the standing HALT.",
  ].join("\n");
  const options: Record<string, string> = {};
  let confirm = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--confirm") { confirm = true; continue; }
    const value = argv[index + 1];
    if (flag === undefined || !flag.startsWith("--") || value === undefined || value.startsWith("--")) return { ok: false, usage };
    options[flag.slice(2)] = value;
    index += 1;
  }
  const operator = (options["operator"] ?? "").trim();
  const reason = (options["reason"] ?? "").trim();
  if (operator.length === 0 || reason.length === 0) return { ok: false, usage };
  const rawSeq = options["expect-halt-seq"];
  const expectedHaltSeq = rawSeq === undefined ? null : Number(rawSeq);
  if (expectedHaltSeq !== null && !Number.isSafeInteger(expectedHaltSeq)) return { ok: false, usage };
  return { ok: true, value: { operator, reason, confirm, stateDir: options["state-dir"] ?? null, expectedHaltSeq } };
}

const parsed = parseArgs(process.argv.slice(2));
if (!parsed.ok) {
  process.stderr.write(`${parsed.usage}\n`);
  process.exit(2);
}
const args = parsed.value;

const env = loadEnvironment(process.cwd(), process.env);
const rawStateDir = args.stateDir ?? env["STATE_DIR"] ?? "";
const paths = resolveStateDir(rawStateDir);
if (!paths.ok) {
  process.stderr.write(`STATE_DIR is unusable: ${paths.detail}\n`);
  process.exit(2);
}

const store = readEpochStore(paths.value);
const halt = readHaltState(paths.value);
const fencePending = store.kind === "present" && store.fencePending;
const entries = parseJournalText(readFileSync(paths.value.journal, "utf8")).entries;
const lastTransition = [...entries].reverse().find(entry => entry.type === "HALT" || entry.type === "UNHALT");

process.stdout.write(`state dir     ${paths.value.root}\n`);
process.stdout.write(`journal       ${String(entries.length)} entries, last seq ${String(entries[entries.length - 1]?.seq ?? 0)}\n`);
process.stdout.write(`halt flag     halted=${String(halt.halted)} reason=${String(halt.reason)} sticky=${String(halt.sticky)}\n`);
process.stdout.write(`fence mark    ${String(fencePending)}\n`);
process.stdout.write(`last halt     ${lastTransition === undefined ? "none in the journal" : `${lastTransition.type} seq ${String(lastTransition.seq)} reason ${typeof lastTransition["reason"] === "string" ? lastTransition["reason"] : "-"}`}\n`);

if (!halt.halted && !fencePending) {
  process.stdout.write("\nNothing to release: no halt stands and no fence mark is set.\n");
  process.exit(0);
}

if (fencePending) {
  process.stdout.write([
    "",
    "A CREDENTIAL FENCE stands. Before releasing it, run the fence procedure:",
    "  1. Open the broker dashboard for the bound account.",
    "  2. List every working order. The agent could not read them when the",
    "     credentials were refused, so it does not know what is resting there.",
    "  3. Cancel anything the journal does not explain.",
    "  4. Confirm the credentials in .env are the ones you intend to use.",
    "Only then release. The release is journaled with your name and reason.",
    "",
  ].join("\n"));
}

if (!args.confirm) {
  process.stdout.write("Nothing was changed: --confirm was not given.\n");
  process.exit(2);
}

// R44-B9: --expect-halt-seq was optional, and the runbook's own release command
// omitted it. A second halt landing between the preview above and this
// confirmation -- which a fenced deployment keeps producing -- was then
// released unseen, because the un-halt applies to whatever stands rather than
// to what the operator read. Where a halt entry exists, its sequence number is
// what the operator just read, so requiring it costs nothing and closes the
// window. A fence with no journaled halt has no sequence number to name, and
// only that case may omit it.
const precondition = manualReleasePrecondition({
  standingHaltSeq: lastTransition !== undefined && lastTransition.type === "HALT" ? lastTransition.seq : null,
  expectedHaltSeq: args.expectedHaltSeq,
});
if (!precondition.ok) {
  process.stderr.write([
    "",
    `REFUSED: a journaled halt stands (HALT seq ${String(precondition.requiredHaltSeq)}). Re-run with`,
    `  --expect-halt-seq ${String(precondition.requiredHaltSeq)}`,
    "so the release applies to the halt you just read and refuses if another one",
    "landed in between.",
    "",
  ].join("\n"));
  process.exit(2);
}

const result = await manualUnhalt({
  paths: paths.value,
  operator: args.operator,
  reason: args.reason,
  clock: () => Date.now(),
  secrets: secretValues(env),
  instanceId: `unhalt-${String(process.pid)}`,
  lockTakeoverBoundMs: 400_000,
  ...(args.expectedHaltSeq === null ? {} : { expectedHaltSeq: args.expectedHaltSeq }),
});

if (!result.ok) {
  process.stderr.write(`\nRELEASE REFUSED: ${result.reason}\n`);
  const after = readEpochStore(paths.value);
  process.stderr.write(`The deployment is still halted. fence mark now ${String(after.kind === "present" && after.fencePending)}.\n`);
  process.exit(1);
}

const after = readEpochStore(paths.value);
const releasedSeq = "seq" in result ? result.seq : null;
process.stdout.write(`\nRELEASED: UNHALT${releasedSeq === null ? "" : ` seq ${String(releasedSeq)}`} by ${args.operator}.\n`);
process.stdout.write(`fence mark now ${String(after.kind === "present" && after.fencePending)}; halt flag halted=${String(readHaltState(paths.value).halted)}.\n`);
process.exit(0);
