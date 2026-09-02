// Atomic site build (S-J-07, UNF-2): render aside, then swap. Pages are
// written into a staging directory next to the output; only when every page
// is on disk is the previous output renamed away and the staging directory
// renamed into place. A render or write that throws leaves the previous page
// fully intact. Immutable routes (`revisions/<revision>/<kind>/`) are carried
// forward from the previous output byte-for-byte and are never overwritten:
// the presentation-cutoff route a video names stays addressable after later
// snapshots.
//
// This module is also the one place the shell reads presentation assets from
// `assets/` (P9): the stylesheets are inlined into the rendered page, so a
// published page stays one self-contained HTML file, while the asset bytes
// themselves sit outside the S-ARM-01 runtime digest (src/shell/digests.ts) —
// design work during competition operation cannot void the certificate.
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface SitePage {
  /** Path relative to the site root, forward slashes (`index.html`, `revisions/<rev>/presentation/index.html`). */
  readonly relativePath: string;
  /** Rendered lazily so an interrupted render is observable as an exception mid-build. */
  readonly render: () => string;
}

export interface BuildSink {
  writeFile(absolutePath: string, content: string): void;
}

export interface BuildReport {
  readonly outDir: string;
  readonly written: readonly string[];
  readonly carriedForward: readonly string[];
  /** Pinned routes that already existed and were therefore not overwritten. */
  readonly preservedImmutable: readonly string[];
}

/** The dashboard stylesheet, relative to `assets/`. */
export const DASHBOARD_STYLESHEET = "dashboard.css";
/** The P1 decision-view stylesheet, relative to `assets/`. */
export const DECISION_VIEW_STYLESHEET = "decision-view.css";

/**
 * `<repo>/assets`, resolved from this module's own location — never from
 * `process.cwd()`, so a scheduled task, a test, and `npm run dashboard` all
 * read the same bytes. `src/shell/` (vitest, in-process) and `dist/shell/`
 * (the compiled entry points) are both two levels below the repository root.
 */
export const presentationAssetsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "assets");

/**
 * Reads one presentation asset as text, LF-normalized so a checkout's line
 * endings cannot change the rendered bytes. Fails closed: a missing or
 * unreadable asset throws instead of yielding an unstyled page. Inside a site
 * build the throw surfaces as a build failure, and the previous published
 * page is left fully intact.
 */
export function readPresentationAsset(name: string): string {
  const file = path.join(presentationAssetsDir, name);
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(`presentation asset "${name}" is missing or unreadable at ${file} (${error instanceof Error ? error.message : String(error)}); refusing to render an unstyled page`, { cause: error });
  }
  const text = raw.replace(/\r\n/gu, "\n");
  if (text.trim().length === 0) throw new Error(`presentation asset "${name}" at ${file} is empty; refusing to render an unstyled page`);
  return text;
}

export function immutableRoute(journalRevision: string, cutoffKind: string): string {
  return `revisions/${encodeURIComponent(journalRevision)}/${encodeURIComponent(cutoffKind)}/index.html`;
}

export function nodeBuildSink(): BuildSink {
  return { writeFile: (absolutePath, content) => { writeFileSync(absolutePath, content, "utf8"); } };
}

function isImmutableRoute(relativePath: string): boolean {
  return relativePath.startsWith("revisions/");
}

/**
 * Builds the site atomically. `nonce` names the staging directory (the shell
 * passes a clock value or process id; the build itself needs no clock).
 */
export function buildSiteAtomically(outDir: string, pages: readonly SitePage[], nonce: string, sink: BuildSink = nodeBuildSink()): BuildReport {
  const staging = `${outDir}.staging-${nonce}`;
  const previous = `${outDir}.previous-${nonce}`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  const carriedForward: string[] = [];
  const preservedImmutable: string[] = [];
  const written: string[] = [];
  try {
    const previousRevisions = path.join(outDir, "revisions");
    if (existsSync(previousRevisions)) {
      cpSync(previousRevisions, path.join(staging, "revisions"), { recursive: true });
      carriedForward.push("revisions/");
    }
    for (const page of pages) {
      const target = path.join(staging, ...page.relativePath.split("/"));
      if (isImmutableRoute(page.relativePath) && existsSync(target)) {
        preservedImmutable.push(page.relativePath);
        continue;
      }
      const content = page.render();
      mkdirSync(path.dirname(target), { recursive: true });
      sink.writeFile(target, content);
      written.push(page.relativePath);
    }
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  rmSync(previous, { recursive: true, force: true });
  if (existsSync(outDir)) renameSync(outDir, previous);
  renameSync(staging, outDir);
  rmSync(previous, { recursive: true, force: true });
  return { outDir, written, carriedForward, preservedImmutable };
}

/** Reads one built page, or null when the route does not exist. */
export function readBuiltPage(outDir: string, relativePath: string): string | null {
  const target = path.join(outDir, ...relativePath.split("/"));
  return existsSync(target) ? readFileSync(target, "utf8") : null;
}

/** The `glass-box-*` meta tags of a rendered page, as an anonymous probe would read them. */
export function readPageMeta(html: string): Readonly<Record<string, string>> {
  const meta: Record<string, string> = {};
  const pattern = /<meta name="(glass-box-[a-z-]+)" content="([^"]*)">/gu;
  for (const match of html.matchAll(pattern)) {
    const name = match[1];
    const content = match[2];
    if (name !== undefined && content !== undefined) meta[name] = content.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'");
  }
  return meta;
}
