// P9 / R33 (B1) — the presentation stylesheets in `assets/` sit outside the
// S-ARM-01 runtime digest and are inlined verbatim into the published page
// (src/shell/dashboard-build.ts, renderDashboard, renderDecisionView). The
// gate's executed counter-example: appending
// `.gate--veto,.stamp--veto,.discrepancies,.result--no_trade{display:none}`
// to assets/dashboard.css hides every gate veto, no-trade result and
// reconciliation discrepancy on the published page while `runtimeDigest`
// stays byte-identical and every test stays green. This file exercises the
// countermeasure — `auditPresentationStylesheet`
// (src/shell/presentation-guard.ts) — and its wiring into both renderers.
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { decide } from "../src/core/decision.js";
import { parseJournalText } from "../src/core/journal.js";
import { emptyPushState } from "../src/core/publish.js";
import type { GitPort, PublishDependencies } from "../src/shell/publisher.js";
import { P1_RECORDED_CANDIDATES, P1_RECORDED_SNAPSHOT, TEST_ONLY_P1_NOW, TEST_ONLY_P1_O5_CONFIG } from "../src/fixtures/p1-recorded-cycle.js";
import { GOLDEN_CYCLE_INTERVAL_MS, GOLDEN_DEAD_MAN_BOUND_MS, GOLDEN_SOURCE, TEST_ONLY_GOLDEN_EXPECTATIONS, TEST_ONLY_GOLDEN_NOW_MS } from "../src/fixtures/p6-golden.js";
import { DASHBOARD_STYLESHEET, DECISION_VIEW_STYLESHEET, presentationAssetsDir, readBuiltPage, readPresentationAsset } from "../src/shell/dashboard-build.js";
import { auditPresentationStylesheet } from "../src/shell/presentation-guard.js";
import { journalContentRevision, runPublish, sitePagesFor } from "../src/shell/publisher.js";
import { renderDecisionView } from "../src/shell/render-decision-view.js";
import { cleanupLifecycleDirs, lifecycleHarness } from "./lifecycle-fixtures.js";
import type { LifecycleHarness } from "./lifecycle-fixtures.js";
import { TEST_ONLY_ACCOUNT_ID } from "./journal-fixtures.js";

const GOLDEN_JOURNAL = path.resolve("fixtures/golden-journal.jsonl");

/** The R33 gate's executed counter-example, verbatim. */
const POISON_LINE = ".gate--veto,.stamp--veto,.discrepancies,.result--no_trade{display:none}";

/** The golden index page, rendered with whatever stylesheet text the shell supplies (same shape as tests/p9-presentation-assets.spec.ts). */
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

describe("P9/R33 — auditPresentationStylesheet: the gate's exact counter-example", () => {
  it("refuses renderDashboard when the committed stylesheet gains the veto/discrepancy hiding rule", () => {
    const styles = `${readPresentationAsset(DASHBOARD_STYLESHEET)}\n${POISON_LINE}`;
    expect(goldenIndexPage(styles)).toThrow(/stylesheet refused/u);
    expect(goldenIndexPage(styles)).toThrow(/display: none/u);
  });

  it("refuses renderDecisionView when the committed stylesheet gains the same hiding rule", () => {
    const styles = `${readPresentationAsset(DECISION_VIEW_STYLESHEET)}\n${POISON_LINE}`;
    const result = decide(P1_RECORDED_SNAPSHOT, P1_RECORDED_CANDIDATES, TEST_ONLY_P1_O5_CONFIG, TEST_ONLY_P1_NOW);
    expect(() => renderDecisionView(result, styles)).toThrow(/stylesheet refused/u);
    expect(() => renderDecisionView(result, styles)).toThrow(/display: none/u);
  });
});

