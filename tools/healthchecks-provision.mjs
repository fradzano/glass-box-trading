// Create the three external checks through the healthchecks.io management API,
// write their ping URLs into .env, and optionally delete the checks whose URLs
// are being replaced.
//
//   node tools/healthchecks-provision.mjs --list
//   node tools/healthchecks-provision.mjs --tz Europe/Berlin \
//        --cycle-cron "0,15,30,45 14-23 * * 1-5" \
//        --watchdog-cron "0,5,10,15,20,25,30,35,40,45,50,55 14-23 * * 1-5" \
//        --rotate --apply
//
// Why this exists. Owner step 3 used to be six values transcribed by hand into
// three web forms -- two cron expressions, a timezone, three graces -- and then
// three ping URLs copied back. Every one of those is a silent failure if it
// goes wrong: a wrong cron alarms on a healthy night, and two identical URLs
// leave all three checks green while one signal is simply gone. The two cron
// expressions still come from `install-scheduled-task.ps1 -WhatIf`, because
// that is the only thing that knows what trigger it will register; everything
// else is derived here and nothing is typed twice.
//
// It NEVER prints a ping URL. A ping URL authorises pinging: whoever has it can
// send success pings and thereby suppress a real silence alarm, so it belongs
// in .env and nowhere else. Checks are identified in output by name and by the
// same `hc:` fingerprint `check-alert-path.ps1` prints, which is enough to tell
// three endpoints apart and to catch two that are the same.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const API = "https://healthchecks.io/api/v3";

// The graces the installer prints, in seconds. Liveness and watchdog are fixed
// there; readiness is DEAD_MAN_BOUND_MS. If these ever disagree with what
// `install-scheduled-task.ps1 -WhatIf` shows, the installer is right and this
// is stale -- it prints both so the disagreement is visible.
const GRACE_SECONDS = { liveness: 30 * 60, readiness: 50 * 60, watchdog: 15 * 60 };

const CHECKS = [
  { name: "gbt-liveness", env: "HEALTHCHECK_LIVENESS_URL", grace: GRACE_SECONDS.liveness, cron: "cycle", desc: "Glass Box Trading: the scheduled invocation happened at all (S-G14-05 liveness). Pinged by tools/cycle-run.ps1 on every firing, session or not." },
  { name: "gbt-readiness", env: "HEALTHCHECK_PING_URL", grace: GRACE_SECONDS.readiness, cron: "cycle", desc: "Glass Box Trading: no impediment stands (S-G14-05 readiness). Pinged by dist/shell/readiness-cli.js on every firing; fails on a halt, an unreleased fence, an unwritable or unreadable state." },
  { name: "gbt-watchdog", env: "HEALTHCHECK_WATCHDOG_URL", grace: GRACE_SECONDS.watchdog, cron: "watchdog", desc: "Glass Box Trading: the dead-man watchdog itself is running (S-G14). Its own endpoint, because liveness comes from the cycle wrapper and readiness from the state files -- neither can see the watchdog." },
];

function parseArgs(argv) {
  const options = { list: false, rotate: false, apply: false, tz: null, cycleCron: null, watchdogCron: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--list") options.list = true;
    else if (flag === "--rotate") options.rotate = true;
    else if (flag === "--apply") options.apply = true;
    else if (flag === "--tz") { options.tz = argv[i + 1]; i += 1; }
    else if (flag === "--cycle-cron") { options.cycleCron = argv[i + 1]; i += 1; }
    else if (flag === "--watchdog-cron") { options.watchdogCron = argv[i + 1]; i += 1; }
    else throw new Error(`unknown flag ${flag}`);
  }
  return options;
}

function dotEnv(repoRoot) {
  const file = path.join(repoRoot, ".env");
  const text = readFileSync(file, "utf8");
  const values = new Map();
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const at = line.indexOf("=");
    if (at <= 0) continue;
    let value = line.slice(at + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values.set(line.slice(0, at).trim(), value);
  }
  return { file, text, values };
}

const fingerprint = url => (typeof url === "string" && url.length > 0 ? `hc:${createHash("sha256").update(url, "utf8").digest("hex").slice(0, 8)}` : "(unset)");

