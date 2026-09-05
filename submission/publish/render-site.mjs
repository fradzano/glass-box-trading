// Digest-neutral publication path for the judge-facing dashboard (SUB-02,
// SUB-11; DECISIONS.md 2026-09-02 "digest-neutral publication path").
//
// The frozen build has no production caller for `runPublish` and no git or
// Vercel port (R35 C4). This script is the missing caller for the *render*
// half: it loads the BUILT modules under `dist/` (never `src/`), reads a COPY
// of the competition journal, renders the page set exactly as the publisher
// would (`sitePagesFor` + `buildSiteAtomically`), and derives a host-safe
// deploy tree next to it. The deploy itself stays a manual owner step
// (README "Publish the judge-facing dashboard"); the anonymous probe of the
// candidate is `tools/probe-dashboard.ps1` over the manifest written here.
//
// Why this file lives under `submission/` and not `tools/`: the S-ARM-01
// runtime digest binds every `tools/*.mjs`; adding one there would void the
// running certificate. `submission/**` is outside the digest
// (`src/shell/digests.ts`, `enumerateRuntimeFiles`).
//
// Two layouts are written (R37 C-3):
//   <out>/site    the renderer's own output, byte-for-byte, with the
//                 immutable-route carry-forward of `buildSiteAtomically`
//                 intact (`revisions/sha256%3A<hex>/<kind>/index.html`);
//   <out>/deploy  derived from `site` on every run: each path segment under
//                 `revisions/` is percent-DEcoded and re-spelled in the
//                 alphabet [A-Za-z0-9._-] (`sha256:<hex>` -> `sha256-<hex>`),
//                 and the history pin's `href` on every page is rewritten to
//                 the root-absolute form of that safe route. The renderer's
//                 site-root-relative href resolves wrongly from a nested
//                 route, and a literal `%3A` in a directory name depends on
//                 the host not decoding request paths — the deploy tree
//                 depends on neither. Everything else (meta tags, figures,
//                 anchors, stylesheet) is untouched.
//
// This file decides nothing the pure core does not decide: cutoffs,
// expectations and links are inputs; the projection and the page are the
// frozen build's.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SAFE_SEGMENT = /[^A-Za-z0-9._-]/gu;
const PIN_HREF = /href="(revisions\/[^"]+)"/gu;

/** Live STATE_DIR markers: a journal beside one of these is the original, never a copy. */
const LIVE_STATE_DIR_MARKERS = ["epoch.json", "pings.log", "halt.json", "quarantine"];

/** One path segment as the host-safe route spelling: percent-decoded, then every character outside [A-Za-z0-9._-] becomes `-`. */
export function hostSafeSegment(segment) {
  let decoded;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    decoded = segment;
  }
  return decoded.replace(SAFE_SEGMENT, "-");
}

/** A site-relative path (forward slashes) with every segment under `revisions/` re-spelled host-safe; other paths are returned unchanged. */
export function hostSafeRelativePath(relativePath) {
  const segments = relativePath.split("/");
  if (segments[0] !== "revisions") return relativePath;
  return segments.map((segment, index) => (index === 0 ? segment : hostSafeSegment(segment))).join("/");
}

/**
 * The journal revision a JSON route must name (DECISIONS 2026-09-04, B).
 *
 * The manifest used to expect every `.json` in the deploy tree to carry the
 * revision of the render that produced the manifest. That is false for a
 * carried-forward immutable route: it is immutable precisely because it still
 * belongs to the older revision spelled in its own path, so the probe reported
 * a red line for a deployment that was correct. The expectation therefore
 * comes from the route itself.
 *
 * Returns `null` when the route sits under `revisions/` in a spelling this
 * project does not produce. That is deliberate: the probe then fails that
 * route loudly rather than guessing an expectation, because an unrecognised
 * immutable route is exactly the case where a silent pass would be worst.
 */
export function expectedRevisionForJsonRoute(url, currentRevision) {
  const segments = url.split("/").filter(segment => segment.length > 0);
  if (segments[0] !== "revisions") return currentRevision;
  const segment = segments[1];
  if (segment === undefined) return null;
  if (segment === hostSafeSegment(currentRevision)) return currentRevision;
  // The only revision spelling this project produces is `sha256:<hex>`, whose
  // host-safe form replaces the single colon with a hyphen; that inverse is
  // exact for this shape and refuses every other.
  const match = /^sha256-([0-9a-f]+)$/u.exec(segment);
  return match === null ? null : `sha256:${match[1]}`;
}

