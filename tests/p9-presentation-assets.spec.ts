// P9 — presentation assets live in `assets/`, outside the S-ARM-01 runtime
// digest, and are inlined into the rendered page at render time. Three claims
// are tested here: the asset is inlined verbatim into the one `<style>` block
// (so a published page stays self-contained), a missing, unreadable or empty
// asset fails closed instead of yielding an unstyled page, and `assets/` is
// not matched by the digest's file enumeration — design work during
// competition operation cannot void the certificate.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decide } from "../src/core/decision.js";
import { parseJournalText } from "../src/core/journal.js";
import { emptyPushState } from "../src/core/publish.js";
import { P1_RECORDED_CANDIDATES, P1_RECORDED_SNAPSHOT, TEST_ONLY_P1_NOW, TEST_ONLY_P1_O5_CONFIG } from "../src/fixtures/p1-recorded-cycle.js";
import { GOLDEN_CYCLE_INTERVAL_MS, GOLDEN_DEAD_MAN_BOUND_MS, GOLDEN_SOURCE, TEST_ONLY_GOLDEN_EXPECTATIONS, TEST_ONLY_GOLDEN_NOW_MS } from "../src/fixtures/p6-golden.js";
import { DASHBOARD_STYLESHEET, DECISION_VIEW_STYLESHEET, presentationAssetsDir, readPresentationAsset } from "../src/shell/dashboard-build.js";
import { enumerateRuntimeFiles } from "../src/shell/digests.js";
import { journalContentRevision, sitePagesFor } from "../src/shell/publisher.js";
import { renderDecisionView } from "../src/shell/render-decision-view.js";

const REPO_ROOT = path.resolve(".");
const GOLDEN_JOURNAL = path.resolve("fixtures/golden-journal.jsonl");

/** The golden index page, rendered with whatever stylesheet text the shell supplies. */
function goldenIndexPage(styles: string): () => string {
  const text = readFileSync(GOLDEN_JOURNAL, "utf8");
  const { pages } = sitePagesFor({
    entries: parseJournalText(text).entries, revision: journalContentRevision(text), nowMs: TEST_ONLY_GOLDEN_NOW_MS,
    expectations: TEST_ONLY_GOLDEN_EXPECTATIONS, cycleIntervalMs: GOLDEN_CYCLE_INTERVAL_MS,
    deadManBoundMs: GOLDEN_DEAD_MAN_BOUND_MS, source: GOLDEN_SOURCE, pins: [], pushState: emptyPushState(), styles,
  });
  const page = pages.find(candidate => candidate.relativePath === "index.html");
  if (page === undefined) throw new Error("the site page set has no index.html");
  return page.render;
}

describe("P9 — presentation assets are read from assets/ and inlined", () => {
  it("resolves assets/ from the module's own location, not from the working directory", () => {
    expect(presentationAssetsDir).toBe(path.join(REPO_ROOT, "assets"));
    for (const name of [DASHBOARD_STYLESHEET, DECISION_VIEW_STYLESHEET]) {
      expect(readPresentationAsset(name)).toBe(readFileSync(path.join(REPO_ROOT, "assets", name), "utf8").replace(/\r\n/gu, "\n"));
    }
  });

  it("inlines the dashboard stylesheet verbatim into the page's one <style> block", () => {
    const styles = readPresentationAsset(DASHBOARD_STYLESHEET);
    const index = goldenIndexPage(styles)();
    expect(index).toContain(`<style>\n${styles}\n</style>`);
    expect(index).not.toContain("<link rel=\"stylesheet\""); // self-contained: no external stylesheet request
  });

  it("inlines the decision-view stylesheet verbatim", () => {
    const styles = readPresentationAsset(DECISION_VIEW_STYLESHEET);
    const html = renderDecisionView(decide(P1_RECORDED_SNAPSHOT, P1_RECORDED_CANDIDATES, TEST_ONLY_P1_O5_CONFIG, TEST_ONLY_P1_NOW), styles);
    expect(html).toContain(`<style>\n${styles}\n</style>`);
    expect(html).not.toContain("<link rel=\"stylesheet\"");
  });
});

describe("P9 — a missing, unreadable or empty presentation asset fails closed", () => {
  it("throws with the resolved path when the asset file does not exist", () => {
    expect(() => readPresentationAsset("no-such-stylesheet.css")).toThrow(/no-such-stylesheet\.css.*missing or unreadable.*refusing to render an unstyled page/su);
  });

  it("throws rather than returning whitespace for an empty asset file", () => {
    const probe = `.p9-empty-probe-${String(process.pid)}.css`;
    const file = path.join(presentationAssetsDir, probe);
    writeFileSync(file, "\n", "utf8");
    try {
      expect(() => readPresentationAsset(probe)).toThrow(/is empty; refusing to render an unstyled page/u);
    } finally {
      rmSync(file, { force: true });
    }
  });

  it("refuses to render an unstyled dashboard page even when the shell hands it blank text", () => {
    expect(goldenIndexPage("   \n")).toThrow(/refusing to render an unstyled page/u);
  });

  it("refuses to render an unstyled decision view", () => {
    const result = decide(P1_RECORDED_SNAPSHOT, P1_RECORDED_CANDIDATES, TEST_ONLY_P1_O5_CONFIG, TEST_ONLY_P1_NOW);
    expect(() => renderDecisionView(result, "")).toThrow(/refusing to render an unstyled page/u);
  });
});

describe("P9 — assets/ is outside the S-ARM-01 runtime digest", () => {
  it("the digest's file list contains no path under assets/", () => {
    expect(enumerateRuntimeFiles(REPO_ROOT).filter(file => file.path.startsWith("assets/"))).toEqual([]);
  });

  it("still binds the code that inlines them: the renderer and the asset reader are enumerated", () => {
    const enumerated = new Set(enumerateRuntimeFiles(REPO_ROOT).map(file => file.path));
    expect(enumerated.has("src/shell/render-dashboard.ts")).toBe(true);
    expect(enumerated.has("src/shell/dashboard-build.ts")).toBe(true);
  });
});
