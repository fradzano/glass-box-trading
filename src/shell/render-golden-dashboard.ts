// Local golden-path render (SUB-02 first working version, P6): builds
// artifacts/dashboard from the recorded fixtures/golden-journal.jsonl with the
// presentation cutoff pinned, exactly as the publisher would for a candidate.
// No network, no git, no clock beyond the render stamp.
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseJournalText } from "../core/journal.js";
import { emptyPushState } from "../core/publish.js";
import { GOLDEN_CYCLE_INTERVAL_MS, GOLDEN_DEAD_MAN_BOUND_MS, GOLDEN_SOURCE, TEST_ONLY_GOLDEN_EXPECTATIONS, goldenPresentationCutoffAt } from "../fixtures/p6-golden.js";
import { buildSiteAtomically, immutableRoute } from "./dashboard-build.js";
import { journalContentRevision, sitePagesFor } from "./publisher.js";

const journalPath = path.resolve("fixtures/golden-journal.jsonl");
const text = readFileSync(journalPath, "utf8");
const entries = parseJournalText(text).entries;
const revision = journalContentRevision(text);
const presentationAt = goldenPresentationCutoffAt(entries);
const { pages, latest } = sitePagesFor({
  entries, revision, nowMs: Date.now(), expectations: TEST_ONLY_GOLDEN_EXPECTATIONS,
  cycleIntervalMs: GOLDEN_CYCLE_INTERVAL_MS, deadManBoundMs: GOLDEN_DEAD_MAN_BOUND_MS, source: GOLDEN_SOURCE,
  pins: presentationAt === null ? [] : [{ kind: "presentation", at: presentationAt }], pushState: emptyPushState(),
});
const report = buildSiteAtomically(path.resolve("artifacts/dashboard"), pages, String(process.pid));
process.stdout.write(`Rendered ${String(report.written.length)} page(s) into artifacts/dashboard from ${String(entries.length)} golden journal entries (revision ${revision}); latest cutoff ${latest.cutoff.at}, ${String(latest.discrepancies.length)} reconciliation discrepancies; presentation route ${presentationAt === null ? "not pinned" : immutableRoute(revision, "presentation")}.\n`);
