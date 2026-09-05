// What does a three-month journal cost to hold, fold and render?
//
// The projection folds the WHOLE journal on every render, and the render is on
// the publish path. Nothing has ever exercised that beyond 105 entries, so a
// long deployment's scale is a measurement to take before the run, not after.
//
// This builds a synthetic journal of a given length by replaying real entries
// with rewritten sequence numbers and timestamps — real shapes, real quote
// samples, real sizes — then measures parse, fold, projection and render at
// several checkpoints so the growth curve is visible rather than assumed.
//
//   node tools/measure-longrun-scale.mjs --source <journal.jsonl> --entries 2000
import { readFileSync, mkdtempSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Buffer } from "node:buffer";
import { performance } from "node:perf_hooks";

// R43-C3: the build beside THIS script, so a measurement taken in a review
// worktree measures that worktree rather than the main checkout.
const DIST = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist")).href;

function parseArgs(argv) {
  const options = { entries: 2000, checkpoints: 5 };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`flag ${flag} has no value`);
    if (flag === "--source") options.source = value;
    else if (flag === "--entries") options.entries = Number(value);
    else if (flag === "--checkpoints") options.checkpoints = Number(value);
    else throw new Error(`unknown flag ${flag}`);
  }
  if (options.source === undefined) throw new Error("--source is required");
  return options;
}

const options = parseArgs(process.argv.slice(2));
const { parseJournalText } = await import(`${DIST}/core/journal.js`);
const { projectPerformance } = await import(`${DIST}/core/projection.js`);
const { renderDashboard } = await import(`${DIST}/shell/render-dashboard.js`);
const { expectationFor } = await import(`${DIST}/shell/publisher.js`);
const { assessFreshness } = await import(`${DIST}/core/projection.js`);

const sourceText = readFileSync(options.source, "utf8");
const sourceLines = sourceText.split("\n").filter(line => line.trim().length > 0);
const sourceEntries = sourceLines.map(line => JSON.parse(line));
const bytesPerEntry = Buffer.byteLength(sourceText, "utf8") / sourceLines.length;

// The BOOTSTRAP must stay first and unique; everything after it is replayable.
const head = sourceEntries[0];
const body = sourceEntries.slice(1).filter(entry => entry.type === "CYCLE");
if (body.length === 0) throw new Error("the source journal has no CYCLE entries to replay");

function synthesise(count) {
  const lines = [JSON.stringify(head)];
  let at = Date.parse(head.at);
  for (let seq = 2; seq <= count; seq += 1) {
    const template = body[(seq - 2) % body.length];
    at += 900_000;
    lines.push(JSON.stringify({ ...template, seq, at: new Date(at).toISOString(), cycleIndex: seq }));
  }
  return `${lines.join("\n")}\n`;
}

const checkpoints = [];
for (let index = 1; index <= options.checkpoints; index += 1) {
  checkpoints.push(Math.max(2, Math.round((options.entries * index) / options.checkpoints)));
}

const scratch = mkdtempSync(path.join(tmpdir(), "gbt-scale-"));
const styles = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "dashboard.css"), "utf8");
const expectations = { initialCapitalCents: 10_000_000, expectedAccountId: null, flattenDate: "2026-12-08", profile: "competition", qualification: null };

process.stdout.write(`source ${options.source}: ${String(sourceLines.length)} entries, ${(bytesPerEntry / 1024).toFixed(1)} KiB per entry\n\n`);
process.stdout.write("entries      bytes  parse ms   fold+project ms   render ms   html KiB\n");

for (const count of checkpoints) {
  const text = synthesise(count);
  const file = path.join(scratch, `journal-${String(count)}.jsonl`);
  writeFileSync(file, text, "utf8");
  const bytes = statSync(file).size;

  const parseStart = performance.now();
  const parsed = parseJournalText(readFileSync(file, "utf8"));
  const parseMs = performance.now() - parseStart;

  const last = parsed.entries[parsed.entries.length - 1];
  const projectStart = performance.now();
  const projection = projectPerformance(parsed.entries, "sha256:0123456789abcdef", { at: last.at, kind: "latest" }, expectations);
  const projectMs = performance.now() - projectStart;

  const renderStart = performance.now();
  const html = renderDashboard(projection, expectationFor(projection), {
    renderedAt: last.at,
    freshness: assessFreshness(projection.lastUpdatedAt, Date.parse(last.at) + 1000, 900_000, 3_000_000),
    degradation: { degraded: false, explanation: "" },
    source: { repositoryUrl: "https://example.invalid", journalRevisionUrl: null, corePath: "src/core/decision.ts", evidenceTestPath: "tests/g1-defined-risk.spec.ts", evidenceDebtRow: "RES-P1-01a" },
    pinned: [],
    routeLabel: "scale measurement",
    styles,
  });
  const renderMs = performance.now() - renderStart;

  process.stdout.write(`${String(count).padStart(7)}  ${(bytes / 1048576).toFixed(1).padStart(7)}M  ${parseMs.toFixed(0).padStart(8)}  ${projectMs.toFixed(0).padStart(16)}  ${renderMs.toFixed(0).padStart(10)}  ${(Buffer.byteLength(html, "utf8") / 1024).toFixed(0).padStart(9)}\n`);
}

process.stdout.write(`\nscratch: ${scratch}\n`);
