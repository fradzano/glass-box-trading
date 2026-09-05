// S-J-07 (atomic publication, candidate → anonymous probe → promotion,
// rollback; UNF-2), S-J-08 (branch isolation checked, not assumed; AUS-4),
// S-CYC-07 (push failure never blocks journaling; retry next invocation;
// the page shows its last-updated stamp). Ports are fakes: no git remote,
// no Vercel, no network. The deadline and terminal appends of S-G11-03/04
// go through the same candidate gate.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkPushTarget, planPromotion, planPush, planStableVerification, pushStateAfter, stateAfterPromotion, verifyProbe } from "../src/core/publish.js";
import type { DeploymentState, ProbeObservation, PublishExpectation } from "../src/core/publish.js";
import { buildSiteAtomically, DASHBOARD_STYLESHEET, immutableRoute, presentationAssetsDir, readBuiltPage, readPageMeta } from "../src/shell/dashboard-build.js";
import { runDeadlineReconciliation, runTerminal } from "../src/shell/deadline.js";
import { journalContentRevision, readDeploymentState, readPushState, runPublish } from "../src/shell/publisher.js";
import type { DeployPort, GitPort, PublishDependencies } from "../src/shell/publisher.js";
import { cleanupLifecycleDirs, lifecycleCalendar, lifecycleHarness, lifecycleMarket } from "./lifecycle-fixtures.js";
import type { LifecycleHarness } from "./lifecycle-fixtures.js";
import { TEST_ONLY_ACCOUNT_ID } from "./journal-fixtures.js";

