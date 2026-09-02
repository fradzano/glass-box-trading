// The deterministic golden path (SUBMISSION-SPEC §3, SUB-02, S-J-07/S-J-09,
// S-CYC-12): a real run of the cycle runner over the fake broker on the
// competition profile — one vetoed and one approved candidate, the fill, a
// no-trade cycle, the FLATTEN_DATE deadline close, the deadline
// reconciliation and the terminal entry — is recorded as
// fixtures/golden-journal.jsonl. The recorded journal must be reproduced
// byte-for-byte by the same run (determinism), and the site built from it
// must carry the six-step golden path as an anchor chain that resolves
// without a market being open or a new trade occurring. Set
// GBT_UPDATE_GOLDEN=1 to re-record after an intentional change.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { integerUnit } from "../src/core/domain.js";
import { parseJournalText } from "../src/core/journal.js";
import { emptyPushState } from "../src/core/publish.js";
import { GOLDEN_CYCLE_INTERVAL_MS, GOLDEN_DEAD_MAN_BOUND_MS, GOLDEN_SOURCE, TEST_ONLY_GOLDEN_EXPECTATIONS, TEST_ONLY_GOLDEN_NOW_MS, TEST_ONLY_GOLDEN_QUALIFICATION, goldenPresentationCutoffAt } from "../src/fixtures/p6-golden.js";
import { DASHBOARD_STYLESHEET, buildSiteAtomically, immutableRoute, readBuiltPage, readPageMeta, readPresentationAsset } from "../src/shell/dashboard-build.js";
import { runDeadlineReconciliation, runTerminal } from "../src/shell/deadline.js";
import { journalContentRevision, sitePagesFor } from "../src/shell/publisher.js";
import { LONG_CALL, SHORT_CALL, creditVertical } from "./execution-fixtures.js";
import { cleanupLifecycleDirs, defaultLifecycleDeps, lifecycleCalendar, lifecycleHarness, lifecycleMarket } from "./lifecycle-fixtures.js";

const GOLDEN_PATH = path.resolve("fixtures/golden-journal.jsonl");

afterEach(() => { cleanupLifecycleDirs(); });

/** The recorded run. Every input is deterministic: the harness clock, the fake broker, the fixture candidates. */
async function recordGoldenJournal(): Promise<string> {
  const vetoed = creditVertical({ candidateId: "candidate-declared-condor", declaredStructureType: "iron_condor", rationale: "SPY iron_condor declared over two legs — a structure/leg mismatch the gates must refuse." });
  const harness = await lifecycleHarness({
    profile: "competition",
    lifecycle: defaultLifecycleDeps({ qualification: TEST_ONLY_GOLDEN_QUALIFICATION }),
    analyst: () => Promise.resolve(JSON.stringify({ candidates: [creditVertical(), vetoed] })),
  });
  harness.clock.now = TEST_ONLY_GOLDEN_NOW_MS;
  const moved = (delta: number) => lifecycleMarket(() => harness.clock.now, { quotes: {
    [SHORT_CALL]: { bidCents: 300 + delta, askCents: 302 + delta, bidSize: 20 + delta, askSize: 20, quotedAtMs: harness.clock.now, brokerQuotedAt: "2026-08-31T13:30:59.871234567Z" },
    [LONG_CALL]: { bidCents: 100 + delta, askCents: 102 + delta, bidSize: 20 + delta, askSize: 20, quotedAtMs: harness.clock.now, brokerQuotedAt: "2026-08-31T13:30:59.871234567Z" },
  } });
  // 1. One vetoed and one approved candidate; the approved credit vertical fills.
  const first = await harness.cycle();
  expect(first.actions).toMatchObject([{ result: "SUBMITTED", status: "filled" }]);
  // The fake broker does not mark equity; the recorder sets what a real paper account would show: the credit received
  // (+198 x 100) against the structure marked at the moved tape (-200 x 100), so the fold reconciles to the cent.
  harness.fake.setEquity(9_999_800);
  // 2. A no-trade cycle after the checkpoint: the state is QUALIFIED by the ordinary fill, so no alarm.
  harness.clock.now += GOLDEN_CYCLE_INTERVAL_MS;
  const second = await harness.cycle({ analyst: () => Promise.resolve("{\"candidates\":[]}"), market: moved(1) });
  expect(second.alarmConditions).toEqual([]);
  // 3. FLATTEN_DATE: the deadline close of the whole structure, filled at the broker.
  harness.clock.now += GOLDEN_CYCLE_INTERVAL_MS;
  const third = await harness.cycle({ tradingDay: "2026-09-03", lifecycle: defaultLifecycleDeps({ qualification: TEST_ONLY_GOLDEN_QUALIFICATION, nextTradingDay: "2026-09-04", finalCycleOfSession: true }), market: moved(2) });
  expect(third.managementCloses).toMatchObject([{ route: "deadline" }]);
  expect(third.alarmConditions).toEqual([]);
  // 4. Friday: the deadline reconciliation naming the submitted revision, then the terminal entry.
  const deadlineDeps = { gateway: harness.gateway, epoch: 1, broker: harness.fake.read, market: moved(3), clock: () => harness.clock.now, profile: "competition" as const, calendar: lifecycleCalendar(harness.clock.now), tradingDay: "2026-09-04", cycleIndex: 99, ping: null };
  harness.clock.now += GOLDEN_CYCLE_INTERVAL_MS;
  expect((await runDeadlineReconciliation(deadlineDeps, "sha256:presentation-revision")).appended).toBe(true);
  harness.clock.now += GOLDEN_CYCLE_INTERVAL_MS;
  const terminal = await runTerminal(deadlineDeps);
  expect(terminal).toMatchObject({ appended: true, remainder: null });
  return readFileSync(harness.paths.journal, "utf8");
}

