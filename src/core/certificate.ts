// Pure S-ARM-01 core (P7): the versioned configuration field classification,
// the role-neutral policy digest and the runtime digest, the extraction of
// certificate evidence from journal entries plus the driver's broker
// observations, the PASS/FAIL evaluation, and the arming-time validation of a
// certificate against the deployment's digests. Everything is a decision over
// data the shell hands in; the shell reads files, hashes nothing itself, and
// writes the certificate the core produced.
import type { BrokerOrderRecord, BrokerPosition } from "./execution.js";
import type { JournalEntry } from "./journal.js";
import { sha256Text } from "./sha256.js";

type Raw = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Field classification (versioned; every known field has exactly one class)
// ---------------------------------------------------------------------------

export const CONFIG_FIELD_CLASSIFICATION_VERSION = 1;

export type ConfigFieldClass = "policy" | "identity" | "deployment";

/**
 * The closed classification. `identity` is the S-ARM-01 exclusion set
 * (`ALPACA_PROFILE`, `EXPECTED_ACCOUNT_ID`; credentials never enter the
 * config record at all). `deployment` names the host-local locations that
 * differ between the dev run and the competition deployment on purpose
 * (DECISIONS.md P7: the competition journal must not inherit the dev journal,
 * so `STATE_DIR` cannot be policy). Everything else is role-neutral policy.
 */
export function configFieldClassification(): Readonly<Record<string, ConfigFieldClass>> {
  return {
    ALPACA_PROFILE: "identity",
    EXPECTED_ACCOUNT_ID: "identity",
    STATE_DIR: "deployment",
    BOOTSTRAP_DIAGNOSTIC_SINK: "deployment",
    PRE_ARM_CERTIFICATE: "deployment",
    ALPACA_TRADING_ORIGIN: "policy",
    INCOME_BUDGET_CENTS: "policy",
    CONVEX_BUDGET_CENTS: "policy",
    INITIAL_CAPITAL_CENTS: "policy",
    MAX_LOSS_PER_POSITION_BPS: "policy",
    MAX_UNDERLYING_EXPOSURE_CENTS: "policy",
    MAX_REL_SPREAD_BPS: "policy",
    MIN_QUOTE_SIZE: "policy",
    QUOTE_MAX_AGE_MS: "policy",
    SNAPSHOT_STALENESS_BOUND_MS: "policy",
    KILL_EQUITY_THRESHOLD_CENTS: "policy",
    DEAD_MAN_BOUND_MS: "policy",
    ALERT_DELIVERY_BUDGET_MS: "policy",
    CYCLE_INTERVAL_MS: "policy",
    UNDERLYING_UNIVERSE: "policy",
    STRUCTURE_WHITELIST: "policy",
    EXPIRY_MIN_SESSIONS: "policy",
    EXPIRY_MAX_SESSIONS: "policy",
    MAX_STRIKE_DISTANCE_BPS: "policy",
    MAX_CANDIDATE_QTY: "policy",
    LIMIT_TOLERANCE_CENTS: "policy",
    CLOSE_ESCALATION_STEP_CENTS: "policy",
    RESIDUE_MAX_SESSIONS: "policy",
    ANALYST_TIMEOUT_MS: "policy",
    CYCLE_WALLTIME_BUDGET_MS: "policy",
    LOCK_TAKEOVER_BOUND_MS: "policy",
    ANALYST_MCP_CAPABILITY_MANIFEST: "policy",
    ANALYST_MCP_RUNTIME_LOCK: "policy",
    ANALYST_ALPACA_PROFILE: "policy",
    QUALIFYING_ACTIVITY_CHECKPOINT: "policy",
    QUALIFICATION_WINDOW_END: "policy",
    QUALIFICATION_MAX_LOSS_CENTS: "policy",
    COMPETITION_START: "policy",
    FLATTEN_DATE: "policy",
    SHORT_ASSIGNMENT_CAPABILITY: "policy",
  };
}

export type ClassifiedConfig =
  | { readonly ok: true; readonly policy: Raw; readonly identity: Raw; readonly deployment: Raw }
  | { readonly ok: false; readonly unknownFields: readonly string[] };