const scratch: string[] = [];
afterEach(() => { cleanupLifecycleDirs(); for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function scratchDir(): string {
  const dir = path.join(tmpdir(), `gbt-p6-${String(process.pid)}-${String(scratch.length)}-${String(Date.now())}`);
  scratch.push(dir);
  return dir;
}

const SOURCE = { repositoryUrl: "https://example.invalid/glass-box-trading", journalRevisionUrl: null, corePath: "src/core/decision.ts", evidenceTestPath: "tests/cyc-runner.spec.ts", evidenceDebtRow: "WIN-1" };

/** A git port that content-hashes the journal (the committed revision) and can be told to fail its push. */
function fakeGit(): GitPort & { readonly pushes: string[]; failPush: Error | null } {
  const port = {
    pushes: [] as string[],
    failPush: null as Error | null,
    commitJournal: (text: string) => Promise.resolve(journalContentRevision(text)),
    push: (ref: string) => {
      if (port.failPush !== null) return Promise.reject(port.failPush);
      port.pushes.push(ref);
      return Promise.resolve();
    },
  };
  return port;
}

interface FakeDeployOptions {
  readonly candidateProbe?: (url: string, pageMeta: Readonly<Record<string, string>>) => ProbeObservation;
  readonly stableProbe?: (url: string, pageMeta: Readonly<Record<string, string>>) => ProbeObservation;
}

/** A deploy port that snapshots the built site per candidate and serves whichever candidate the alias points at. */
function fakeDeploy(options: FakeDeployOptions = {}) {
  const candidates = new Map<string, Readonly<Record<string, string>>>();
  const port = {
    stableUrl: "https://stable.invalid/",
    aliasTarget: null as string | null,
    promotions: [] as string[],
    rollbacks: [] as string[],
    deployed: 0,
    deployCandidate: (siteDir: string) => {
      port.deployed += 1;
      const url = `https://candidate-${String(port.deployed)}.invalid/`;
      candidates.set(url, readPageMeta(readFileSync(path.join(siteDir, "index.html"), "utf8")));
      return Promise.resolve({ url });
    },
    probe: (url: string): Promise<ProbeObservation> => {
      if (url === port.stableUrl) {
        const meta = port.aliasTarget === null ? undefined : candidates.get(port.aliasTarget);
        if (meta === undefined) return Promise.resolve({ ok: false, error: "alias points nowhere" });
        return Promise.resolve(options.stableProbe === undefined ? { ok: true, httpStatus: 200, meta, authenticated: false } : options.stableProbe(url, meta));
      }
      const meta = candidates.get(url);
      if (meta === undefined) return Promise.resolve({ ok: false, error: "unknown candidate" });
      return Promise.resolve(options.candidateProbe === undefined ? { ok: true, httpStatus: 200, meta, authenticated: false } : options.candidateProbe(url, meta));
    },
    promote: (url: string) => { port.promotions.push(url); port.aliasTarget = url; return Promise.resolve(); },
    rollback: (url: string) => { port.rollbacks.push(url); port.aliasTarget = url; return Promise.resolve(); },
  };
  return port satisfies DeployPort;
}

function publishDeps(harness: LifecycleHarness, git: GitPort, deploy: DeployPort | null, overrides: Partial<PublishDependencies> = {}): PublishDependencies {
  return {
    paths: harness.paths, git, deploy, configuredJournalRef: "journal", requestedRef: "journal", clock: () => harness.clock.now,
    siteDir: path.join(harness.paths.root, "site"),
    expectations: { initialCapitalCents: 10_000_000, expectedAccountId: TEST_ONLY_ACCOUNT_ID, flattenDate: "2026-09-03", profile: "dev", qualification: null },
    cycleIntervalMs: 900_000, deadManBoundMs: 3_000_000, source: SOURCE, pins: [], gateway: { gateway: harness.gateway, epoch: 1 },
    ...overrides,
  };
}

describe("S-J-07 / UNF-2 — builds are atomic: render aside, then swap", () => {
  it("a build interrupted mid-render leaves the previous page fully intact, and the page names its journal revision", () => {
    const out = path.join(scratchDir(), "site");
    buildSiteAtomically(out, [{ relativePath: "index.html", render: () => "<!doctype html><meta name=\"glass-box-journal-revision\" content=\"rev-A\">first" }, { relativePath: "data/projection.json", render: () => "{}" }], "1");
    expect(readBuiltPage(out, "index.html")).toContain("rev-A");
    const interrupted = () => buildSiteAtomically(out, [
      { relativePath: "index.html", render: () => "<!doctype html><meta name=\"glass-box-journal-revision\" content=\"rev-B\">second" },
      { relativePath: "data/projection.json", render: () => { throw new Error("render interrupted mid-build"); } },
    ], "2");
    expect(interrupted).toThrow("render interrupted mid-build");
    expect(readBuiltPage(out, "index.html")).toContain("rev-A");
    expect(readBuiltPage(out, "data/projection.json")).toBe("{}");
    expect(existsSync(`${out}.staging-2`)).toBe(false);
    expect(readPageMeta(readBuiltPage(out, "index.html") ?? "")).toEqual({ "glass-box-journal-revision": "rev-A" });
  });

  it("a write that fails after the first page also leaves the previous output untouched", () => {
    const out = path.join(scratchDir(), "site");
    buildSiteAtomically(out, [{ relativePath: "index.html", render: () => "one" }], "1");
    let writes = 0;
    const failingSink = { writeFile: (absolutePath: string, content: string) => { writes += 1; if (writes === 2) throw new Error("disk full"); writeFileSync(absolutePath, content, "utf8"); } };
    expect(() => buildSiteAtomically(out, [{ relativePath: "index.html", render: () => "two" }, { relativePath: "b.html", render: () => "b" }], "2", failingSink)).toThrow("disk full");
    expect(readBuiltPage(out, "index.html")).toBe("one");
    expect(readBuiltPage(out, "b.html")).toBeNull();
  });

  it("immutable revision routes are carried forward and never overwritten by a later build (presentation-cutoff route stability)", () => {
    const out = path.join(scratchDir(), "site");
    const pinned = immutableRoute("rev-A", "presentation");
    buildSiteAtomically(out, [{ relativePath: "index.html", render: () => "A" }, { relativePath: pinned, render: () => "pinned A" }], "1");
    const second = buildSiteAtomically(out, [{ relativePath: "index.html", render: () => "B" }, { relativePath: pinned, render: () => "pinned A REWRITTEN" }, { relativePath: immutableRoute("rev-B", "latest"), render: () => "B latest" }], "2");
    expect(readBuiltPage(out, "index.html")).toBe("B");
    expect(readBuiltPage(out, pinned)).toBe("pinned A");
    expect(readBuiltPage(out, immutableRoute("rev-B", "latest"))).toBe("B latest");
    expect(second.carriedForward).toEqual(["revisions/"]);
    expect(second.preservedImmutable).toEqual([pinned]);
  });
});

describe("S-J-07 — the anonymous probe contract", () => {
  const expectation: PublishExpectation = { journalRevision: "rev-A", cutoffAt: "2026-09-03T20:30:00.000Z", cutoffKind: "presentation", lastUpdatedAt: "2026-09-03T20:29:00.000Z", lastSeq: 41 };
  const good: ProbeObservation = { ok: true, httpStatus: 200, authenticated: false, meta: { "glass-box-journal-revision": "rev-A", "glass-box-evidence-cutoff": "2026-09-03T20:30:00.000Z", "glass-box-evidence-cutoff-kind": "presentation", "glass-box-last-updated": "2026-09-03T20:29:00.000Z", "glass-box-last-seq": "41" } };

  it("accepts an unauthenticated 200 with every self-description equal, and rejects a mismatch, a missing tag, an auth wall, a non-200, or a failure", () => {
    expect(verifyProbe(expectation, good)).toEqual({ ok: true });
    expect(verifyProbe(expectation, { ...good, meta: { ...good.meta, "glass-box-journal-revision": "rev-B" } })).toMatchObject({ ok: false, reasons: [expect.stringContaining("META_MISMATCH: glass-box-journal-revision")] });
    const withoutSeq = Object.fromEntries(Object.entries(good.meta).filter(([name]) => name !== "glass-box-last-seq"));
    expect(verifyProbe(expectation, { ...good, meta: withoutSeq })).toMatchObject({ ok: false, reasons: ["META_MISSING: glass-box-last-seq"] });
    expect(verifyProbe(expectation, { ...good, authenticated: true })).toMatchObject({ ok: false, reasons: ["PROBE_REQUIRED_AUTHENTICATION"] });
    expect(verifyProbe(expectation, { ...good, httpStatus: 404 })).toMatchObject({ ok: false, reasons: ["PROBE_HTTP_404"] });
    expect(verifyProbe(expectation, { ok: false, error: "ECONNREFUSED" })).toMatchObject({ ok: false, reasons: ["PROBE_FAILED: ECONNREFUSED"] });
  });

  it("a rejected candidate never moves the alias; a stable-origin failure rolls back to the previous accepted deployment", () => {
    const candidate = { expectation, candidateUrl: "https://c1.invalid/", deployedAt: "t1", probedAt: "t1" };
    const rejected = planPromotion(candidate, { ok: false, reasons: ["x"] }, "t1");
    expect(rejected.kind).toBe("reject");
    let state: DeploymentState = stateAfterPromotion({ stable: null, receipts: [] }, rejected);
    expect(state.stable).toBeNull();
    const first = planPromotion(candidate, { ok: true }, "t2");
    state = stateAfterPromotion(state, first);
    const second = planPromotion({ ...candidate, candidateUrl: "https://c2.invalid/" }, { ok: true }, "t3");
    state = stateAfterPromotion(state, second);
    expect(state.stable?.candidateUrl).toBe("https://c2.invalid/");
    const plan = planStableVerification(state, { ok: false, reasons: ["stable origin served rev-B"] });
    expect(plan).toMatchObject({ kind: "rollback", to: { candidateUrl: "https://c1.invalid/" } });
    expect(planStableVerification(stateAfterPromotion({ stable: null, receipts: [] }, first), { ok: false, reasons: ["x"] })).toMatchObject({ kind: "no_prior_accepted" });
  });
});

describe("S-J-08 / AUS-4 — the journal writer refuses any ref but the configured journal branch, and journals the refusal", () => {
  it("exact match only", () => {
    expect(checkPushTarget("journal", "journal")).toEqual({ ok: true, ref: "journal" });
    expect(checkPushTarget("journal", "main")).toMatchObject({ ok: false, reason: expect.stringContaining("PUSH_REF_REFUSED") });
    expect(checkPushTarget("journal", "refs/heads/journal")).toMatchObject({ ok: false });
    expect(checkPushTarget("journal", "Journal")).toMatchObject({ ok: false });
    expect(checkPushTarget("", "journal")).toMatchObject({ ok: false, reason: "JOURNAL_REF_NOT_CONFIGURED" });
  });

  it("a non-journal target is refused before any push, and the refusal is a local RECONCILIATION item", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    const git = fakeGit();
    const report = await runPublish(publishDeps(harness, git, fakeDeploy(), { requestedRef: "main" }));
    expect(report.push).toBe("refused");
    expect(report.refusal).toContain("PUSH_REF_REFUSED");
    expect(git.pushes).toEqual([]);
    const refusal = harness.entries().find(entry => entry.type === "RECONCILIATION" && Array.isArray(entry["items"]) && (entry["items"] as { kind: string }[]).some(item => item.kind === "journal_push_refused"));
    expect(refusal).toMatchObject({ items: [{ kind: "journal_push_refused", requestedRef: "main", configuredJournalRef: "journal" }] });
    expect(report.alarms).toContain("JOURNAL_PUSH_REF_REFUSED");
  });
});

describe("S-CYC-07 — push failure: trading and journaling continue, push retries next invocation, the page shows its stamp", () => {
  it("a failed push records its state, still builds the local page, deploys no candidate, and the next invocation retries the same revision", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    const git = fakeGit();
    git.failPush = new Error("remote: authentication failed");
    const deploy = fakeDeploy();
    const first = await runPublish(publishDeps(harness, git, deploy));
    expect(first.push).toBe("failed");
    expect(first.pushState).toMatchObject({ consecutiveFailures: 1, lastError: "remote: authentication failed", lastPushedRevision: null });
    expect(first.build).not.toBeNull();
    expect(first.promotion).toBe("not_attempted");
    expect(deploy.deployed).toBe(0);
    expect(first.alarms).toEqual(["JOURNAL_PUSH_FAILED", "CANDIDATE_NOT_DEPLOYED_PUSH_INCOMPLETE"]);
    const page = readBuiltPage(path.join(harness.paths.root, "site"), "index.html") ?? "";
    const meta = readPageMeta(page);
    expect(meta["glass-box-last-updated"]).toBe(harness.entries().at(-1)?.at);
    expect(meta["glass-box-publish-degraded"]).toBe("true");
    expect(page).toContain("Degraded publication");
    // Trading continues: another cycle appends, then the retry succeeds and pushes the newer revision.
    harness.clock.now += 900_000;
    await harness.cycle();
    git.failPush = null;
    const second = await runPublish(publishDeps(harness, git, deploy));
    expect(second.push).toBe("pushed");
    expect(git.pushes).toEqual(["journal"]);
    expect(second.pushState).toMatchObject({ consecutiveFailures: 0, lastPushedRevision: second.revision });
    expect(readPushState(harness.paths).lastPushedRevision).toBe(second.revision);
    expect(second.promotion).toBe("promoted");
    expect(readPageMeta(readBuiltPage(path.join(harness.paths.root, "site"), "index.html") ?? "")["glass-box-publish-degraded"]).toBe("false");
    // Unchanged journal: nothing to push, no new candidate.
    const third = await runPublish(publishDeps(harness, git, deploy));
    expect(third.push).toBe("skipped");
    expect(planPush(third.pushState, third.revision)).toEqual({ kind: "skip", reason: "ALREADY_PUSHED" });
    expect(pushStateAfter(third.pushState, { ok: false, error: "x" }, "t").consecutiveFailures).toBe(1);
  });
});

