// The digest-neutral publication path (submission/publish/render-site.mjs;
// DECISIONS.md 2026-09-02 "digest-neutral publication path"; R37 C-3):
// the script renders from the BUILT modules (the compiled scratch dist of
// global-setup, never src/), keeps the renderer's site tree byte-for-byte,
// and derives a deploy tree whose immutable routes are host-safe and whose
// history pin resolves from a nested route. It reads copies only.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, inject, it } from "vitest";
import { parseJournalText } from "../src/core/journal.js";
import { TEST_ONLY_GOLDEN_EXPECTATIONS, goldenPresentationCutoffAt } from "../src/fixtures/p6-golden.js";
import { readPageMeta } from "../src/shell/dashboard-build.js";
import { collidingDeployPaths, completeJournalText, expectedRevisionForJsonRoute, hostSafeHref, hostSafeRelativePath, hostSafeSegment, liveStateDirMarker, renderSite, rewritePinHrefs, routeUrlPath } from "../submission/publish/render-site.mjs";

const REPO_ROOT = path.resolve();
const GOLDEN_JOURNAL = path.join(REPO_ROOT, "fixtures", "golden-journal.jsonl");
const NOW_MS = Date.parse("2026-09-03T21:00:00.000Z");

const scratch: string[] = [];
afterEach(() => { for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function scratchDir(): string {
  const dir = path.join(tmpdir(), `gbt-publish-${String(process.pid)}-${String(scratch.length)}-${String(Date.now())}`);
  mkdirSync(dir, { recursive: true });
  scratch.push(dir);
  return dir;
}

/** A journal copy in a directory that carries no live STATE_DIR marker. */
function journalCopy(): string {
  const dir = scratchDir();
  const copy = path.join(dir, "journal-copy.jsonl");
  copyFileSync(GOLDEN_JOURNAL, copy);
  return copy;
}

function read(root: string, relative: string): string {
  return readFileSync(path.join(root, ...relative.split("/")), "utf8");
}

function goldenOptions(journalPath: string, outDir: string, nowMs: number = NOW_MS) {
  const entries = parseJournalText(readFileSync(GOLDEN_JOURNAL, "utf8")).entries;
  const presentationCutoff = goldenPresentationCutoffAt(entries);
  if (presentationCutoff === null) throw new Error("golden journal has no presentation cutoff");
  return { repoRoot: REPO_ROOT, distDir: inject("compiledDist"), journalPath, outDir, accountId: TEST_ONLY_GOLDEN_EXPECTATIONS.expectedAccountId ?? "", profile: "competition" as const, presentationCutoff, nowMs };
}

describe("R37 C-3 — host-safe immutable routes and root-absolute pin hrefs (pure)", () => {
  it("re-spells a percent-encoded revision segment in the safe alphabet and leaves non-revision paths alone", () => {
    expect(hostSafeSegment("sha256%3A0deeb1f42e01e19b")).toBe("sha256-0deeb1f42e01e19b");
    expect(hostSafeSegment("presentation")).toBe("presentation");
    expect(hostSafeSegment("%E2%80%A6")).toBe("-");
    expect(hostSafeSegment("%ZZ")).toBe("-ZZ");
    expect(hostSafeRelativePath("revisions/sha256%3Aabc/presentation/index.html")).toBe("revisions/sha256-abc/presentation/index.html");
    expect(hostSafeRelativePath("revisions/sha256%3Aabc/latest/projection.json")).toBe("revisions/sha256-abc/latest/projection.json");
    expect(hostSafeRelativePath("index.html")).toBe("index.html");
    expect(hostSafeRelativePath("data/projection.json")).toBe("data/projection.json");
  });

  it("turns the renderer's site-root-relative pin href into a root-absolute directory URL", () => {
    expect(hostSafeHref("revisions/sha256%3Aabc/presentation/index.html")).toBe("/revisions/sha256-abc/presentation/");
    expect(hostSafeHref("revisions/sha256%3Aabc/deadline/projection.json")).toBe("/revisions/sha256-abc/deadline/projection.json");
    expect(routeUrlPath("index.html")).toBe("/");
    expect(routeUrlPath("revisions/sha256-abc/latest/index.html")).toBe("/revisions/sha256-abc/latest/");
    expect(routeUrlPath("data/projection.json")).toBe("/data/projection.json");
  });

  it("rewrites only revision hrefs, keeps anchors and external links, and is idempotent", () => {
    const html = '<a href="#cycle-3">c</a><a href="revisions/sha256%3Aabc/presentation/index.html">pin</a><a href="https://github.com/x/y">repo</a><a href="revisions/sha256%3Aabc/latest/index.html">l</a>';
    const once = rewritePinHrefs(html);
    expect(once).toBe('<a href="#cycle-3">c</a><a href="/revisions/sha256-abc/presentation/">pin</a><a href="https://github.com/x/y">repo</a><a href="/revisions/sha256-abc/latest/">l</a>');
    expect(rewritePinHrefs(once)).toBe(once);
  });

  it("keeps only complete journal lines, as the publisher does", () => {
    expect(completeJournalText("a\nb\n")).toBe("a\nb\n");
    expect(completeJournalText("a\nb\npartial")).toBe("a\nb\n");
    expect(completeJournalText("partial")).toBe("");
  });
});

describe("render-site.mjs — renders from dist/, keeps the site tree verbatim, derives the deploy tree", () => {
  it("writes the renderer's encoded route under site/ and the safe root-absolute route under deploy/, with equal probe meta", async () => {
    const out = scratchDir();
    const manifest = await renderSite(goldenOptions(journalCopy(), out));
    const encoded = `revisions/${encodeURIComponent(manifest.journalRevision)}`;
    const safe = `revisions/${manifest.journalRevision.replace(":", "-")}`;

    // site/: the frozen renderer's own layout and hrefs, untouched
    expect(existsSync(path.join(out, "site", ...`${encoded}/presentation/index.html`.split("/")))).toBe(true);
    expect(read(path.join(out, "site"), "index.html")).toContain(`href="${encoded}/presentation/index.html"`);

    // deploy/: safe directory names, root-absolute pin on the root page AND on the nested page
    expect(existsSync(path.join(out, "deploy", ...`${safe}/presentation/index.html`.split("/")))).toBe(true);
    expect(existsSync(path.join(out, "deploy", ...`${encoded}/presentation/index.html`.split("/")))).toBe(false);
    const deployIndex = read(path.join(out, "deploy"), "index.html");
    const nestedLatest = read(path.join(out, "deploy"), `${safe}/latest/index.html`);
    expect(deployIndex).toContain(`href="/${safe}/presentation/"`);
    expect(nestedLatest).toContain(`href="/${safe}/presentation/"`);
    expect(nestedLatest).not.toContain('href="revisions/');
    expect(existsSync(path.join(out, "deploy", "vercel.json"))).toBe(true);

    // everything but the one href is the renderer's page
    expect(rewritePinHrefs(read(path.join(out, "site"), "index.html"))).toBe(deployIndex);

    // the manifest carries the meta an anonymous probe must find on each route
    expect(manifest.routes.map(route => [route.kind, route.url])).toEqual([["latest", "/"], ["latest", `/${safe}/latest/`], ["presentation", `/${safe}/presentation/`]]);
    for (const route of manifest.routes) {
      const page = read(path.join(out, "deploy"), route.deployPath);
      const meta = readPageMeta(page);
      for (const [name, value] of Object.entries(route.expectedMeta)) expect(meta[name], `${route.url} ${name}`).toBe(value);
    }
    expect(manifest.accountId).toBe(TEST_ONLY_GOLDEN_EXPECTATIONS.expectedAccountId);
    expect(deployIndex).toContain(manifest.accountId);
    expect(manifest.jsonRoutes).toEqual([
      { url: "/data/projection.json", expectedJournalRevision: manifest.journalRevision },
      { url: `/${safe}/presentation/projection.json`, expectedJournalRevision: manifest.journalRevision },
    ]);
    expect(JSON.parse(read(path.join(out, "deploy"), `${safe}/presentation/projection.json`)) as { journalRevision: string }).toMatchObject({ journalRevision: manifest.journalRevision });
  });

  it("carries the pinned route forward byte-for-byte through the derive step while the live page moves on", async () => {
    const out = scratchDir();
    const journal = journalCopy();
    const first = await renderSite(goldenOptions(journal, out));
    const safe = `revisions/${first.journalRevision.replace(":", "-")}`;
    const pinnedBefore = read(path.join(out, "deploy"), `${safe}/presentation/index.html`);
    const indexBefore = read(path.join(out, "deploy"), "index.html");
    const second = await renderSite(goldenOptions(journal, out, NOW_MS + 3_600_000));
    expect(second.build.carriedForward).toEqual(["revisions/"]);
    expect(second.build.preservedImmutable).toEqual(expect.arrayContaining([`revisions/${encodeURIComponent(first.journalRevision)}/presentation/index.html`]));
    expect(read(path.join(out, "deploy"), `${safe}/presentation/index.html`)).toBe(pinnedBefore);
    expect(read(path.join(out, "deploy"), "index.html")).not.toBe(indexBefore);
    expect(readPageMeta(read(path.join(out, "deploy"), "index.html"))["glass-box-rendered-at"]).toBe("2026-09-03T22:00:00.000Z");
  });

  it("expects a carried-forward JSON route to name its own revision, not the current one (DECISIONS 2026-09-04, B)", async () => {
    const out = scratchDir();
    const full = readFileSync(GOLDEN_JOURNAL, "utf8");
    const lines = full.trimEnd().split("\n");
    const shortJournal = path.join(scratchDir(), "journal-copy.jsonl");
    writeFileSync(shortJournal, `${lines.slice(0, -1).join("\n")}\n`, "utf8");

    const first = await renderSite(goldenOptions(shortJournal, out));
    const grownJournal = path.join(scratchDir(), "journal-copy.jsonl");
    writeFileSync(grownJournal, full, "utf8");
    const second = await renderSite(goldenOptions(grownJournal, out, NOW_MS + 60_000));
    expect(second.journalRevision).not.toBe(first.journalRevision);

    const safeOf = (revision: string): string => `revisions/${revision.replace(":", "-")}`;
    const byUrl = new Map(second.jsonRoutes.map((route: { url: string; expectedJournalRevision: string | null }) => [route.url, route.expectedJournalRevision]));

    // The route this render wrote, and the live one, expect the new revision.
    expect(byUrl.get("/data/projection.json")).toBe(second.journalRevision);
    expect(byUrl.get(`/${safeOf(second.journalRevision)}/presentation/projection.json`)).toBe(second.journalRevision);

    // The carried-forward route is immutable and still belongs to the first
    // revision: expecting the current one is what produced the red line.
    const carried = `/${safeOf(first.journalRevision)}/presentation/projection.json`;
    expect(byUrl.has(carried)).toBe(true);
    expect(byUrl.get(carried)).toBe(first.journalRevision);
    expect(JSON.parse(read(path.join(out, "deploy"), carried.replace(/^\//u, ""))) as { journalRevision: string }).toMatchObject({ journalRevision: first.journalRevision });

    // Every expectation the manifest states is met by the bytes on disk.
    for (const [url, expected] of byUrl) {
      const served = JSON.parse(read(path.join(out, "deploy"), url === "/" ? "index.html" : url.replace(/^\//u, ""))) as { journalRevision: string };
      expect(served.journalRevision, url).toBe(expected);
    }
  });

  it("derives a JSON route's expected revision from the route, and refuses to guess an unknown immutable spelling", () => {
    const current = "sha256:78af85c1c238a49d";
    expect(expectedRevisionForJsonRoute("/data/projection.json", current)).toBe(current);
    expect(expectedRevisionForJsonRoute("/revisions/sha256-78af85c1c238a49d/latest/projection.json", current)).toBe(current);
    expect(expectedRevisionForJsonRoute("/revisions/sha256-7b82959a344a7c7e/presentation/projection.json", current)).toBe("sha256:7b82959a344a7c7e");
    // No expectation is better than a wrong one: the probe fails these loudly.
    expect(expectedRevisionForJsonRoute("/revisions/", current)).toBeNull();
    expect(expectedRevisionForJsonRoute("/revisions/md5-abc/presentation/projection.json", current)).toBeNull();
    expect(expectedRevisionForJsonRoute("/revisions/sha256-NOTHEX/presentation/projection.json", current)).toBeNull();
  });

  it("R41-B3: only the canonical sixteen-hex spelling is accepted, so a foreign route cannot vouch for itself", () => {
    const current = "sha256:78af85c1c238a49d";
    // The publisher takes exactly 16 hex characters (src/shell/publisher.ts).
    // A shorter or longer directory is not a route this renderer wrote, and
    // accepting it let it declare its own revision and pass the probe.
    expect(expectedRevisionForJsonRoute("/revisions/sha256-abcdef/presentation/projection.json", current)).toBeNull();
    expect(expectedRevisionForJsonRoute("/revisions/sha256-78af85c1c238a49dd/presentation/projection.json", current)).toBeNull();
    expect(expectedRevisionForJsonRoute("/revisions/sha256-78AF85C1C238A49D/presentation/projection.json", current)).toBeNull();
    // A current revision that is itself not canonical yields no expectation
    // either, rather than being echoed back as if it were trustworthy.
    expect(expectedRevisionForJsonRoute("/revisions/sha256-78af85c1c238a49d/latest/projection.json", "sha256-78af85c1c238a49d")).toBeNull();
  });

  it("R41-B3: two source spellings that collide on one deployed path are refused, not published", () => {
    // hostSafeSegment maps a colon and a literal hyphen to the same character,
    // so these two distinct revisions would land in one immutable directory
    // and the path would stop identifying its content.
    const collisions = collidingDeployPaths([
      "index.html",
      "revisions/sha256%3A0123456789abcdef/latest/index.html",
      "revisions/sha256-0123456789abcdef/latest/index.html",
    ]);
    expect(collisions).toHaveLength(1);
    expect(collisions[0]?.deployPath).toBe("revisions/sha256-0123456789abcdef/latest/index.html");
    expect(collisions[0]?.sources).toHaveLength(2);
    // The ordinary tree has none.
    expect(collidingDeployPaths(["index.html", "data/projection.json", "revisions/sha256%3A0123456789abcdef/latest/index.html"])).toEqual([]);
  });

  it("R41-B3: a render whose site tree carries such a collision throws instead of deploying", async () => {
    const out = scratchDir();
    const manifest = await renderSite(goldenOptions(journalCopy(), out));
    const safe = `revisions/${manifest.journalRevision.replace(":", "-")}`;
    // Plant the colliding spelling beside the renderer's own encoded one.
    const planted = path.join(out, "site", ...`${safe}/presentation`.split("/"));
    mkdirSync(planted, { recursive: true });
    writeFileSync(path.join(planted, "index.html"), "<!doctype html><title>foreign</title>", "utf8");
    await expect(renderSite(goldenOptions(journalCopy(), out, NOW_MS + 60_000))).rejects.toThrow(/host-safe deploy paths collide/u);
  });

  it("carries the Vercel project link (.vercel/) in the deploy directory forward through a re-render", async () => {
    const out = scratchDir();
    const journal = journalCopy();
    await renderSite(goldenOptions(journal, out));
    mkdirSync(path.join(out, "deploy", ".vercel"), { recursive: true });
    writeFileSync(path.join(out, "deploy", ".vercel", "project.json"), '{"projectId":"prj_test","orgId":"team_test"}', "utf8");
    await renderSite(goldenOptions(journal, out, NOW_MS + 60_000));
    expect(read(path.join(out, "deploy"), ".vercel/project.json")).toBe('{"projectId":"prj_test","orgId":"team_test"}');
    expect(existsSync(path.join(out, "site", ".vercel"))).toBe(false);
  });

  it("tolerates a copy taken mid-append (partial last line) without changing the revision", async () => {
    const journal = journalCopy();
    const complete = await renderSite(goldenOptions(journal, scratchDir()));
    writeFileSync(journal, `${readFileSync(journal, "utf8")}{"seq":999,"partial":`, "utf8");
    const partial = await renderSite(goldenOptions(journal, scratchDir()));
    expect(partial.journalRevision).toBe(complete.journalRevision);
    expect(partial.lastSeq).toBe(complete.lastSeq);
  });

  it("refuses a journal that sits in a live STATE_DIR, a missing account id, and an unbuilt dist", async () => {
    const dir = scratchDir();
    const journal = path.join(dir, "journal.jsonl");
    copyFileSync(GOLDEN_JOURNAL, journal);
    writeFileSync(path.join(dir, "epoch.json"), "{}", "utf8");
    expect(liveStateDirMarker(journal)).toBe("epoch.json");
    await expect(renderSite(goldenOptions(journal, scratchDir()))).rejects.toThrow(/live STATE_DIR/u);
    await expect(renderSite({ ...goldenOptions(journalCopy(), scratchDir()), accountId: " " })).rejects.toThrow(/accountId is required/u);
    await expect(renderSite({ ...goldenOptions(journalCopy(), scratchDir()), distDir: scratchDir() })).rejects.toThrow(/built module missing/u);
  });
});