/** Unknown fields are rejected, never silently assigned (WIN-17): a field the schema does not name cannot enter or escape the digest. */
export function classifyConfig(raw: Raw): ClassifiedConfig {
  const classification = configFieldClassification();
  const policy: Record<string, unknown> = {};
  const identity: Record<string, unknown> = {};
  const deployment: Record<string, unknown> = {};
  const unknownFields: string[] = [];
  for (const field of Object.keys(raw)) {
    const kind = Object.hasOwn(classification, field) ? classification[field] : undefined;
    if (kind === undefined) unknownFields.push(field);
    else if (kind === "policy") policy[field] = raw[field];
    else if (kind === "identity") identity[field] = raw[field];
    else deployment[field] = raw[field];
  }
  if (unknownFields.length > 0) return { ok: false, unknownFields };
  return { ok: true, policy, identity, deployment };
}

/** True when a value tree contains `undefined` anywhere: such material has no canonical form and is refused, never coerced to null. */
export function containsUndefined(value: unknown): boolean {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.some(containsUndefined);
  if (isRecord(value)) return Object.values(value).some(containsUndefined);
  return false;
}

/** Canonical JSON: object keys sorted recursively, arrays in order, no whitespace. Throws on `undefined` (callers refuse first). */
export function canonicalJson(value: unknown): string {
  if (value === undefined) throw new RangeError("undefined has no canonical JSON form");
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export type DigestResult = { readonly ok: true; readonly digest: string; readonly material: string } | { readonly ok: false; readonly reason: string };

/** The role-neutral policy digest: version + every policy field, canonical, hashed. Identity and deployment fields never enter. */
export function policyDigest(raw: Raw, expectations: { readonly canonicalTradingOrigin: string }): DigestResult {
  const classified = classifyConfig(raw);
  if (!classified.ok) return { ok: false, reason: `unknown configuration field(s): ${classified.unknownFields.join(", ")}` };
  const origin = classified.policy["ALPACA_TRADING_ORIGIN"];
  if (origin !== expectations.canonicalTradingOrigin) return { ok: false, reason: "the policy origin is not the canonical paper trading origin" };
  if (containsUndefined(classified.policy)) return { ok: false, reason: "a policy field has no value; undefined never enters the digest" };
  const material = canonicalJson({ fieldClassificationVersion: CONFIG_FIELD_CLASSIFICATION_VERSION, policy: classified.policy });
  return { ok: true, digest: sha256Text(material), material };
}

export interface RuntimeDigestInput {
  /** Repository-relative path and the SHA-256 of the LF-normalized content, for every executable/schema/lock file. */
  readonly files: readonly { readonly path: string; readonly sha256: string }[];
  readonly analystRuntime: {
    readonly lockSha256: string;
    readonly manifestSha256: string;
    readonly sourceRepository: string;
    readonly sourceCommit: string;
    readonly packageName: string;
    readonly packageVersion: string;
    readonly interpreterLauncherSha256: string;
    readonly interpreterRuntimeSha256: string;
    /** Digest over every verified immutable launch artifact (the installed package files), computed by the shell over content. */
    readonly launchArtifactsSha256: string;
  };
}

function isUtcIso(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export function runtimeDigest(input: RuntimeDigestInput): DigestResult {
  if (input.files.length === 0) return { ok: false, reason: "no executable files were enumerated" };
  const paths = new Set<string>();
  for (const file of input.files) {
    if (paths.has(file.path)) return { ok: false, reason: `duplicate file path: ${file.path}` };
    if (!isSha256(file.sha256)) return { ok: false, reason: `malformed digest for ${file.path}` };
    paths.add(file.path);
  }
  const runtime = input.analystRuntime;
  const digests: Readonly<Record<string, string>> = { lockSha256: runtime.lockSha256, manifestSha256: runtime.manifestSha256, interpreterLauncherSha256: runtime.interpreterLauncherSha256, interpreterRuntimeSha256: runtime.interpreterRuntimeSha256, launchArtifactsSha256: runtime.launchArtifactsSha256 };
  for (const [name, value] of Object.entries(digests)) {
    if (!isSha256(value)) return { ok: false, reason: `malformed analyst runtime digest: ${name}` };
  }
  if (containsUndefined(runtime) || Object.values(runtime).some(value => typeof value !== "string" || value.length === 0)) return { ok: false, reason: "every analyst runtime identity field must be a non-empty string" };
  const files = [...input.files].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const material = canonicalJson({ version: 1, files, analystRuntime: runtime });
  return { ok: true, digest: sha256Text(material), material };
}

// ---------------------------------------------------------------------------
// Certificate schema
// ---------------------------------------------------------------------------

export const CERTIFICATE_SCHEMA_VERSION = 1;

export interface LiquidityInputEvidence {
  readonly contractId: string;
  readonly bidCents: number;
  readonly askCents: number;
  readonly bidSize: number;
  readonly askSize: number;
  readonly quotedAt: string;
  readonly brokerQuotedAt: string;
  /** The CYCLE entry whose snapshot carried this sample into the gate. */
  readonly snapshotSeq: number;
}

export interface CreditAcceptanceEvidence {
  readonly clientOrderId: string;
  readonly exposureLifecycleId: string;
  readonly intentSeq: number;
  readonly brokerOrderId: string;
  readonly acceptedStatus: string;
  readonly acceptedAt: string;
  readonly terminalStatus: "filled" | "canceled";
  readonly terminalAt: string;
  readonly outcomeSeq: number;
  readonly harnessRequestedCancel: boolean;
}

export interface FillEvidence {
  readonly clientOrderId: string;
  readonly brokerOrderId: string;
  readonly filledQuantity: number;
  readonly avgFillPriceCents: number;
  readonly filledAt: string;
  readonly outcomeSeq: number;
  /** The later snapshot-bearing entry whose broker positions reflect the filled legs. */
  readonly reconciledSnapshotSeq: number;
}

export interface FenceDrillEvidence {
  readonly httpStatus: number;
  readonly haltSeq: number;
  readonly unhaltSeq: number;
  readonly workingOrdersAtFence: readonly string[];
  readonly canceledAtFence: readonly string[];
}

export interface FinalSnapshotEvidence {
  readonly at: string;
  readonly accountId: string;
  readonly cashCents: number;
  readonly equityCents: number;
  readonly positionCount: number;
  readonly nonTerminalOrderCount: number;
  readonly orderPagesFetched: number;
  readonly pagesComplete: boolean;
}

export interface PreArmCertificate {
  readonly schemaVersion: 1;
  readonly verdict: "PASS" | "FAIL";
  readonly role: "dev";
  readonly accountId: string;
  readonly tradingOrigin: string;
  readonly window: { readonly startedAt: string; readonly endedAt: string };
  readonly runtimeDigest: string;
  readonly policyDigest: string;
  readonly fieldClassificationVersion: number;
  readonly mcpInventoryAccepted: boolean;
  readonly evidence: {
    readonly liquidity: readonly LiquidityInputEvidence[];
    readonly creditAcceptance: CreditAcceptanceEvidence | null;
    readonly fill: FillEvidence | null;
    readonly fence: FenceDrillEvidence | null;
    readonly finalSnapshot: FinalSnapshotEvidence | null;
  };
  readonly failures: readonly string[];
}

/** `successful_dev_live_test_at`: exists only inside a PASS certificate (S-ARM-01). */
export function successfulDevLiveTestAt(certificate: PreArmCertificate): string | null {
  return certificate.verdict === "PASS" ? certificate.window.endedAt : null;
}

// ---------------------------------------------------------------------------
// Evidence extraction from the journal and the driver's broker observations
// ---------------------------------------------------------------------------

export interface OrderObservation {
  readonly observedAt: string;
  readonly order: BrokerOrderRecord;
}

export interface FenceObservation {
  readonly httpStatus: number;
  readonly workingOrdersAtFence: readonly string[];
  readonly canceledAtFence: readonly string[];
}

export interface FinalSnapshotObservation {
  readonly at: string;
  readonly accountId: string;
  readonly cashCents: number;
  readonly equityCents: number;
  readonly positions: readonly BrokerPosition[];
  readonly nonTerminalOrders: readonly string[];
  readonly orderPagesFetched: number;
  readonly pagesComplete: boolean;
}

export interface CertificateInputs {
  readonly accountId: string;
  readonly tradingOrigin: string;
  readonly canonicalTradingOrigin: string;
  readonly window: { readonly startedAt: string; readonly endedAt: string };
  readonly runtimeDigest: string;
  readonly policyDigest: string;
  readonly mcpInventoryAccepted: boolean;
  readonly journal: readonly JournalEntry[];
  readonly orderObservations: readonly OrderObservation[];
  readonly harnessCancels: readonly string[];
  readonly fence: FenceObservation | null;
  readonly finalSnapshot: FinalSnapshotObservation | null;
}

/**
 * The broker states that prove acceptance. A `filled` or `partially_filled`
 * record proves it too: the broker cannot fill what it did not accept, and a
 * fast fill can precede the driver's first observation (DECISIONS.md P7).
 */
function positiveAcceptanceStatuses(): readonly string[] {
  return ["new", "accepted", "open", "pending_new", "partially_filled", "filled"];
}

function legsOf(entry: JournalEntry): readonly { readonly contractId: string; readonly side: string }[] {
  const legs = entry["legs"];
  if (!Array.isArray(legs)) return [];
  return legs.flatMap(leg => (isRecord(leg) && typeof leg["contractId"] === "string" && typeof leg["side"] === "string" ? [{ contractId: leg["contractId"], side: leg["side"] }] : []));
}

function snapshotOf(entry: JournalEntry): Raw | null {
  const snapshot = entry["snapshot"];
  return isRecord(snapshot) ? snapshot : null;
}

function gatePassed(entry: JournalEntry, gate: string): boolean {
  const vector = entry["gateVector"];
  if (!Array.isArray(vector)) return false;
  return vector.some(item => isRecord(item) && item["gate"] === gate && item["passed"] === true);
}

function isEntryIntent(entry: JournalEntry): boolean {
  return entry.type === "INTENT" && (entry["action"] === "entry" || entry["action"] === undefined);
}

function liquidityFor(entry: JournalEntry, journal: readonly JournalEntry[]): readonly LiquidityInputEvidence[] {
  // The CYCLE/BOOTSTRAP entry immediately preceding the INTENT in the same invocation carries the snapshot the gate consumed.
  const preceding = journal.filter(item => item.seq < entry.seq && (item.type === "CYCLE" || item.type === "BOOTSTRAP") && snapshotOf(item) !== null).sort((a, b) => b.seq - a.seq)[0];
  if (preceding === undefined) return [];
  const samples = snapshotOf(preceding)?.["quoteSamples"];
  if (!isRecord(samples)) return [];
  const out: LiquidityInputEvidence[] = [];
  const covered = new Set<string>();
  for (const leg of legsOf(entry)) {
    if (covered.has(leg.contractId)) continue;
    for (const byContract of Object.values(samples)) {
      if (!isRecord(byContract) || covered.has(leg.contractId)) continue;
      const sample = byContract[leg.contractId];
      if (!isRecord(sample)) continue;
      const { bidCents, askCents, bidSize, askSize, quotedAt, brokerQuotedAt } = sample;
      if (typeof bidCents === "number" && typeof askCents === "number" && typeof bidSize === "number" && typeof askSize === "number" && typeof quotedAt === "string" && typeof brokerQuotedAt === "string") {
        out.push({ contractId: leg.contractId, bidCents, askCents, bidSize, askSize, quotedAt, brokerQuotedAt, snapshotSeq: preceding.seq });
        covered.add(leg.contractId);
      }
    }
  }
  return out;
}

function creditAcceptanceFrom(inputs: CertificateInputs, failures: string[]): CreditAcceptanceEvidence | null {
  const intents = inputs.journal.filter(entry => isEntryIntent(entry) && isRecord(entry["submittedLimit"]) && entry["submittedLimit"]["kind"] === "credit");
  if (intents.length === 0) {
    failures.push("no credit entry INTENT was journaled");
    return null;
  }
  for (const intent of intents) {
    const clientOrderId = intent["clientOrderId"];
    if (typeof clientOrderId !== "string") continue;
    const observations = inputs.orderObservations.filter(item => item.order.clientOrderId === clientOrderId);
    const accepted = observations.find(item => positiveAcceptanceStatuses().includes(item.order.status));
    const outcome = inputs.journal.filter(entry => entry.type === "OUTCOME" && entry["clientOrderId"] === clientOrderId).sort((a, b) => b.seq - a.seq)[0];
    if (outcome !== undefined && outcome["status"] === "rejected") {
      failures.push(`credit lifecycle ${clientOrderId} was rejected by the broker`);
      return null;
    }
    if (accepted === undefined || outcome === undefined) continue;
    const terminal = outcome["status"];
    if (terminal !== "filled" && terminal !== "canceled") continue;
    const harnessRequestedCancel = inputs.harnessCancels.includes(clientOrderId);
    if (terminal === "canceled" && !harnessRequestedCancel) {
      failures.push(`credit lifecycle ${clientOrderId} was canceled without a harness request`);
      return null;
    }
    const brokerOrderId = typeof outcome["brokerOrderId"] === "string" ? outcome["brokerOrderId"] : accepted.order.brokerOrderId;
    const timestamps = isRecord(outcome["brokerTimestamps"]) ? outcome["brokerTimestamps"] : {};
    const terminalField = terminal === "filled" ? "filled_at" : "canceled_at";
    const terminalAt = typeof timestamps[terminalField] === "string" ? timestamps[terminalField] : outcome.at;
    const acceptedAt = accepted.order.brokerTimestamps["submitted_at"] ?? accepted.observedAt;
    if (!(acceptedAt <= terminalAt)) {
      failures.push(`credit lifecycle ${clientOrderId}: the acceptance instant ${acceptedAt} does not precede the terminal instant ${terminalAt}`);
      return null;
    }
    return {
      clientOrderId,
      exposureLifecycleId: typeof intent["exposureLifecycleId"] === "string" ? intent["exposureLifecycleId"] : "",
      intentSeq: intent.seq,
      brokerOrderId,
      acceptedStatus: accepted.order.status,
      acceptedAt,
      terminalStatus: terminal,
      terminalAt,
      outcomeSeq: outcome.seq,
      harnessRequestedCancel,
    };
  }
  failures.push("no credit entry lifecycle reached a positive broker acceptance followed by a filled or harness-canceled OUTCOME");
  return null;
}

function fillFrom(inputs: CertificateInputs, failures: string[]): FillEvidence | null {
  const fills = inputs.journal.filter(entry => entry.type === "OUTCOME" && entry["status"] === "filled" && typeof entry["filledQuantity"] === "number" && entry["filledQuantity"] > 0 && typeof entry["avgFillPriceCents"] === "number");
  for (const fill of fills) {
    const clientOrderId = fill["clientOrderId"];
    if (typeof clientOrderId !== "string") continue;
    const intent = inputs.journal.find(entry => isEntryIntent(entry) && entry["clientOrderId"] === clientOrderId);
    if (intent === undefined) continue;
    const legs = legsOf(intent);
    if (legs.length === 0) continue;
    // Reconciliation: a later snapshot-bearing entry whose broker positions carry every filled leg with a non-zero quantity.
    const later = inputs.journal.filter(entry => entry.seq > fill.seq && snapshotOf(entry) !== null).find(entry => {
      const positions = snapshotOf(entry)?.["positions"];
      if (!Array.isArray(positions)) return false;
      return legs.every(leg => positions.some(position => isRecord(position) && position["contractId"] === leg.contractId && typeof position["quantity"] === "number" && position["quantity"] !== 0));
    });
    if (later === undefined) continue;
    const timestamps = isRecord(fill["brokerTimestamps"]) ? fill["brokerTimestamps"] : {};
    return {
      clientOrderId,
      brokerOrderId: typeof fill["brokerOrderId"] === "string" ? fill["brokerOrderId"] : "",
      filledQuantity: fill["filledQuantity"] as number,
      avgFillPriceCents: fill["avgFillPriceCents"] as number,
      filledAt: typeof timestamps["filled_at"] === "string" ? timestamps["filled_at"] : fill.at,
      outcomeSeq: fill.seq,
      reconciledSnapshotSeq: later.seq,
    };
  }
  failures.push("no minimal defined-risk entry was filled and reconciled through a later broker snapshot");
  return null;
}

function fenceFrom(inputs: CertificateInputs, failures: string[]): FenceDrillEvidence | null {
  if (inputs.fence === null) {
    failures.push("the credential-fence drill was not performed");
    return null;
  }
  if (inputs.fence.httpStatus !== 401 && inputs.fence.httpStatus !== 403) failures.push(`the fence drill observed HTTP ${String(inputs.fence.httpStatus)}, not a 401/403 credential rejection`);
  const halt = inputs.journal.find(entry => entry.type === "HALT" && entry["reason"] === "AUTH_FAILURE");
  if (halt === undefined) {
    failures.push("no AUTH_FAILURE halt was journaled by the fence drill");
    return null;
  }
  const unhalt = inputs.journal.find(entry => entry.type === "UNHALT" && entry.seq > halt.seq);
  if (unhalt === undefined) {
    failures.push("the AUTH_FAILURE halt was not cleared by the documented fence procedure (manual un-halt after reconciliation)");
    return null;
  }
  return { httpStatus: inputs.fence.httpStatus, haltSeq: halt.seq, unhaltSeq: unhalt.seq, workingOrdersAtFence: inputs.fence.workingOrdersAtFence, canceledAtFence: inputs.fence.canceledAtFence };
}

function finalSnapshotFrom(inputs: CertificateInputs, failures: string[]): FinalSnapshotEvidence | null {
  const snapshot = inputs.finalSnapshot;
  if (snapshot === null) {
    failures.push("no final fully paginated dev snapshot was taken");
    return null;
  }
  const evidence: FinalSnapshotEvidence = {
    at: snapshot.at,
    accountId: snapshot.accountId,
    cashCents: snapshot.cashCents,
    equityCents: snapshot.equityCents,
    positionCount: snapshot.positions.filter(position => position.quantity !== 0).length,
    nonTerminalOrderCount: snapshot.nonTerminalOrders.length,
    orderPagesFetched: snapshot.orderPagesFetched,
    pagesComplete: snapshot.pagesComplete,
  };
  if (snapshot.accountId !== inputs.accountId) failures.push("the final snapshot reports a different account than the certificate binds");
  if (!snapshot.pagesComplete) failures.push("the final order history pagination is incomplete");
  if (evidence.positionCount !== 0) failures.push(`the final snapshot holds ${String(evidence.positionCount)} open position(s)`);
  if (evidence.nonTerminalOrderCount !== 0) failures.push(`the final snapshot holds ${String(evidence.nonTerminalOrderCount)} non-terminal order(s)`);
  return evidence;
}

/** Build the certificate: every S-ARM-01 clause is either evidenced or named as a failure; the verdict is PASS only with zero failures. */
export function buildCertificate(inputs: CertificateInputs): PreArmCertificate {
  const failures: string[] = [];
  if (inputs.tradingOrigin !== inputs.canonicalTradingOrigin) failures.push("the trading origin is not the canonical paper origin");
  if (inputs.accountId.length === 0) failures.push("the dev account ID is empty");
  if (!inputs.mcpInventoryAccepted) failures.push("the pinned MCP runtime/inventory verification did not pass");
  if (!(inputs.window.startedAt < inputs.window.endedAt)) failures.push("the test window is not ordered");
  if (!isSha256(inputs.runtimeDigest)) failures.push("runtimeDigest is malformed");
  if (!isSha256(inputs.policyDigest)) failures.push("policyDigest is malformed");
  for (const entry of inputs.journal) {
    if (entry.type === "OUTCOME" && entry["status"] === "rejected") failures.push(`OUTCOME seq ${String(entry.seq)} (${String(entry["clientOrderId"])}) is a broker rejection`);
  }

  const creditAcceptance = creditAcceptanceFrom(inputs, failures);
  const fill = fillFrom(inputs, failures);
  const intentForLiquidity = creditAcceptance === null ? undefined : inputs.journal.find(entry => entry.seq === creditAcceptance.intentSeq);
  const liquidity = intentForLiquidity === undefined ? [] : liquidityFor(intentForLiquidity, inputs.journal);
  if (intentForLiquidity !== undefined) {
    if (!gatePassed(intentForLiquidity, "G5")) failures.push("the credit INTENT does not carry a passed G5 liquidity verdict");
    const legIds = new Set(legsOf(intentForLiquidity).map(leg => leg.contractId));
    if ([...legIds].some(id => !liquidity.some(item => item.contractId === id))) failures.push("the snapshot consumed by the liquidity gate lacks a quote sample with sizes and timestamps for every credit leg");
  }
  const fence = fenceFrom(inputs, failures);
  const finalSnapshot = finalSnapshotFrom(inputs, failures);
  return {
    schemaVersion: CERTIFICATE_SCHEMA_VERSION,
    verdict: failures.length === 0 ? "PASS" : "FAIL",
    role: "dev",
    accountId: inputs.accountId,
    tradingOrigin: inputs.tradingOrigin,
    window: inputs.window,
    runtimeDigest: inputs.runtimeDigest,
    policyDigest: inputs.policyDigest,
    fieldClassificationVersion: CONFIG_FIELD_CLASSIFICATION_VERSION,
    mcpInventoryAccepted: inputs.mcpInventoryAccepted,
    evidence: { liquidity, creditAcceptance, fill, fence, finalSnapshot },
    failures,
  };
}

// ---------------------------------------------------------------------------
// Arming-time validation (S-CYC-11 competition path: WIN-7, WIN-10, WIN-17)
// ---------------------------------------------------------------------------

export interface ArmingExpectations {
  readonly runtimeDigest: string;
  readonly policyDigest: string;
  readonly canonicalTradingOrigin: string;
}

export type CertificateValidation = { readonly ok: true; readonly successfulDevLiveTestAt: string } | { readonly ok: false; readonly violations: readonly string[] };

function certificateKeys(): readonly string[] {
  return ["schemaVersion", "verdict", "role", "accountId", "tradingOrigin", "window", "runtimeDigest", "policyDigest", "fieldClassificationVersion", "mcpInventoryAccepted", "evidence", "failures"];
}

/** A certificate is trusted only as a whole: exact schema, PASS, dev role, canonical origin, and both digests equal to the deployment's own. */
export function validateArmingCertificate(raw: unknown, expectations: ArmingExpectations): CertificateValidation {
  const violations: string[] = [];
  if (!isRecord(raw)) return { ok: false, violations: ["certificate is not an object"] };
  const keys = Object.keys(raw).sort();
  const expectedKeys = [...certificateKeys()].sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) violations.push("certificate schema mismatch: unexpected or missing fields");
  if (raw["schemaVersion"] !== CERTIFICATE_SCHEMA_VERSION) violations.push("certificate schemaVersion is not supported");
  if (raw["verdict"] !== "PASS") violations.push("certificate verdict is not PASS");
  if (raw["role"] !== "dev") violations.push("certificate role is not the dev role");
  if (raw["tradingOrigin"] !== expectations.canonicalTradingOrigin) violations.push("certificate origin is not the canonical paper origin");
  if (raw["fieldClassificationVersion"] !== CONFIG_FIELD_CLASSIFICATION_VERSION) violations.push("certificate field-classification version differs from this build");
  if (raw["mcpInventoryAccepted"] !== true) violations.push("certificate does not record an accepted MCP inventory");
  if (raw["runtimeDigest"] !== expectations.runtimeDigest) violations.push("runtimeDigest mismatch: a covered runtime change invalidates the certificate");
  if (raw["policyDigest"] !== expectations.policyDigest) violations.push("policyDigest mismatch: a role-neutral policy change invalidates the certificate");
  if (typeof raw["accountId"] !== "string" || raw["accountId"].length === 0) violations.push("certificate account ID is malformed");
  const window = raw["window"];
  const startedAt = isRecord(window) && isUtcIso(window["startedAt"]) ? window["startedAt"] : null;
  const endedAt = isRecord(window) && isUtcIso(window["endedAt"]) ? window["endedAt"] : null;
  if (startedAt === null || endedAt === null || !(startedAt < endedAt) || (isRecord(window) && Object.keys(window).length !== 2)) violations.push("certificate window is malformed");
  if (!Array.isArray(raw["failures"])) violations.push("certificate failures is not an array");
  else if (raw["failures"].length > 0) violations.push("certificate carries failures");
  const evidence = raw["evidence"];
  if (!isRecord(evidence) || Object.keys(evidence).sort().join(",") !== "creditAcceptance,fence,fill,finalSnapshot,liquidity") violations.push("certificate evidence is malformed");
  else {
    if (!Array.isArray(evidence["liquidity"]) || evidence["liquidity"].length === 0 || !evidence["liquidity"].every(isRecord)) violations.push("certificate liquidity evidence is absent");
    for (const clause of ["creditAcceptance", "fill", "fence", "finalSnapshot"]) if (!isRecord(evidence[clause])) violations.push(`certificate ${clause} evidence is absent`);
  }
  if (violations.length > 0 || endedAt === null) return { ok: false, violations };
  return { ok: true, successfulDevLiveTestAt: endedAt };
}