/** The renderer's pin href (`revisions/<enc>/<kind>/index.html`) as a root-absolute directory URL (`/revisions/<safe>/<kind>/`). */
export function hostSafeHref(href) {
  const safe = hostSafeRelativePath(href);
  const withoutIndex = safe.endsWith("/index.html") ? safe.slice(0, -"index.html".length) : safe;
  return `/${withoutIndex}`;
}

/** Rewrites every `href="revisions/..."` of a rendered page to its host-safe root-absolute form; idempotent, touches nothing else. */
export function rewritePinHrefs(html) {
  return html.replace(PIN_HREF, (_match, href) => `href="${hostSafeHref(href)}"`);
}

/** The route paths a probe requests for one site-relative file (`index.html` -> `/`, `a/b/index.html` -> `/a/b/`). */
export function routeUrlPath(deployRelativePath) {
  if (deployRelativePath === "index.html") return "/";
  return `/${deployRelativePath.endsWith("/index.html") ? deployRelativePath.slice(0, -"index.html".length) : deployRelativePath}`;
}

function listFiles(root, directory = root, out = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) listFiles(root, absolute, out);
    else out.push(path.relative(root, absolute).split(path.sep).join("/"));
  }
  return out.sort();
}

/**
 * Derives the deploy tree from the site tree: safe route names, rewritten
 * pin hrefs on `.html` files, every other file copied byte-for-byte, plus a
 * `vercel.json` that pins the static framework and trailing-slash routes.
 * Written aside and swapped in, like the site build itself; an existing
 * `.vercel/` project link in the deploy directory is carried forward.
 */
