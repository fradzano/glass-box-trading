// The publication step (S-CYC-07, S-J-07, S-J-08, SUB-02/SUB-11): read the
// journal, obtain the committed journal revision, push it to the configured
// journal ref (and to nothing else), render the static site atomically,
// deploy it as an immutable candidate, probe the candidate anonymously,
// promote only on a clean probe, verify the stable origin, and roll back to
// the previous accepted deployment on failure. Every decision is pure
// (`src/core/publish.ts`, `src/core/projection.ts`); this module only reads,
// writes, and calls ports. Push and deploy failures are reported, never
// thrown: trading and journaling never block on publication. Receipts and
// the push state live in STATE_DIR, outside the append-only journal.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { epochMsToUtcIso } from "../core/execution.js";
import { parseJournalText } from "../core/journal.js";
import type { JournalEntry } from "../core/journal.js";
import { assessFreshness, projectPerformance } from "../core/projection.js";
import type { CutoffKind, EvidenceCutoff, PerformanceProjection, ProjectionExpectations } from "../core/projection.js";
import {
  checkPushTarget,
  emptyDeploymentState,
  emptyPushState,
  planPromotion,
  planPush,
  planStableVerification,
  publishDegradation,
  pushRefusalDraft,
  pushStateAfter,
  receiptFor,
  stateAfterPromotion,
  stateAfterStableVerification,
  verifyProbe,
} from "../core/publish.js";
import type { DeploymentState, ProbeObservation, ProbeVerdict, PublishExpectation, PushState, StableVerificationPlan } from "../core/publish.js";
import { DASHBOARD_STYLESHEET, buildSiteAtomically, immutableRoute, readPresentationAsset } from "./dashboard-build.js";
import type { BuildReport, BuildSink, SitePage } from "./dashboard-build.js";
import type { MutationGateway } from "./mutation-gateway.js";
import { renderDashboard } from "./render-dashboard.js";
import type { PinnedRoute, PublicSourceLinks } from "./render-dashboard.js";
import type { StatePaths } from "./state-dir.js";

/** The journal-branch port. The P6 fake hashes content; the real git port arrives with the kickoff release (P8). */
export interface GitPort {
  /** Commits the journal on the journal branch when it changed; returns the head revision of that branch. */
  commitJournal(journalText: string): Promise<string>;
  push(ref: string): Promise<void>;
}

/** Candidate deployment, anonymous probe, atomic alias operations. Fakes only in P6; Vercel in P8. */
export interface DeployPort {
  readonly stableUrl: string;
  deployCandidate(siteDir: string): Promise<{ readonly url: string }>;
  probe(url: string): Promise<ProbeObservation>;
  promote(candidateUrl: string): Promise<void>;
  rollback(candidateUrl: string): Promise<void>;
}

export interface PinRequest {
  readonly kind: Exclude<CutoffKind, "latest">;
  readonly at: string;
}

export interface PublishDependencies {
  readonly paths: StatePaths;
  readonly git: GitPort;
  readonly deploy: DeployPort | null;
  readonly configuredJournalRef: string;
  /** The ref this invocation asks to push to; anything but the configured journal ref is refused and journaled (S-J-08). */
  readonly requestedRef: string;
  readonly clock: () => number;
  readonly siteDir: string;
  readonly expectations: ProjectionExpectations;
  readonly cycleIntervalMs: number;
  readonly deadManBoundMs: number;
  readonly source: PublicSourceLinks;
  /** Cutoffs to pin as immutable routes in addition to the advancing latest route. */
  readonly pins: readonly PinRequest[];
  /** Present when a refusal must be journaled locally; the publisher never appends anything else. */
  readonly gateway: { readonly gateway: MutationGateway; readonly epoch: number } | null;
  readonly buildSink?: BuildSink;
}

export interface PublishReport {
  readonly revision: string | null;
  readonly refusal: string | null;
  readonly push: "pushed" | "failed" | "skipped" | "refused";
  readonly pushState: PushState;
  readonly build: BuildReport | null;
  readonly buildError: string | null;
  readonly candidateUrl: string | null;
  readonly promotion: "promoted" | "rejected" | "not_attempted";
  readonly stableVerification: StableVerificationPlan["kind"] | "not_attempted";
  readonly deploymentState: DeploymentState;
  readonly alarms: readonly string[];
  readonly projection: PerformanceProjection | null;
}

