// Mutation probe for the activation core: break one thing at a time, run the
// activation suite, record whether a test failed. "Green is not correct" — a suite
// that no mutant can turn red measures nothing — so every core unit ships with a
// mutant set beside this script, and the build log records the result.
//
// The original bytes are kept in memory, restored after every mutant and in a
// `finally`, and the file hash is compared at the end, so an interrupted run cannot
// leave a broken core behind unnoticed.
//
// Usage, from the repository root:
//   node ops/activation/probes/mutate-activation.mjs ops/activation/core/<unit>.ts ops/activation/probes/mutants-<unit>.json
//
// Do not add or edit a *.spec.ts file while a probe runs: the suite would pick it up,
// and a mutant could look caught for a reason that has nothing to do with it.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

// An optional third argument restricts the run to one spec file, to measure what that
// file catches on its own (unit 6 measures the sequence tests this way).
const [target, mutantsFile, onlySpec] = process.argv.slice(2);
if (!target || !mutantsFile) {
  process.stderr.write("usage: node ops/activation/probes/mutate-activation.mjs <core file> <mutants json> [spec file]\n");
  process.exit(2);
}
if (onlySpec !== undefined && !/^[\w./-]+\.spec\.ts$/.test(onlySpec)) {
  process.stderr.write("the spec filter must be a plain relative *.spec.ts path\n");
  process.exit(2);
}

const original = readFileSync(target);
const originalText = original.toString("utf8");
const originalHash = createHash("sha256").update(original).digest("hex");
const mutants = JSON.parse(readFileSync(mutantsFile, "utf8"));

const results = [];
try {
  for (const mutant of mutants) {
    if (!originalText.includes(mutant.from)) {
      results.push({ id: mutant.id, status: "NOT_APPLICABLE", note: `anchor text not found — ${mutant.note}` });
      continue;
    }
    writeFileSync(target, originalText.replace(mutant.from, mutant.to), "utf8");
    // One command string with shell: true — Windows cannot spawn npx.cmd without a shell.
    const run = spawnSync(`npx.cmd vitest run --config ops/vitest.config.ts${onlySpec === undefined ? "" : ` ${onlySpec}`}`, { encoding: "utf8", shell: true });
    results.push({ id: mutant.id, status: run.status !== 0 ? "CAUGHT" : "SURVIVED", note: mutant.note });
    writeFileSync(target, original);
  }
} finally {
  writeFileSync(target, original);
}

const restoredHash = createHash("sha256").update(readFileSync(target)).digest("hex");
for (const result of results) process.stdout.write(`${result.status.padEnd(15)} ${result.id.padEnd(5)} ${result.note}\n`);
const caught = results.filter(result => result.status === "CAUGHT").length;
process.stdout.write(`\n${String(caught)} of ${String(results.length)} caught; restored byte-identical: ${String(restoredHash === originalHash)}\n`);
process.exitCode = restoredHash === originalHash && caught === results.length ? 0 : 1;