describe("R33 C1 — a site build failure (unreadable asset, or a failing write) pushes DASHBOARD_BUILD_FAILED and leaves the previously published page untouched", () => {
  it("a presentation asset that goes missing between publishes fails the build closed", async () => {
    // R34 B3 — readPresentationAsset() is called inline in runPublish (src/shell/publisher.ts),
    // not imported once at module load, so removing the file between publishes is observable
    // here — without touching the committed assets/dashboard.css: presentationAssetsDir points
    // the read at a scratch copy instead.
    const assetsDir = scratchDir();
    mkdirSync(assetsDir, { recursive: true });
    const assetCopy = path.join(assetsDir, DASHBOARD_STYLESHEET);
    writeFileSync(assetCopy, readFileSync(path.join(presentationAssetsDir, DASHBOARD_STYLESHEET), "utf8"), "utf8");

    const harness = await lifecycleHarness();
    await harness.cycle();
    const deps = publishDeps(harness, fakeGit(), fakeDeploy(), { presentationAssetsDir: assetsDir });
    const first = await runPublish(deps);
    expect(first.build).not.toBeNull();
    const standing = readBuiltPage(deps.siteDir, "index.html");
    expect(standing).not.toBeNull();

    rmSync(assetCopy, { force: true });
    const second = await runPublish(deps);
    expect(second.alarms).toContain("DASHBOARD_BUILD_FAILED");
    expect(second.build).toBeNull();
    expect(second.buildError).toMatch(/dashboard\.css.*missing or unreadable.*refusing to render an unstyled page/su);
    expect(readBuiltPage(deps.siteDir, "index.html")).toBe(standing);
  });

  it("a write that fails mid-build (the atomic swap itself) fails the build closed", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    const git = fakeGit();
    const deploy = fakeDeploy();
    const first = await runPublish(publishDeps(harness, git, deploy));
    expect(first.build).not.toBeNull();
    const standing = readBuiltPage(path.join(harness.paths.root, "site"), "index.html");
    expect(standing).not.toBeNull();

    harness.clock.now += 900_000;
    await harness.cycle(); // a new journal entry so the second publish has a fresh revision to build
    const failingSink = { writeFile: () => { throw new Error("disk full (probe)"); } };
    const second = await runPublish(publishDeps(harness, git, deploy, { buildSink: failingSink }));
    expect(second.alarms).toContain("DASHBOARD_BUILD_FAILED");
    expect(second.build).toBeNull();
    expect(second.buildError).toBe("disk full (probe)");
    expect(readBuiltPage(path.join(harness.paths.root, "site"), "index.html")).toBe(standing);
  });
});

