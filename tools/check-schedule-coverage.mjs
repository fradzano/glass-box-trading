// S-G14-06 / scenario #80: does the registered trigger window actually contain
// the American regular session on every weekday of a deployment, in the
// scheduler's own local time, across both clock changes?
//
// The trigger is registered once, at fixed local wall-clock times computed from
// the session on installation day. Europe and the United States change their
// clocks on different Sundays, so for the week between them the session moves
// an hour in local terms. This walks every weekday of a given range and reports
// the worst-case margin, so the padding is a measured number rather than a
// guess. Run it before installing the tasks for a long deployment:
//
//   node tools/check-schedule-coverage.mjs --from 2026-09-08 --to 2026-12-08 \
//     --installed-on 2026-09-08 --margin 75 [--zone Europe/Berlin]
import process from "node:process";

const NEW_YORK = "America/New_York";

function parseArgs(argv) {
  const options = { margin: 75, zone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`flag ${flag} has no value`);
    if (flag === "--from") options.from = value;
    else if (flag === "--to") options.to = value;
    else if (flag === "--installed-on") options.installedOn = value;
    else if (flag === "--margin") options.margin = Number(value);
    else if (flag === "--zone") options.zone = value;
    else throw new Error(`unknown flag ${flag}; use --from --to --installed-on --margin --zone`);
  }
  for (const required of ["from", "to", "installedOn"]) {
    if (options[required] === undefined) throw new Error(`--${required === "installedOn" ? "installed-on" : required} is required`);
  }
  if (!Number.isFinite(options.margin) || options.margin < 0) throw new Error("--margin must be a non-negative number of minutes");
  return options;
}

/** Minutes after local midnight, in `zone`, of the instant `date`T`time` in America/New_York. */
function localMinutesOfNewYorkTime(date, time, zone) {
  const utcMs = newYorkToUtcMs(date, time);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(utcMs)).map(part => [part.type, part.value]));
  return { minutes: Number(parts.hour) * 60 + Number(parts.minute), date: `${parts.year}-${parts.month}-${parts.day}` };
}

/** New York wall clock to epoch ms, DST-correct through the platform's zone tables. */
function newYorkToUtcMs(date, time) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offsetAt = ms => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: NEW_YORK, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(ms)).map(part => [part.type, part.value]));
    const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
  };
  const first = guess - offsetAt(guess) * 60_000;
  const second = offsetAt(first);
  return second === offsetAt(guess) ? first : guess - second * 60_000;
}

function* weekdays(from, to) {
  for (let ms = Date.parse(`${from}T12:00:00Z`); ms <= Date.parse(`${to}T12:00:00Z`); ms += 86_400_000) {
    const day = new Date(ms);
    const weekday = day.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    yield day.toISOString().slice(0, 10);
  }
}

const options = parseArgs(process.argv.slice(2));
// The installer registers the trigger from the session on installation day.
const installedOpen = localMinutesOfNewYorkTime(options.installedOn, "09:30", options.zone).minutes - options.margin;
const installedClose = localMinutesOfNewYorkTime(options.installedOn, "16:00", options.zone).minutes + options.margin;

const rows = [];
for (const date of weekdays(options.from, options.to)) {
  const open = localMinutesOfNewYorkTime(date, "09:30", options.zone);
  const close = localMinutesOfNewYorkTime(date, "16:00", options.zone);
  // A session that crosses local midnight would break the whole trigger shape;
  // report it rather than silently comparing minutes across different days.
  const crossesMidnight = close.date !== open.date;
  // R43-B12: the trigger fires Monday to Friday in the SCHEDULER's local time.
  // In a far-eastern zone a New York Friday session lands on the local
  // Saturday, so every minute comparison passes while the task never fires.
  // Berlin is never affected; an accepted `--zone` must not silently be.
  const localWeekday = new Date(`${open.date}T12:00:00Z`).getUTCDay();
  const firesOnThatDay = localWeekday >= 1 && localWeekday <= 5;
  const leadMargin = open.minutes - installedOpen;
  const tailMargin = installedClose - close.minutes;
  rows.push({ date, localDate: open.date, openLocal: open.minutes, closeLocal: close.minutes, leadMargin, tailMargin, firesOnThatDay, covered: firesOnThatDay && !crossesMidnight && leadMargin >= 0 && tailMargin >= 0 });
}

const asClock = minutes => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
// R43-C5: a reversed or empty range produced zero rows and then a TypeError.
if (rows.length === 0) {
  process.stdout.write(`no weekdays between ${options.from} and ${options.to}; check the order of --from and --to\n`);
  process.exit(1);
}
const uncovered = rows.filter(row => !row.covered);
const worstLead = rows.reduce((worst, row) => (row.leadMargin < worst.leadMargin ? row : worst), rows[0]);
const worstTail = rows.reduce((worst, row) => (row.tailMargin < worst.tailMargin ? row : worst), rows[0]);
const shifts = rows.filter((row, index) => index > 0 && row.openLocal !== rows[index - 1].openLocal);

process.stdout.write(`zone ${options.zone}; installed on ${options.installedOn}; margin ${String(options.margin)} min\n`);
process.stdout.write(`window checked against (local): ${asClock(installedOpen)}..${asClock(installedClose)} — the session padded by the margin, WITHOUT the outward snapping the installer applies, so this check is stricter than the window that gets registered and can never overstate coverage\n`);
process.stdout.write(`${String(rows.length)} weekdays from ${options.from} to ${options.to}\n`);
for (const shift of shifts) {
  process.stdout.write(`  local session start moves to ${asClock(shift.openLocal)} on ${shift.date}\n`);
}
process.stdout.write(`worst lead margin ${String(worstLead.leadMargin)} min on ${worstLead.date}; worst tail margin ${String(worstTail.tailMargin)} min on ${worstTail.date}\n`);
if (uncovered.length > 0) {
  for (const row of uncovered.slice(0, 10)) {
    const why = row.firesOnThatDay ? `lead ${String(row.leadMargin)}, tail ${String(row.tailMargin)}` : `the session falls on local ${row.localDate}, which the Mon-Fri trigger does not cover`;
    process.stdout.write(`  UNCOVERED ${row.date}: session ${asClock(row.openLocal)}..${asClock(row.closeLocal)} local, ${why}\n`);
  }
  process.stdout.write(`SCHEDULE COVERAGE FAILED: ${String(uncovered.length)} of ${String(rows.length)} weekdays are not fully covered.\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`SCHEDULE COVERAGE OK: every weekday's session lies inside the trigger window.\n`);
}