describe("P9/R33 — auditPresentationStylesheet: one unit test per rule family", () => {
  it("refuses a forbidden property regardless of its value", () => {
    const reasons = auditPresentationStylesheet(".x{visibility:hidden}");
    expect(reasons).toEqual([expect.stringContaining("visibility")]);
  });

  it("refuses display: none", () => {
    const reasons = auditPresentationStylesheet(".x{display:none}");
    expect(reasons).toEqual([expect.stringContaining("display")]);
  });

  it("refuses display: contents", () => {
    const reasons = auditPresentationStylesheet(".x{display:contents}");
    expect(reasons).toEqual([expect.stringContaining("display")]);
  });

  it("allows overflow-x: auto (the tables use it) but refuses overflow-x: hidden", () => {
    expect(auditPresentationStylesheet(".t{overflow-x:auto}")).toEqual([]);
    const reasons = auditPresentationStylesheet(".t{overflow-x:hidden}");
    expect(reasons).toEqual([expect.stringContaining("overflow-x")]);
  });

  it("refuses overflow: clip", () => {
    const reasons = auditPresentationStylesheet(".t{overflow:clip}");
    expect(reasons).toEqual([expect.stringContaining("overflow")]);
  });

  it("refuses position: absolute and position: fixed", () => {
    expect(auditPresentationStylesheet(".p{position:absolute}")).toEqual([expect.stringContaining("position")]);
    expect(auditPresentationStylesheet(".p{position:fixed}")).toEqual([expect.stringContaining("position")]);
  });

  it("refuses a zero font-size in any unit", () => {
    for (const value of ["0", "0px", "0rem", "0%"]) {
      const reasons = auditPresentationStylesheet(`.z{font-size:${value}}`);
      expect(reasons, `font-size:${value}`).toEqual([expect.stringContaining("font-size")]);
    }
  });

  it("refuses a negative margin length", () => {
    const reasons = auditPresentationStylesheet(".m{margin:-4px}");
    expect(reasons).toEqual([expect.stringContaining("margin")]);
  });

  it("refuses a negative left/inset length", () => {
    expect(auditPresentationStylesheet(".m{left:-1rem}")).toEqual([expect.stringContaining("left")]);
    expect(auditPresentationStylesheet(".m{inset:-1px}")).toEqual([expect.stringContaining("inset")]);
  });

  it("refuses the transparent keyword on color/background", () => {
    const reasons = auditPresentationStylesheet(".c{color:transparent}");
    expect(reasons).toEqual([expect.stringContaining("color")]);
  });

  it("refuses an rgba() with zero alpha on color/background", () => {
    const reasons = auditPresentationStylesheet(".c{background:rgba(0,0,0,0)}");
    expect(reasons).toEqual([expect.stringContaining("background")]);
  });

  it("allows an rgba() with non-zero alpha", () => {
    expect(auditPresentationStylesheet(".c{background:rgba(0,0,0,.08)}")).toEqual([]);
  });

  it("refuses @import anywhere in the text", () => {
    const reasons = auditPresentationStylesheet("@import url(\"evil.css\");\n.x{color:red}");
    expect(reasons.some(reason => reason.includes("@import"))).toBe(true);
  });

  it("refuses url( anywhere in the text", () => {
    const reasons = auditPresentationStylesheet(".x{background:url(evil.png)}");
    expect(reasons.some(reason => reason.includes("url("))).toBe(true);
  });

  it("walks declarations nested inside @media blocks", () => {
    const reasons = auditPresentationStylesheet("@media(max-width:600px){.x{display:none}}");
    expect(reasons).toEqual([expect.stringContaining("display")]);
  });
});

describe("P9/R33 — comments are stripped before the audit runs", () => {
  it("ignores a forbidden declaration written only inside a comment", () => {
    expect(auditPresentationStylesheet(".x{ /* display: none */ color: red }")).toEqual([]);
  });
});