function pushStatePath(paths: StatePaths): string {
  return path.join(paths.root, "publish-state.json");
}

function deploymentsPath(paths: StatePaths): string {
  return path.join(paths.root, "deployments.json");
}

function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function writeJsonAtomically(file: string, value: unknown, nonce: string): void {
  const temporary = `${file}.${nonce}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
  renameSync(temporary, file);
}

export function readPushState(paths: StatePaths): PushState {
  return readJson(pushStatePath(paths), emptyPushState());
}

export function readDeploymentState(paths: StatePaths): DeploymentState {
  return readJson(deploymentsPath(paths), emptyDeploymentState());
}

/** Content-addressed revision of the journal text: the fake git port and the receipt cross-check share it. */
export function journalContentRevision(journalText: string): string {
  return `sha256:${createHash("sha256").update(journalText, "utf8").digest("hex").slice(0, 16)}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function expectationFor(projection: PerformanceProjection): PublishExpectation {
  return { journalRevision: projection.journalRevision, cutoffAt: projection.cutoff.at, cutoffKind: projection.cutoff.kind, lastUpdatedAt: projection.lastUpdatedAt, lastSeq: projection.lastSeq };
}

function readJournalEntries(paths: StatePaths): { readonly text: string; readonly entries: readonly JournalEntry[] } {
  const text = existsSync(paths.journal) ? readFileSync(paths.journal, "utf8") : "";
  const lastNewline = text.lastIndexOf("\n");
  const complete = text.slice(0, lastNewline + 1);
  return { text: complete, entries: parseJournalText(complete).entries };
}

export interface SiteRenderInput {
  readonly entries: readonly JournalEntry[];
  readonly revision: string;
  readonly nowMs: number;
  readonly expectations: ProjectionExpectations;
  readonly cycleIntervalMs: number;
  readonly deadManBoundMs: number;
  readonly source: PublicSourceLinks;
  readonly pins: readonly PinRequest[];
  readonly pushState: PushState;
  /** The dashboard stylesheet text (`assets/dashboard.css`), inlined into every rendered page. */
  readonly styles: string;
}

/** The page set for one revision: the advancing latest route plus one immutable route per pin. Pure apart from its inputs. */
export function sitePagesFor(input: SiteRenderInput): { readonly pages: readonly SitePage[]; readonly latest: PerformanceProjection } {
  const lastAt = input.entries[input.entries.length - 1]?.at ?? epochMsToUtcIso(input.nowMs);
  const latestCutoff: EvidenceCutoff = { at: lastAt, kind: "latest" };
  const latest = projectPerformance(input.entries, input.revision, latestCutoff, input.expectations);
  const renderedAt = epochMsToUtcIso(input.nowMs);
  const degradation = publishDegradation(input.pushState, input.revision);
  const pinned: PinnedRoute[] = input.pins.map(pin => ({ journalRevision: input.revision, cutoffKind: pin.kind, cutoffAt: pin.at, href: immutableRoute(input.revision, pin.kind) }));
  const context = (routeLabel: string, projection: PerformanceProjection) => ({
    renderedAt,
    freshness: assessFreshness(projection.lastUpdatedAt, input.nowMs, input.cycleIntervalMs, input.deadManBoundMs),
    degradation,
    source: input.source,
    pinned,
    routeLabel,
    styles: input.styles,
  });
  const pages: SitePage[] = [
    { relativePath: "index.html", render: () => renderDashboard(latest, expectationFor(latest), context("latest (advances with every accepted revision)", latest)) },
    { relativePath: "data/projection.json", render: () => JSON.stringify(latest, null, 2) },
    { relativePath: immutableRoute(input.revision, "latest"), render: () => renderDashboard(latest, expectationFor(latest), context(`immutable: revision ${input.revision}, latest cutoff`, latest)) },
  ];
  for (const pin of input.pins) {
    const projection = projectPerformance(input.entries, input.revision, { at: pin.at, kind: pin.kind }, input.expectations);
    pages.push({ relativePath: immutableRoute(input.revision, pin.kind), render: () => renderDashboard(projection, expectationFor(projection), context(`immutable: revision ${input.revision}, ${pin.kind} cutoff`, projection)) });
    pages.push({ relativePath: `revisions/${encodeURIComponent(input.revision)}/${encodeURIComponent(pin.kind)}/projection.json`, render: () => JSON.stringify(projection, null, 2) });
  }
  return { pages, latest };
}

async function probeAgainst(deploy: DeployPort, url: string, expectation: PublishExpectation): Promise<ProbeVerdict> {
  let observation: ProbeObservation;
  try {
    observation = await deploy.probe(url);
  } catch (error) {
    observation = { ok: false, error: messageOf(error) };
  }
  return verifyProbe(expectation, observation);
}

export async function runPublish(deps: PublishDependencies): Promise<PublishReport> {
  const nowMs = deps.clock();
  const nowIso = epochMsToUtcIso(nowMs);
  const nonce = String(nowMs);
  const alarms: string[] = [];
  const journal = readJournalEntries(deps.paths);
  let pushState = readPushState(deps.paths);
  let deploymentState = readDeploymentState(deps.paths);

  // ---- S-J-08: the writer pushes to the configured journal ref and refuses every other ref; the refusal is journaled locally ----
  const target = checkPushTarget(deps.configuredJournalRef, deps.requestedRef);
  if (!target.ok) {
    if (deps.gateway !== null) {
      await deps.gateway.gateway.dispatch({ class: "authoritative", epoch: deps.gateway.epoch, action: { kind: "journal_append", entry: pushRefusalDraft({ atIso: nowIso, epoch: deps.gateway.epoch }, target, deps.requestedRef, deps.configuredJournalRef) } });
    }
    alarms.push("JOURNAL_PUSH_REF_REFUSED");
    return { revision: null, refusal: target.reason, push: "refused", pushState, build: null, buildError: null, candidateUrl: null, promotion: "not_attempted", stableVerification: "not_attempted", deploymentState, alarms, projection: null };
  }

  // ---- the committed journal revision, then the push (S-CYC-07: a failure is recorded and retried next time) ----
  let revision: string | null = null;
  try {
    revision = await deps.git.commitJournal(journal.text);
  } catch (error) {
    pushState = pushStateAfter(pushState, { ok: false, error: `commit: ${messageOf(error)}` }, nowIso);
  }
  const pushPlan = planPush(pushState, revision);
  let push: PublishReport["push"] = "skipped";
  if (pushPlan.kind === "push") {
    try {
      await deps.git.push(target.ref);
      pushState = pushStateAfter(pushState, { ok: true, revision: pushPlan.revision }, nowIso);
      push = "pushed";
    } catch (error) {
      pushState = pushStateAfter(pushState, { ok: false, error: messageOf(error) }, nowIso);
      push = "failed";
      alarms.push("JOURNAL_PUSH_FAILED");
    }
  }
  writeJsonAtomically(pushStatePath(deps.paths), pushState, nonce);
  if (revision === null) {
    return { revision, refusal: null, push, pushState, build: null, buildError: null, candidateUrl: null, promotion: "not_attempted", stableVerification: "not_attempted", deploymentState, alarms, projection: null };
  }

  // ---- render aside, then swap (S-J-07): the local site always reflects the local journal, pushed or not ----
  // The presentation asset is read here, not imported: a missing or unreadable
  // stylesheet is a build failure like any other, never a silently unstyled page.
  let styles: string;
  try {
    styles = readPresentationAsset(DASHBOARD_STYLESHEET);
  } catch (error) {
    alarms.push("DASHBOARD_BUILD_FAILED");
    return { revision, refusal: null, push, pushState, build: null, buildError: messageOf(error), candidateUrl: null, promotion: "not_attempted", stableVerification: "not_attempted", deploymentState, alarms, projection: null };
  }
  const { pages, latest } = sitePagesFor({ entries: journal.entries, revision, nowMs, expectations: deps.expectations, cycleIntervalMs: deps.cycleIntervalMs, deadManBoundMs: deps.deadManBoundMs, source: deps.source, pins: deps.pins, pushState, styles });
  let build: BuildReport;
  try {
    build = buildSiteAtomically(deps.siteDir, pages, nonce, deps.buildSink);
  } catch (error) {
    alarms.push("DASHBOARD_BUILD_FAILED");
    return { revision, refusal: null, push, pushState, build: null, buildError: messageOf(error), candidateUrl: null, promotion: "not_attempted", stableVerification: "not_attempted", deploymentState, alarms, projection: latest };
  }

  // ---- immutable candidate → anonymous probe → atomic promotion → stable-origin verification → rollback on failure ----
  if (deps.deploy === null || push !== "pushed") {
    if (deps.deploy !== null) alarms.push("CANDIDATE_NOT_DEPLOYED_PUSH_INCOMPLETE");
    return { revision, refusal: null, push, pushState, build, buildError: null, candidateUrl: null, promotion: "not_attempted", stableVerification: "not_attempted", deploymentState, alarms, projection: latest };
  }
  const expectation = expectationFor(latest);
  let candidateUrl: string;
  try {
    candidateUrl = (await deps.deploy.deployCandidate(deps.siteDir)).url;
  } catch (error) {
    alarms.push(`CANDIDATE_DEPLOY_FAILED: ${messageOf(error)}`);
    return { revision, refusal: null, push, pushState, build, buildError: null, candidateUrl: null, promotion: "not_attempted", stableVerification: "not_attempted", deploymentState, alarms, projection: latest };
  }
  const candidateVerdict = await probeAgainst(deps.deploy, candidateUrl, expectation);
  const promotion = planPromotion({ expectation, candidateUrl, deployedAt: nowIso, probedAt: epochMsToUtcIso(deps.clock()) }, candidateVerdict, epochMsToUtcIso(deps.clock()));
  let stableVerification: PublishReport["stableVerification"] = "not_attempted";
  if (promotion.kind === "promote") {
    try {
      await deps.deploy.promote(candidateUrl);
    } catch (error) {
      // A failed alias operation is a failed promotion: the receipt records it and the stable alias is left where it was.
      const rejected = { ...promotion, kind: "reject" as const, receipt: { ...promotion.receipt, accepted: false, promotedAt: null, reasons: [`PROMOTE_FAILED: ${messageOf(error)}`] } };
      deploymentState = stateAfterPromotion(deploymentState, rejected);
      alarms.push("CANDIDATE_PROMOTION_FAILED");
      writeJsonAtomically(deploymentsPath(deps.paths), deploymentState, nonce);
      return { revision, refusal: null, push, pushState, build, buildError: null, candidateUrl, promotion: "rejected", stableVerification, deploymentState, alarms, projection: latest };
    }
    deploymentState = stateAfterPromotion(deploymentState, promotion);
    const stableVerdict = await probeAgainst(deps.deploy, deps.deploy.stableUrl, expectation);
    const plan = planStableVerification(deploymentState, stableVerdict);
    stableVerification = plan.kind;
    if (plan.kind === "rollback") {
      try {
        await deps.deploy.rollback(plan.to.candidateUrl);
      } catch (error) {
        alarms.push(`ROLLBACK_FAILED: ${messageOf(error)}`);
      }
      alarms.push("STABLE_ORIGIN_VERIFICATION_FAILED_ROLLED_BACK");
    } else if (plan.kind === "no_prior_accepted") {
      alarms.push("STABLE_ORIGIN_VERIFICATION_FAILED_NO_PRIOR_ACCEPTED");
    }
    deploymentState = stateAfterStableVerification(deploymentState, plan, epochMsToUtcIso(deps.clock()));
  } else {
    deploymentState = stateAfterPromotion(deploymentState, promotion);
    alarms.push("CANDIDATE_PROBE_REJECTED");
  }
  writeJsonAtomically(deploymentsPath(deps.paths), deploymentState, nonce);
  return { revision, refusal: null, push, pushState, build, buildError: null, candidateUrl, promotion: promotion.kind === "promote" ? "promoted" : "rejected", stableVerification, deploymentState, alarms, projection: latest };
}

/** Convenience for tests and tools: the receipt behind one revision and cutoff kind. */
export function deploymentReceiptFor(paths: StatePaths, journalRevision: string, cutoffKind: CutoffKind) {
  return receiptFor(readDeploymentState(paths), journalRevision, cutoffKind);
}
