// Verify that implementation phases partition the runtime SPEC cases. Kept in
// Node so `npm run verify` uses the repository's pinned runtime end to end.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const spec = readFileSync(path.join(root, "docs", "SPEC.md"), "utf8");
const config = JSON.parse(readFileSync(path.join(root, "config", "implementation-phases.json"), "utf8"));

function fail(message) {
  process.stderr.write(`implementation phase check failed: ${message}\n`);
  process.exit(1);
}

function matches(pattern, text) {
  return [...text.matchAll(pattern)].map(match => match[1]);
}

const defined = [
  ...matches(/^- \*\*(S-[A-Z0-9-]+)\*\*/gm, spec),
  ...matches(/^### (S-ARM-[0-9]+)\b/gm, spec),
];
const duplicates = [...new Set(defined.filter((value, index) => defined.indexOf(value) !== index))].sort();
if (duplicates.length > 0) fail(`duplicate SPEC definitions: ${duplicates.join(", ")}`);

const cases = new Set(defined);
if (cases.size !== config.expectedDefinedCases) fail(`expected ${String(config.expectedDefinedCases)} defined cases, found ${String(cases.size)}`);

const declaredLimits = new Set(config.declaredLimits);
const specDeclaredLimits = new Set(matches(/^- \*\*(S-[A-Z0-9-]+)\*\*.*Declared limit .*NOT a test case/gm, spec));
const sameSet = (left, right) => left.size === right.size && [...left].every(value => right.has(value));
if (!sameSet(declaredLimits, specDeclaredLimits)) fail(`declared-limit manifest differs from SPEC: manifest=${JSON.stringify([...declaredLimits].sort())}, spec=${JSON.stringify([...specDeclaredLimits].sort())}`);
const unknownLimits = [...declaredLimits].filter(value => !cases.has(value)).sort();
if (unknownLimits.length > 0) fail(`declared limits absent from SPEC: ${unknownLimits.join(", ")}`);

const assignments = new Map([...cases].map(value => [value, []]));
const emptyPatterns = [];
const phaseCounts = new Map();
for (const [phase, rawPatterns] of Object.entries(config.phases)) {
  const patterns = rawPatterns.map(raw => ({ raw, regex: new RegExp(`^(?:${raw})$`) }));
  for (const { raw, regex } of patterns) if (![...cases].some(value => regex.test(value))) emptyPatterns.push(`${phase}:${raw}`);
  for (const value of cases) if (patterns.some(({ regex }) => regex.test(value))) assignments.get(value).push(phase);
  phaseCounts.set(phase, [...assignments.values()].filter(owners => owners.includes(phase)).length);
}
if (emptyPatterns.length > 0) fail(`patterns matching no case: ${emptyPatterns.join(", ")}`);
const missing = [...assignments].filter(([, owners]) => owners.length === 0).map(([value]) => value).sort();
const multiple = [...assignments].filter(([, owners]) => owners.length > 1).sort(([left], [right]) => left.localeCompare(right));
if (missing.length > 0) fail(`unassigned cases: ${missing.join(", ")}`);
if (multiple.length > 0) fail(`multiply assigned cases: ${multiple.map(([value, owners]) => `${value}=${JSON.stringify(owners)}`).join(", ")}`);

const testCount = cases.size - declaredLimits.size;
if (testCount !== config.expectedTestCases) fail(`expected ${String(config.expectedTestCases)} test cases, found ${String(testCount)}`);
const counts = [...phaseCounts].map(([phase, count]) => `${phase}=${String(count)}`).join(" ");
process.stdout.write(`implementation phases OK: ${String(cases.size)} definitions, ${String(testCount)} tests, ${String(declaredLimits.size)} declared limit; ${counts}\n`);