describe("P9/R33 — the committed stylesheets against the audit", () => {
  // KNOWN FINDING (undecided as of this commit): assets/dashboard.css line 2
  // sets `body{...overflow-x:hidden}`, unrelated to the R33 hiding pattern
  // (page-level horizontal-scrollbar suppression, not a per-element hide),
  // but it trips the same literal rule that blocks the exploit
  // (`overflow-x`/`overflow-y` must not be `hidden` or `clip`) because that
  // rule cannot distinguish "hides one element's overflow" from "no
  // scrollbar on the page" — and loosening it to allow axis-scoped `hidden`
  // would reopen a real hiding vector (a fixed-width/height wrapper around
  // e.g. `.discrepancies` with `overflow:hidden` truncates its content
  // without tripping the zero-size rule). See the session report for the
  // options; this assertion is left red on purpose rather than silently
  // loosening the rule or editing the shipped stylesheet without approval.
  it("assets/decision-view.css audits to an empty list", () => {
    expect(auditPresentationStylesheet(readPresentationAsset(DECISION_VIEW_STYLESHEET))).toEqual([]);
  });

  it("assets/dashboard.css audits to an empty list", () => {
    expect(auditPresentationStylesheet(readPresentationAsset(DASHBOARD_STYLESHEET))).toEqual([]);
  });
});

const SOURCE = { repositoryUrl: "https://example.invalid/glass-box-trading", journalRevisionUrl: null, corePath: "src/core/decision.ts", evidenceTestPath: "tests/cyc-runner.spec.ts", evidenceDebtRow: "WIN-1" };

function fakeGit(): GitPort {
  return { commitJournal: (text: string) => Promise.resolve(journalContentRevision(text)), push: () => Promise.resolve() };
}

function publishDeps(harness: LifecycleHarness): PublishDependencies {
  return {
    paths: harness.paths, git: fakeGit(), deploy: null, configuredJournalRef: "journal", requestedRef: "journal",
    clock: () => harness.clock.now, siteDir: path.join(harness.paths.root, "site"),
    expectations: { initialCapitalCents: 10_000_000, expectedAccountId: TEST_ONLY_ACCOUNT_ID, flattenDate: "2026-09-03", profile: "dev", qualification: null },
    cycleIntervalMs: 900_000, deadManBoundMs: 3_000_000, source: SOURCE, pins: [], gateway: { gateway: harness.gateway, epoch: 1 },
  };
}

describe("P9/R33 — a publish whose stylesheet hides content fails closed and leaves the previous page standing", () => {
  afterEach(() => { cleanupLifecycleDirs(); });

  // Modeled on the R33 reviewer probe (swaps assets/dashboard.css on disk,
  // like the earlier "a missing presentation asset fails publication
  // closed" probe already committed as p9-presentation-assets coverage).
  // `presentationAssetsDir` resolves from this module's own location
  // (src/shell/dashboard-build.ts), not from an injectable field on
  // PublishDependencies, so the only way to exercise runPublish against a
  // poisoned stylesheet is to poison the file on disk and restore it after.
  //
  // KNOWN FINDING: the "first publish succeeds" precondition below renders
  // the real, committed assets/dashboard.css through the now-guarded
  // renderDashboard, which currently refuses it for the same reason noted
  // above (`overflow-x: hidden` on `body`) — independent of any poisoning.
  // This test is therefore red today for the same single, disclosed cause,
  // not because the fail-closed behavior being tested is broken.
  it("first publish builds; with the veto/discrepancy hiding rule appended the next publish reports DASHBOARD_BUILD_FAILED and the previous page stands", async () => {
    const harness = await lifecycleHarness({});
    await harness.cycle();
    const deps = publishDeps(harness);
    const first = await runPublish(deps);
    expect(first.build).not.toBeNull();
    const standing = readBuiltPage(deps.siteDir, "index.html");
    expect(standing).not.toBeNull();

    const asset = path.join(presentationAssetsDir, DASHBOARD_STYLESHEET);
    const parked = `${asset}.parked-p9-guard-probe`;
    renameSync(asset, parked);
    writeFileSync(asset, `${readFileSync(parked, "utf8")}\n${POISON_LINE}`, "utf8");
    try {
      const second = await runPublish(deps);
      expect(second.alarms).toContain("DASHBOARD_BUILD_FAILED");
      expect(second.build).toBeNull();
      expect(second.buildError).toMatch(/display: none/u);
      expect(readBuiltPage(deps.siteDir, "index.html")).toBe(standing);
    } finally {
      rmSync(asset, { force: true });
      renameSync(parked, asset);
    }
  });
});