async function api(key, method, urlOrPath, body) {
  const url = urlOrPath.startsWith("http") ? urlOrPath : `${API}${urlOrPath}`;
  const response = await fetch(url, {
    method,
    headers: { "X-Api-Key": key, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${url.replace(/\/[0-9a-f-]{36}$/u, "/<uuid>")} -> HTTP ${String(response.status)} ${text.slice(0, 200)}`);
  try {
    return text.length > 0 ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

const options = parseArgs(process.argv.slice(2));
const repoRoot = process.cwd();
const env = dotEnv(repoRoot);
const key = env.values.get("HEALTHCHECK_IO_API_KEY") ?? "";
if (key.length === 0) {
  process.stderr.write("HEALTHCHECK_IO_API_KEY is not set in .env. Create a project API key with WRITE access in the healthchecks.io project settings.\n");
  process.exit(2);
}

const existing = await api(key, "GET", "/checks/");
const checks = existing?.checks ?? [];

if (options.list) {
  process.stdout.write(`${String(checks.length)} check(s) in this project:\n`);
  for (const check of checks) {
    process.stdout.write(`  ${String(check.name).padEnd(20)} ${fingerprint(check.ping_url)}  schedule=${String(check.schedule ?? check.timeout ?? "?")}  tz=${String(check.tz ?? "-")}  grace=${String(check.grace)}s  status=${String(check.status)}\n`);
  }
  process.exit(0);
}

if (options.tz === null || options.cycleCron === null || options.watchdogCron === null) {
  process.stderr.write("--tz, --cycle-cron and --watchdog-cron are required. Take all three from:\n");
  process.stderr.write("  .\\tools\\install-scheduled-task.ps1 -WhatIf -CoverageThroughDate <journaling-only day>\n");
  process.exit(2);
}
for (const [label, expression] of [["--cycle-cron", options.cycleCron], ["--watchdog-cron", options.watchdogCron]]) {
  if (expression.trim().split(/\s+/u).length !== 5) {
    process.stderr.write(`${label} is not a five-field cron expression: "${expression}"\n`);
    process.exit(2);
  }
}

// The checks whose URLs are currently in .env: those are the ones being replaced.
const replacing = new Map();
for (const check of CHECKS) {
  const current = env.values.get(check.env) ?? "";
  const match = checks.find(candidate => typeof candidate.ping_url === "string" && candidate.ping_url === current);
  if (match !== undefined) replacing.set(check.name, match);
}

process.stdout.write(`timezone       ${options.tz}\n`);
process.stdout.write(`cycle cron     ${options.cycleCron}\n`);
process.stdout.write(`watchdog cron  ${options.watchdogCron}\n\n`);
for (const check of CHECKS) {
  const old = replacing.get(check.name);
  const cron = check.cron === "cycle" ? options.cycleCron : options.watchdogCron;
  process.stdout.write(`${check.name.padEnd(16)} grace ${String(check.grace / 60).padStart(2)} min  cron ${cron}\n`);
  process.stdout.write(`${" ".repeat(16)} ${old === undefined ? "no existing check holds the URL currently in .env" : `replaces ${fingerprint(old.ping_url)}${options.rotate ? " (will be DELETED)" : " (left in place)"}`}\n`);
}
process.stdout.write("\n");

if (!options.apply) {
  process.stdout.write("Dry run. Nothing was created, deleted or written. Add --apply to carry this out.\n");
  process.exit(0);
}

// Delete first: healthchecks.io does not require unique names, and two checks
// called gbt-liveness would be worse than none.
if (options.rotate) {
  for (const [name, check] of replacing) {
    await api(key, "DELETE", check.update_url ?? `${API}/checks/${String(check.uuid)}`);
    process.stdout.write(`deleted   ${name.padEnd(16)} ${fingerprint(check.ping_url)}\n`);
  }
}

const created = [];
for (const check of CHECKS) {
  const cron = check.cron === "cycle" ? options.cycleCron : options.watchdogCron;
  // `channels: "*"` assigns every integration in the project. Without it a
  // check is created with NO notification channel and fails silently forever,
  // which is the one outcome this whole mechanism exists to prevent.
  const body = { name: check.name, desc: check.desc, schedule: cron, tz: options.tz, grace: check.grace, channels: "*", unique: [] };
  const result = await api(key, "POST", "/checks/", body);
  // Pause it at once. A cron check that has never been pinged goes down on its
  // first missed expectation and starts alarming -- overnight, days before
  // anything is supposed to ping it. Pausing is not the weaker state it looks
  // like: the first ping resumes a paused check automatically, so the
  // alert-path test wakes them by itself and nothing has to be remembered.
  await api(key, "POST", String(result.pause_url ?? `${API}/checks/${String(result.uuid)}/pause`));
  created.push({ ...check, pingUrl: String(result.ping_url) });
  process.stdout.write(`created   ${check.name.padEnd(16)} ${fingerprint(result.ping_url)}  (paused)\n`);
}

// Rewrite only the three lines, leaving every other byte of .env alone.
let text = env.text;
for (const check of created) {
  const pattern = new RegExp(`^${check.env}=.*$`, "mu");
  text = pattern.test(text) ? text.replace(pattern, `${check.env}=${check.pingUrl}`) : `${text.replace(/\s*$/u, "")}\n${check.env}=${check.pingUrl}\n`;
}
writeFileSync(env.file, text, "utf8");

const distinct = new Set(created.map(check => check.pingUrl)).size;
process.stdout.write(`\n.env updated: three ping URLs written, ${String(distinct)} distinct.\n`);
if (distinct !== 3) {
  process.stderr.write("TWO OF THE THREE URLS ARE THE SAME. That is the failure nothing later catches. Investigate before continuing.\n");
  process.exit(1);
}
process.stdout.write("No URL was printed. Verify with: .\\tools\\check-alert-path.ps1\n");
process.stdout.write("Then: confirm three alerts on your phone, wait out one reminder period, confirm the second\n");
process.stdout.write("message, run -ResolveOnly, and pause all three checks until the evening of the gate.\n");
