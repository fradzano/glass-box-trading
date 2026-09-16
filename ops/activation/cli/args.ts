// The command line of `ops/activation/cli.ts` (unit 10 brief, docs/P12-ACTIVATION-BUILD.md).
//
// Five commands share one vocabulary: `status` reads and never writes, `run` is what the
// scheduled task invokes every five minutes, `open` is the owner's retry after an abort
// (spec §5, "Retry on the next trading day"), `abort --confirm` is the owner's own stop
// (spec §5, ACT-27), and `disarm` is the 15:05 one-shot of spec §6 whose argument vector
// `disarmFindings` already pins by value.
//
// Nothing here is a default: a flag that does not belong to the command it was typed
// after is a refusal, not an ignored token. A scheduled task's argument line is compared
// against an expectation elsewhere in this codebase, so an argument this parser silently
// swallowed would be a line no one can see.
export type ActivationCommand = "status" | "run" | "open" | "abort" | "disarm";

export interface ActivationInvocation {
  readonly command: ActivationCommand;
  readonly stateRoot: string;
  /** `YYYY-MM-DD`; required for `run` and `disarm`, absent for the other two. */
  readonly anchorDay: string | null;
  /** Required for `abort`, absent otherwise: the terminal entry names who stopped the run. */
  readonly operator: string | null;
  readonly dryRun: boolean;
}

export type ParsedInvocation =
  | { readonly ok: true; readonly invocation: ActivationInvocation }
  | { readonly ok: false; readonly reason: string };

const COMMANDS: readonly ActivationCommand[] = ["status", "run", "open", "abort", "disarm"];

/** Which flags each command accepts. `--confirm` is `abort`'s alone; it is not a global safety word. */
function flagsFor(command: ActivationCommand): readonly string[] {
  switch (command) {
    case "status":
      return ["--state-root"];
    case "run":
      return ["--state-root", "--anchor-day", "--dry-run"];
    case "open":
      return ["--state-root", "--anchor-day", "--operator", "--dry-run"];
    case "abort":
      return ["--state-root", "--operator", "--confirm", "--dry-run"];
    case "disarm":
      return ["--state-root", "--anchor-day", "--dry-run"];
  }
}

function isFlagWithoutValue(flag: string): boolean {
  return flag === "--dry-run" || flag === "--confirm";
}

function refuse(reason: string): ParsedInvocation {
  return { ok: false, reason };
}

function isCommand(value: string): value is ActivationCommand {
  return COMMANDS.includes(value as ActivationCommand);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/**
 * `YYYY-MM-DD` as a real calendar day. The core compares anchor days as strings, so a
 * day that does not exist would compare equal to nothing and turn every step into "not
 * for today" without ever saying why.
 */
export function isCalendarDay(value: string): boolean {
  if (value.length !== 10 || value[4] !== "-" || value[7] !== "-") return false;
  for (let index = 0; index < value.length; index += 1) {
    if (index === 4 || index === 7) continue;
    const code = value.charCodeAt(index);
    if (code < 48 || code > 57) return false;
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

/**
 * `argv` without the node path and the script: the command first, then its flags.
 * Every refusal names the argument it refused, because this parser's output is the only
 * thing an owner sees when a scheduled task's line is wrong.
 */
export function parseInvocation(argv: readonly string[]): ParsedInvocation {
  const first = argv[0];
  if (first === undefined) return refuse("give a command: status, run, open, abort --confirm, or disarm");
  if (first.startsWith("--")) return refuse(`the first argument must be a command, not ${first}`);
  if (!isCommand(first)) return refuse(`unknown command ${first}`);
  const command = first;
  const accepted = flagsFor(command);

  const values: Record<string, string> = {};
  const present: string[] = [];
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index] ?? "";
    if (!flag.startsWith("--")) return refuse(`unexpected argument ${flag}`);
    if (!accepted.includes(flag)) return refuse(`${command} does not accept ${flag}`);
    if (present.includes(flag)) return refuse(`${flag} is given twice`);
    present.push(flag);
    if (isFlagWithoutValue(flag)) continue;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) return refuse(`${flag} needs a value`);
    values[flag] = value;
    index += 1;
  }

  const stateRoot = values["--state-root"] ?? "";
  if (stateRoot.length === 0) return refuse("--state-root is required");

  let anchorDay: string | null = null;
  if (command === "run" || command === "disarm" || command === "open") {
    const given = values["--anchor-day"] ?? "";
    if (given.length === 0) return refuse(`--anchor-day is required for ${command}`);
    if (!isCalendarDay(given)) return refuse(`--anchor-day must be a calendar day as YYYY-MM-DD, not ${given}`);
    anchorDay = given;
  }

  let operator: string | null = null;
  if (command === "open") {
    const given = (values["--operator"] ?? "").trim();
    if (given.length === 0) return refuse("--operator is required for open: a new attempt after an abort is a decision with a name on it");
    operator = given;
  }
  if (command === "abort") {
    if (!present.includes("--confirm")) return refuse("abort needs --confirm: it disables both tasks and ends the attempt");
    const given = (values["--operator"] ?? "").trim();
    if (given.length === 0) return refuse("--operator is required for abort: the terminal entry names who stopped the run");
    operator = given;
  }

  return { ok: true, invocation: { command, stateRoot, anchorDay, operator, dryRun: present.includes("--dry-run") } };
}