describe("P9/R33 — cleanup guard", () => {
  it("no probe leaves a parked stylesheet behind", () => {
    expect(existsSync(path.join(presentationAssetsDir, `${DASHBOARD_STYLESHEET}.parked-p9-guard-probe`))).toBe(false);
  });
});

describe("P9/R33 — adjacent hiding techniques and legitimate layout, table-driven", () => {
  const cases: ReadonlyArray<readonly [css: string, refusals: number, why: string]> = [
    [".x{display:none !important}", 1, "!important changes priority, not meaning"],
    [".x{DISPLAY : NONE}", 1, "case and whitespace do not hide a keyword"],
    [":root{--ink:transparent}.x{color:var(--ink)}", 1, "a custom property carrying transparent is refused at its definition"],
    [":root{--d:none}", 1, "a custom property carrying a hiding keyword is refused"],
    [".x{display:var(--d,none)}", 1, "a var() fallback is audited too"],
    [".x{width:min(0px,100%)}", 1, "a zero length inside min() collapses the box"],
    [".x{margin-left:calc(0px - 9999px)}", 1, "a subtraction inside calc() on an offset is refused"],
    ["h1{letter-spacing:-1em}", 1, "tracking at -1em collapses glyphs"],
    ["h1{letter-spacing:-.05em}", 0, "tight heading tracking is typography"],
    [".x{color:rgb(0 0 0 / 0)}", 1, "slash-syntax zero alpha"],
    [".x{color:#0000}", 1, "4-digit hex with zero alpha"],
    [".x{background:#ffffff00}", 1, "8-digit hex with zero alpha"],
    [".x{background:transparent none}", 1, "transparent inside a shorthand"],
    [".x{-webkit-text-fill-color:transparent}", 1, "vendor colour properties are colour properties"],
    [".x{color:color-mix(in srgb, red, transparent)}", 1, "color-mix can reach zero alpha"],
    [".x{scale:0}", 1, "the individual transform properties are forbidden"],
    [".x{content-visibility:hidden}", 1, "content-visibility skips rendering"],
    [String.raw`.x{display:\6e one}`, 1, "a CSS escape spells none to the browser"],
    [".x{height:0;overflow:hidden}", 2, "the classic collapse pair"],
    [".x{position:absolute;left:-9999px}", 2, "the classic off-canvas pair"],
    [".x{transform:scale(0)}", 1, "transform is forbidden outright"],
    [".x{clip-path:inset(100%)}", 1, "clip-path is forbidden outright"],
    [".x{color:#000} /* a */ .y{display:none} /* b */", 1, "a later comment does not shadow a later declaration"],
    [".x{font-size:clamp(40px,7vw,88px)}", 0, "responsive type is layout"],
    [".x{width:min(1480px,calc(100% - 48px))}", 0, "responsive width is layout"],
    [".x{overflow-x:auto}", 0, "scrolling tables are layout"],
    [".x{border:none;list-style:none}", 0, "none on non-display properties is decoration"],
    [".x{display:grid;gap:1rem;margin:0 auto}", 0, "ordinary grid layout"],
  ];
  for (const [css, refusals, why] of cases) {
    it(`${refusals === 0 ? "allows" : "refuses"} ${JSON.stringify(css)} — ${why}`, () => {
      expect(auditPresentationStylesheet(css), JSON.stringify(auditPresentationStylesheet(css))).toHaveLength(refusals);
    });
  }
});