describe("the golden journal is recorded deterministically", () => {
  it("the same run reproduces fixtures/golden-journal.jsonl byte for byte (GBT_UPDATE_GOLDEN=1 re-records)", async () => {
    const recorded = await recordGoldenJournal();
    const again = await recordGoldenJournal();
    expect(again).toBe(recorded);
    if (process.env["GBT_UPDATE_GOLDEN"] === "1" || !existsSync(GOLDEN_PATH)) {
      mkdirSync(path.dirname(GOLDEN_PATH), { recursive: true });
      writeFileSync(GOLDEN_PATH, recorded, "utf8");
    }
    expect(readFileSync(GOLDEN_PATH, "utf8")).toBe(recorded);
    const types = parseJournalText(recorded).entries.map(entry => (entry["action"] === "close" ? `INTENT(close:${String(entry["route"])})` : entry.type));
    expect(types).toEqual(["BOOTSTRAP", "CYCLE", "INTENT", "OUTCOME", "CYCLE", "CYCLE", "INTENT(close:deadline)", "OUTCOME", "DEADLINE_RECONCILIATION", "TERMINAL"]);
    expect(integerUnit(types.length, "Quantity")).toBe(10);
  });
});

describe("SUBMISSION-SPEC §3 — the golden path over the recorded journal", () => {
  it("the built site carries the six-step anchor chain, every anchor resolves, the page names its revision and cutoff, and the presentation route is pinned", () => {
    const text = readFileSync(GOLDEN_PATH, "utf8");
    const entries = parseJournalText(text).entries;
    const revision = journalContentRevision(text);
    // R35 C3: the golden journal is journal evidence outside the runtime digest; its content
    // revision is pinned here so an edit to the demo data is visible in the suite.
    expect(revision).toBe("sha256:0deeb1f42e01e19b");
    const presentationAt = goldenPresentationCutoffAt(entries);
    expect(presentationAt).not.toBeNull();
    const { pages, latest } = sitePagesFor({
      entries, revision, nowMs: TEST_ONLY_GOLDEN_NOW_MS + 6 * GOLDEN_CYCLE_INTERVAL_MS, expectations: TEST_ONLY_GOLDEN_EXPECTATIONS,
      cycleIntervalMs: GOLDEN_CYCLE_INTERVAL_MS, deadManBoundMs: GOLDEN_DEAD_MAN_BOUND_MS, source: GOLDEN_SOURCE,
      pins: [{ kind: "presentation", at: presentationAt ?? "" }], pushState: emptyPushState(),
      styles: readPresentationAsset(DASHBOARD_STYLESHEET),
    });
    const out = path.join(tmpdir(), `gbt-golden-${String(process.pid)}-${String(Date.now())}`);
    buildSiteAtomically(out, pages, "golden");
    const index = readBuiltPage(out, "index.html") ?? "";
    // Every in-page link resolves to an element id: the demo navigates by anchors, never by a live market.
    const ids = new Set([...index.matchAll(/ id="([^"]+)"/gu)].map(match => match[1]));
    const hrefs = [...index.matchAll(/href="#([^"]+)"/gu)].map(match => match[1] ?? "");
    expect(hrefs.length).toBeGreaterThan(6);
    for (const href of hrefs) expect(ids.has(href), `anchor #${href} has no target`).toBe(true);
    const golden = [...(index.match(/<ol class="golden" id="golden-path">([\s\S]*?)<\/ol>/u)?.[1] ?? "").matchAll(/href="#([^"]+)"/gu)].map(match => match[1]);
    expect(golden).toHaveLength(6);
    expect(golden[0]).toBe("result");
    expect(golden[1]).toMatch(/^cycle-\d+$/u); // one completed decision cycle with a proposal
    expect(golden[2]).toMatch(/^cycle-\d+$/u); // the cycle with a vetoed candidate
    expect(golden[3]).toMatch(/^lifecycle-/u); // one approved intent to its fill and P&L contribution
    expect(golden[4]).toBe("source");
    expect(golden[5]).toBe("reconciliation");
    expect(index).toContain("stamp--veto");
    expect(index).toContain("Qualification gate: QUALIFIED");
    expect(index).toContain("Flat: zero broker positions");
    expect(index).toContain(GOLDEN_SOURCE.corePath);
    // The self-description a probe reads.
    const meta = readPageMeta(index);
    expect(meta["glass-box-journal-revision"]).toBe(revision);
    expect(meta["glass-box-evidence-cutoff-kind"]).toBe("latest");
    expect(meta["glass-box-last-seq"]).toBe("10");
    expect(meta["glass-box-publish-degraded"]).toBe("false");
    // The pinned presentation route rejects the deadline and terminal entries and says so.
    const pinned = readBuiltPage(out, immutableRoute(revision, "presentation")) ?? "";
    const pinnedMeta = readPageMeta(pinned);
    expect(pinnedMeta["glass-box-evidence-cutoff-kind"]).toBe("presentation");
    expect(pinnedMeta["glass-box-evidence-cutoff"]).toBe(presentationAt);
    expect(pinned).toContain("2 rejected as newer than the cutoff");
    const pinnedProjection = JSON.parse(readBuiltPage(out, `revisions/${encodeURIComponent(revision)}/presentation/projection.json`) ?? "{}") as { milestones: { deadlineAt: string | null; terminalAt: string | null }; entriesBeyondCutoff: number };
    expect(pinnedProjection.milestones).toMatchObject({ deadlineAt: null, terminalAt: null });
    expect(pinnedProjection.entriesBeyondCutoff).toBe(2);
    // The latest projection reconciles to the cent: the deadline close is the only realized component, nothing is unattributed.
    expect(latest.discrepancies).toEqual([]);
    expect(latest.unattributedCents).toBe(0);
    expect(latest.milestones.deadlineAt).not.toBeNull();
    expect(latest.milestones.terminalAt).not.toBeNull();
    expect(latest.milestones.flattenAt).not.toBeNull();
    expect(latest.qualification.state).toBe("QUALIFIED");
  });

  // Owner review 2026-09-02: (1) tooltips over the gate rail's G1-G8 cells,
  // and (2) a reading guide before the first data section, so a first-time
  // reader knows what the page is showing without decoding it from the data.
  it("every gate <li> for a known gate id carries a title naming the gate, and the reading guide precedes the first data section exactly once", () => {
    const text = readFileSync(GOLDEN_PATH, "utf8");
    const entries = parseJournalText(text).entries;
    const revision = journalContentRevision(text);
    const { pages } = sitePagesFor({
      entries, revision, nowMs: TEST_ONLY_GOLDEN_NOW_MS + 6 * GOLDEN_CYCLE_INTERVAL_MS, expectations: TEST_ONLY_GOLDEN_EXPECTATIONS,
      cycleIntervalMs: GOLDEN_CYCLE_INTERVAL_MS, deadManBoundMs: GOLDEN_DEAD_MAN_BOUND_MS, source: GOLDEN_SOURCE,
      pins: [], pushState: emptyPushState(), styles: readPresentationAsset(DASHBOARD_STYLESHEET),
    });
    const index = pages.find(page => page.relativePath === "index.html")?.render() ?? "";

    // Every rendered gate cell for a known id (G1-G8, the ids the golden journal actually uses) carries a title.
    const gateCells = [...index.matchAll(/<li class="gate gate--(?:pass|veto)"([^>]*)><span>(G\d)<\/span>/gu)];
    expect(gateCells.length).toBeGreaterThan(0); // the golden journal exercises the gate rail
    for (const [, attrs, gateId] of gateCells) {
      expect(attrs, `gate ${gateId as string} <li> attributes: ${attrs as string}`).toContain(`title="${gateId as string}`);
    }

    // The how-to-read section exists exactly once, mentions the journal, and precedes the first data section (#result).
    expect((index.match(/<section id="how-to-read"/gu) ?? [])).toHaveLength(1);
    expect(index).toMatch(/How to read this page/u);
    expect(index).toContain("journal");
    const howToReadAt = index.indexOf('<section id="how-to-read"');
    const resultAt = index.indexOf('<section id="result"');
    expect(howToReadAt).toBeGreaterThan(-1);
    expect(resultAt).toBeGreaterThan(-1);
    expect(howToReadAt).toBeLessThan(resultAt);
    expect(howToReadAt).toBeLessThan(index.indexOf("<table")); // precedes the first data table too
  });
});
