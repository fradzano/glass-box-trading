// Dataset gate for the video render (SUB-04, video/README.md): every URL and
// number on screen comes from public/dataset/{meta,projection}.json, and the
// render refuses a dataset that is not the frozen presentation-cutoff one.
// `--frozen` is what `npm run render` passes; `npm run render:dev` and the
// studio accept an unfrozen dataset (the scenes then carry a DEV watermark).
// The same rules live in src/dataset.ts for the running composition; this
// script exists so the refusal happens before Remotion starts a bundler.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const datasetDir = path.join(here, "..", "public", "dataset");
const requireFrozen = process.argv.includes("--frozen");
const failures = [];

function read(name) {
  try {
    return JSON.parse(readFileSync(path.join(datasetDir, name), "utf8"));
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function walkStrings(value, at, visit) {
  if (typeof value === "string") visit(value, at);
  else if (Array.isArray(value)) value.forEach((item, index) => walkStrings(item, `${at}[${String(index)}]`, visit));
  else if (value !== null && typeof value === "object") for (const [key, item] of Object.entries(value)) walkStrings(item, `${at}.${key}`, visit);
}

const meta = read("meta.json");
const projection = read("projection.json");
if (meta !== null && projection !== null) {
  walkStrings(meta, "meta", (text, at) => { if (text.includes("{{")) failures.push(`${at} still holds a placeholder: ${text}`); });
  if (requireFrozen && meta.frozen !== true) failures.push("meta.frozen is not true: this is not the frozen presentation-cutoff dataset (render:dev accepts it, render does not)");
  if (projection.cutoff?.kind !== "presentation") failures.push(`projection.cutoff.kind is ${JSON.stringify(projection.cutoff?.kind)}, expected "presentation"`);
  if (typeof projection.cutoff?.at !== "string" || projection.cutoff.at !== meta.presentationCutoffAt) failures.push(`meta.presentationCutoffAt ${JSON.stringify(meta.presentationCutoffAt)} differs from projection.cutoff.at ${JSON.stringify(projection.cutoff?.at)}`);
  if (typeof projection.accountId !== "string" || projection.accountId !== meta.accountId) failures.push(`meta.accountId ${JSON.stringify(meta.accountId)} differs from projection.accountId ${JSON.stringify(projection.accountId)}`);
  if (typeof projection.journalRevision !== "string") failures.push("projection.journalRevision missing");
  else {
    const safe = projection.journalRevision.replace(":", "-");
    if (typeof meta.presentationRouteUrl !== "string" || !meta.presentationRouteUrl.includes(`/revisions/${safe}/presentation/`)) failures.push(`meta.presentationRouteUrl does not name the pinned route /revisions/${safe}/presentation/`);
  }
  for (const [name, value] of [["startEquityCents", projection.startEquityCents], ["currentEquityCents", projection.currentEquityCents], ["pnlAbsoluteCents", projection.pnlAbsoluteCents], ["pnlBps", projection.pnlBps]]) {
    if (typeof value !== "number" || !Number.isFinite(value)) failures.push(`projection.${name} is not a finite number (${JSON.stringify(value)}); the video cannot state the result`);
  }
  if (requireFrozen && projection.flatState !== "flat" && projection.flatState !== "declared_expiry_hold") failures.push(`projection.flatState is ${JSON.stringify(projection.flatState)}: the presentation cutoff must be risk-flat (SUBMISSION-SPEC §4.1)`);
  for (const [name, url] of [["demoUrl", meta.demoUrl], ["presentationRouteUrl", meta.presentationRouteUrl], ["repositoryUrl", meta.repositoryUrl]]) {
    if (typeof url !== "string" || !url.startsWith("https://")) failures.push(`meta.${name} is not an https URL`);
  }
  // The frozen render is mostly the working demo (SUBMISSION-SPEC section 5): every capture slot must name a recording that exists.
  for (const [scene, file] of Object.entries(meta.captures ?? {})) {
    if (file === null) { if (requireFrozen) failures.push(`meta.captures.${scene} is null: the frozen render needs the screen recording (dev renders show a stand-in)`); continue; }
    if (typeof file !== "string" || !existsSync(path.join(here, "..", "public", "captures", file))) failures.push(`meta.captures.${scene} names ${JSON.stringify(file)}, which is not under public/captures/`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`dataset check FAILED (${String(failures.length)}):\n${failures.map(line => `  - ${line}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`dataset ok: revision ${projection.journalRevision}, presentation cutoff ${projection.cutoff.at}, account ${projection.accountId}, frozen=${String(meta.frozen === true)}\n`);