export function deriveDeployTree(siteDir, deployDir, nonce) {
  const staging = `${deployDir}.staging-${nonce}`;
  const previous = `${deployDir}.previous-${nonce}`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  const written = [];
  try {
    // The Vercel project link (`vercel link` writes `.vercel/project.json` into
    // the deploy directory; the CLI never uploads that folder) survives a
    // re-render, so later snapshots deploy to the same project without relinking.
    const previousLink = path.join(deployDir, ".vercel");
    if (existsSync(previousLink)) cpSync(previousLink, path.join(staging, ".vercel"), { recursive: true });
    for (const relative of listFiles(siteDir)) {
      const safeRelative = hostSafeRelativePath(relative);
      const target = path.join(staging, ...safeRelative.split("/"));
      mkdirSync(path.dirname(target), { recursive: true });
      if (relative.endsWith(".html")) {
        writeFileSync(target, rewritePinHrefs(readFileSync(path.join(siteDir, relative), "utf8")), "utf8");
      } else {
        cpSync(path.join(siteDir, relative), target);
      }
      written.push({ site: relative, deploy: safeRelative, url: routeUrlPath(safeRelative) });
    }
    writeFileSync(path.join(staging, "vercel.json"), `${JSON.stringify({ framework: null, cleanUrls: false, trailingSlash: true }, null, 2)}\n`, "utf8");
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  rmSync(previous, { recursive: true, force: true });
  if (existsSync(deployDir)) renameSync(deployDir, previous);
  renameSync(staging, deployDir);
  rmSync(previous, { recursive: true, force: true });
  return written;
}

/** Refuses a journal that sits inside a live STATE_DIR: the script reads copies only. */
export function liveStateDirMarker(journalPath) {
  const directory = path.dirname(journalPath);
  for (const marker of LIVE_STATE_DIR_MARKERS) {
    if (existsSync(path.join(directory, marker))) return marker;
  }
  return null;
}

/** The complete lines of a journal copy (a copy taken mid-append may end in a partial line, exactly as the publisher tolerates). */
export function completeJournalText(raw) {
  const lastNewline = raw.lastIndexOf("\n");
  return raw.slice(0, lastNewline + 1);
}

function isoOrThrow(name, value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new Error(`${name} must be an ISO-8601 timestamp, got ${JSON.stringify(value)}`);
  return new Date(Date.parse(value)).toISOString();
}

function integerOrThrow(name, value) {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new Error(`config/policy.json ${name} must be an integer, got ${JSON.stringify(value)}`);
  return value;
}

/**
 * Renders the site from a journal copy. Options:
 *   repoRoot            the checkout whose `config/policy.json` and `assets/` are read (read-only)
 *   distDir             the BUILT modules (default `<repoRoot>/dist`); `src/` is never imported
 *   journalPath         a COPY of the journal (refused inside a live STATE_DIR)
 *   outDir              receives `site/`, `deploy/`, `publish-manifest.json`
 *   accountId           the submitted broker account id (the projection's expectation, not read from the journal)
 *   profile             "competition" (default) or "dev"
 *   presentationCutoff  optional ISO; pins the immutable presentation route
 *   deadlineCutoff      optional ISO; pins the immutable deadline route
 *   repositoryUrl       public source link (default the GitHub repository)
 *   journalRevisionUrl  optional link to the committed journal revision
 *   nowMs               the render clock (default Date.now())
 */
export async function renderSite(options) {
  const repoRoot = path.resolve(options.repoRoot);
  const distDir = path.resolve(options.distDir ?? path.join(repoRoot, "dist"));
  const journalPath = path.resolve(options.journalPath);
  const outDir = path.resolve(options.outDir);
  if (typeof options.accountId !== "string" || options.accountId.trim().length === 0) throw new Error("accountId is required: the submitted broker account id the page is expected to show");
  const profile = options.profile ?? "competition";
  if (profile !== "competition" && profile !== "dev") throw new Error(`profile must be "competition" or "dev", got ${JSON.stringify(profile)}`);
  const marker = liveStateDirMarker(journalPath);
  if (marker !== null) throw new Error(`refusing to read ${journalPath}: ${marker} sits beside it, so this is a live STATE_DIR, not a copy. Copy the journal elsewhere first.`);
  if (!existsSync(journalPath)) throw new Error(`journal copy not found: ${journalPath}`);
  for (const required of ["core/journal.js", "core/projection.js", "core/publish.js", "shell/publisher.js", "shell/dashboard-build.js"]) {
    if (!existsSync(path.join(distDir, required))) throw new Error(`built module missing: ${path.join(distDir, required)} — this script renders from dist/ and never builds; build in a separate worktree if dist/ is absent`);
  }
  const nowMs = options.nowMs ?? Date.now();
  const load = relative => import(pathToFileURL(path.join(distDir, relative)).href);
  const [journalModule, projectionModule, publishModule, publisherModule, buildModule] = await Promise.all([
    load("core/journal.js"), load("core/projection.js"), load("core/publish.js"), load("shell/publisher.js"), load("shell/dashboard-build.js"),
  ]);

  const policy = JSON.parse(readFileSync(path.join(repoRoot, "config", "policy.json"), "utf8"));
  const expectations = {
    initialCapitalCents: integerOrThrow("INITIAL_CAPITAL_CENTS", policy.INITIAL_CAPITAL_CENTS),
    expectedAccountId: options.accountId.trim(),
    flattenDate: String(policy.FLATTEN_DATE),
    profile,
    qualification: {
      checkpointMs: Date.parse(isoOrThrow("QUALIFYING_ACTIVITY_CHECKPOINT", policy.QUALIFYING_ACTIVITY_CHECKPOINT)),
      windowEndMs: Date.parse(isoOrThrow("QUALIFICATION_WINDOW_END", policy.QUALIFICATION_WINDOW_END)),
      maxLossCents: integerOrThrow("QUALIFICATION_MAX_LOSS_CENTS", policy.QUALIFICATION_MAX_LOSS_CENTS),
    },
  };
  const cycleIntervalMs = integerOrThrow("CYCLE_INTERVAL_MS", policy.CYCLE_INTERVAL_MS);
  const deadManBoundMs = integerOrThrow("DEAD_MAN_BOUND_MS", policy.DEAD_MAN_BOUND_MS);

  const text = completeJournalText(readFileSync(journalPath, "utf8"));
  if (text.length === 0) throw new Error(`journal copy ${journalPath} has no complete line; nothing to render`);
  const parsed = journalModule.parseJournalText(text);
  const entries = parsed.entries;
  if (entries.length === 0) throw new Error(`journal copy ${journalPath} parsed to zero entries`);
  const revision = publisherModule.journalContentRevision(text);

  const pins = [];
  if (options.presentationCutoff !== undefined && options.presentationCutoff !== null) pins.push({ kind: "presentation", at: isoOrThrow("presentationCutoff", options.presentationCutoff) });
  if (options.deadlineCutoff !== undefined && options.deadlineCutoff !== null) pins.push({ kind: "deadline", at: isoOrThrow("deadlineCutoff", options.deadlineCutoff) });

  const source = {
    repositoryUrl: options.repositoryUrl ?? "https://github.com/fradzano/glass-box-trading",
    journalRevisionUrl: options.journalRevisionUrl ?? null,
    corePath: "src/core/decision.ts",
    evidenceTestPath: "tests/cyc-runner.spec.ts (S-CYC-06)",
    evidenceDebtRow: "EVIDENCE-DEBT.md WIN-1: journal-only failure with open exposure → deterministic risk-reducing emergency close, explicit audit-gap reconciliation",
  };
  const styles = buildModule.readPresentationAsset(buildModule.DASHBOARD_STYLESHEET, path.join(repoRoot, "assets"));
  const { pages, latest } = publisherModule.sitePagesFor({ entries, revision, nowMs, expectations, cycleIntervalMs, deadManBoundMs, source, pins, pushState: publishModule.emptyPushState(), styles });

  const siteDir = path.join(outDir, "site");
  const deployDir = path.join(outDir, "deploy");
  mkdirSync(outDir, { recursive: true });
  const nonce = `${String(nowMs)}-${String(process.pid)}`;
  const build = buildModule.buildSiteAtomically(siteDir, pages, nonce);
  const files = deriveDeployTree(siteDir, deployDir, nonce);

  const routeFor = (kind, projection) => {
    const sitePath = kind === "latest-index" ? "index.html" : buildModule.immutableRoute(revision, kind);
    const deployPath = hostSafeRelativePath(sitePath);
    return { kind: kind === "latest-index" ? "latest" : kind, cutoffAt: projection.cutoff.at, sitePath, deployPath, url: routeUrlPath(deployPath), expectedMeta: publishModule.expectedMeta(publisherModule.expectationFor(projection)) };
  };
  const routes = [routeFor("latest-index", latest), routeFor("latest", latest)];
  for (const pin of pins) {
    const projection = projectionModule.projectPerformance(entries, revision, { at: pin.at, kind: pin.kind }, expectations);
    routes.push(routeFor(pin.kind, projection));
  }
  const manifest = {
    renderedAt: new Date(nowMs).toISOString(),
    journalPath,
    journalRevision: revision,
    entryCount: entries.length,
    lastSeq: latest.lastSeq,
    accountId: expectations.expectedAccountId,
    profile,
    latestCutoffAt: latest.cutoff.at,
    discrepancies: latest.discrepancies,
    siteDir,
    deployDir,
    build: { written: build.written, carriedForward: build.carriedForward, preservedImmutable: build.preservedImmutable },
    files,
    routes,
    // Each JSON route with the revision it must name: the current one for a
    // route this render wrote, its own older one for a carried-forward
    // immutable route, `null` for a spelling this project cannot produce.
    jsonRoutes: files.filter(file => file.deploy.endsWith(".json")).map(file => ({ url: file.url, expectedJournalRevision: expectedRevisionForJsonRoute(file.url, revision) })),
  };
  writeFileSync(path.join(outDir, "publish-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

function parseArgs(argv) {
  const options = {};
  const flags = new Map([
    ["--repo-root", "repoRoot"], ["--dist", "distDir"], ["--journal", "journalPath"], ["--out", "outDir"], ["--account-id", "accountId"],
    ["--profile", "profile"], ["--presentation-cutoff", "presentationCutoff"], ["--deadline-cutoff", "deadlineCutoff"],
    ["--repository-url", "repositoryUrl"], ["--journal-revision-url", "journalRevisionUrl"], ["--now", "now"],
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const key = flags.get(flag);
    const value = argv[index + 1];
    if (key === undefined || value === undefined) throw new Error(`unknown or valueless argument ${JSON.stringify(flag)}; flags: ${[...flags.keys()].join(", ")}`);
    options[key] = value;
  }
  if (options.now !== undefined) {
    options.nowMs = Date.parse(isoOrThrow("--now", options.now));
    delete options.now;
  }
  options.repoRoot ??= path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  for (const required of ["journalPath", "outDir", "accountId"]) {
    if (options[required] === undefined) throw new Error(`--${required === "journalPath" ? "journal" : required === "outDir" ? "out" : "account-id"} is required`);
  }
  return options;
}

const invokedAsScript = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  try {
    const manifest = await renderSite(parseArgs(process.argv.slice(2)));
    process.stdout.write(`Rendered ${String(manifest.build.written.length)} page(s) from ${String(manifest.entryCount)} journal entries (revision ${manifest.journalRevision}, last seq ${String(manifest.lastSeq)}, latest cutoff ${manifest.latestCutoffAt}, ${String(manifest.discrepancies.length)} discrepancies).\n`);
    process.stdout.write(`site:   ${manifest.siteDir}\ndeploy: ${manifest.deployDir}\nroutes: ${manifest.routes.map(route => `${route.kind} ${route.url}`).join(", ")}\nmanifest: ${path.join(path.dirname(manifest.siteDir), "publish-manifest.json")}\n`);
  } catch (error) {
    process.stderr.write(`render-site: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