describe("S-J-07 / SUB-11 — candidate rejection, successful promotion, rollback, and the deadline/terminal appends", () => {
  it("a candidate whose anonymous probe mismatches never moves the alias; the receipt records the rejection outside the journal", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    const deploy = fakeDeploy({ candidateProbe: (_url, meta) => ({ ok: true, httpStatus: 200, authenticated: false, meta: { ...meta, "glass-box-journal-revision": "sha256:someoneelse" } }) });
    const before = harness.entries().length;
    const report = await runPublish(publishDeps(harness, fakeGit(), deploy));
    expect(report.push).toBe("pushed");
    expect(report.promotion).toBe("rejected");
    expect(deploy.promotions).toEqual([]);
    expect(deploy.aliasTarget).toBeNull();
    expect(report.alarms).toEqual(["CANDIDATE_PROBE_REJECTED"]);
    const state = readDeploymentState(harness.paths);
    expect(state.stable).toBeNull();
    expect(state.receipts).toMatchObject([{ journalRevision: report.revision, accepted: false, promotedAt: null, reasons: [expect.stringContaining("META_MISMATCH")] }]);
    expect(harness.entries().length).toBe(before); // acceptance writes no journal entry
  });

  it("a clean candidate probe promotes atomically and the stable origin is verified against the same expectation", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    const deploy = fakeDeploy();
    const report = await runPublish(publishDeps(harness, fakeGit(), deploy));
    expect(report.promotion).toBe("promoted");
    expect(report.stableVerification).toBe("keep");
    expect(deploy.promotions).toEqual(["https://candidate-1.invalid/"]);
    expect(deploy.aliasTarget).toBe("https://candidate-1.invalid/");
    expect(report.alarms).toEqual([]);
    const state = readDeploymentState(harness.paths);
    expect(state.stable).toMatchObject({ journalRevision: report.revision, cutoffKind: "latest", accepted: true, candidateUrl: "https://candidate-1.invalid/" });
    expect(state.stable?.promotedAt).not.toBeNull();
    expect(existsSync(path.join(harness.paths.root, "deployments.json"))).toBe(true);
  });

  it("a stable-origin verification failure restores the prior accepted deployment and raises the alarm", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    let stableAnswers = 0;
    const deploy = fakeDeploy({ stableProbe: (_url, meta) => { stableAnswers += 1; return stableAnswers === 1 ? { ok: true, httpStatus: 200, authenticated: false, meta } : { ok: true, httpStatus: 200, authenticated: false, meta: { ...meta, "glass-box-last-seq": "0" } }; } });
    const git = fakeGit();
    const first = await runPublish(publishDeps(harness, git, deploy));
    expect(first.promotion).toBe("promoted");
    harness.clock.now += 900_000;
    await harness.cycle();
    const second = await runPublish(publishDeps(harness, git, deploy));
    expect(second.promotion).toBe("promoted");
    expect(second.stableVerification).toBe("rollback");
    expect(deploy.rollbacks).toEqual(["https://candidate-1.invalid/"]);
    expect(deploy.aliasTarget).toBe("https://candidate-1.invalid/");
    expect(second.alarms).toEqual(["STABLE_ORIGIN_VERIFICATION_FAILED_ROLLED_BACK"]);
    const state = readDeploymentState(harness.paths);
    expect(state.stable?.candidateUrl).toBe("https://candidate-1.invalid/");
    expect(state.stable?.journalRevision).toBe(first.revision);
    expect(state.receipts.at(-1)?.reasons[0]).toContain("ROLLBACK");
  });

  it("the deadline reconciliation and the terminal append each produce a candidate that is probed before promotion; the pinned presentation route survives", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    const deploy = fakeDeploy();
    const git = fakeGit();
    const presentationAt = harness.entries().at(-1)?.at ?? "";
    const pinned = await runPublish(publishDeps(harness, git, deploy, { pins: [{ kind: "presentation", at: presentationAt }] }));
    expect(pinned.promotion).toBe("promoted");
    const pinnedRoute = immutableRoute(pinned.revision ?? "", "presentation");
    const pinnedPage = readBuiltPage(path.join(harness.paths.root, "site"), pinnedRoute);
    expect(readPageMeta(pinnedPage ?? "")["glass-box-evidence-cutoff-kind"]).toBe("presentation");
    const deadlineDeps = { gateway: harness.gateway, epoch: 1, broker: harness.fake.read, market: lifecycleMarket(() => harness.clock.now), clock: () => harness.clock.now, profile: "dev" as const, calendar: lifecycleCalendar(harness.clock.now), tradingDay: "2026-09-04", cycleIndex: 99, ping: null, underlyingUniverse: ["SPY"], paths: harness.paths };
    harness.clock.now += 3_600_000;
    expect((await runDeadlineReconciliation(deadlineDeps, pinned.revision ?? "")).appended).toBe(true);
    const deadline = await runPublish(publishDeps(harness, git, deploy, { pins: [{ kind: "deadline", at: harness.entries().at(-1)?.at ?? "" }] }));
    expect(deadline.promotion).toBe("promoted");
    expect(deadline.stableVerification).toBe("keep");
    harness.clock.now += 3_600_000;
    expect((await runTerminal(deadlineDeps)).appended).toBe(true);
    const terminal = await runPublish(publishDeps(harness, git, deploy));
    expect(terminal.promotion).toBe("promoted");
    expect(deploy.promotions).toHaveLength(3);
    expect(readBuiltPage(path.join(harness.paths.root, "site"), pinnedRoute)).toBe(pinnedPage);
    expect(terminal.projection?.milestones.deadlineAt).not.toBeNull();
    expect(terminal.projection?.milestones.terminalAt).not.toBeNull();
    const receipts = readDeploymentState(harness.paths).receipts;
    expect(receipts.map(receipt => receipt.accepted)).toEqual([true, true, true]);
    expect(new Set(receipts.map(receipt => receipt.journalRevision)).size).toBe(3);
    // The receipt is keyed by revision and lives outside the journal: no journal entry mentions a deployment.
    expect(harness.entries().every(entry => !JSON.stringify(entry).includes(".invalid/"))).toBe(true);
    mkdirSync(path.join(harness.paths.root, "site"), { recursive: true });
    expect(readFileSync(path.join(harness.paths.root, "deployments.json"), "utf8")).toContain("candidate-3");
  });
});
