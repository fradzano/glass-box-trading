import { integerUnit, lotCount } from "./domain.js";
import type {
  AnalystBatch,
  CandidateVerdict,
  DecisionConfig,
  DecisionResult,
  DecisionSnapshot,
  EntryActionPlan,
  EntryCandidate,
  ExposureRiskComponent,
  GateVerdict,
  MoneyCents,
  OptionLeg,
  OptionPriceCents,
  OptionQuote,
  Quantity,
  Sleeve,
} from "./domain.js";
import { entryClientOrderId } from "./order-identity.js";

interface DefinedRiskResult {
  readonly maxLossCents: MoneyCents | null;
  readonly reasons: readonly string[];
}

interface CandidateEvaluation {
  readonly verdict: CandidateVerdict;
  readonly action: EntryActionPlan | null;
}

function asMoneyCents(value: number): MoneyCents {
  if (value < 0) throw new RangeError("MoneyCents cannot be negative");
  return integerUnit(value, "MoneyCents");
}

function sameContractShape(legs: readonly OptionLeg[]): boolean {
  const first = legs[0];
  return first !== undefined && legs.every(optionLeg =>
    optionLeg.underlying === first.underlying
    && optionLeg.expiry === first.expiry,
  );
}

function hasUnitRatios(legs: readonly OptionLeg[]): boolean {
  return legs.every(optionLeg => optionLeg.ratio === 1);
}

type ExpiryPayoffBound =
  | { readonly kind: "bounded"; readonly maxLossPerShareCents: bigint }
  | { readonly kind: "unbounded" };

/**
 * Exact expiry payoff of a unit-ratio option structure. P&L is piecewise linear
 * in the underlying price, so its minimum lies at price zero, at a strike, or
 * at infinity; a negative slope beyond the highest strike means unbounded loss.
 * This single evaluation is the source of truth for every reserved maximum
 * loss; the declared-structure checks only constrain which patterns may pass.
 */
function expiryPayoffBound(legs: readonly OptionLeg[], entryLimit: EntryCandidate["entryLimit"], priceCents: number): ExpiryPayoffBound {
  const premium = entryLimit.kind === "debit" ? -BigInt(priceCents) : BigInt(priceCents);
  const slopeBeyondHighestStrike = legs.reduce(
    (slope, optionLeg) => optionLeg.right === "call" ? slope + (optionLeg.side === "buy" ? 1n : -1n) * BigInt(optionLeg.ratio) : slope,
    0n,
  );
  if (slopeBeyondHighestStrike < 0n) return { kind: "unbounded" };
  const breakpoints = [0n, ...legs.map(optionLeg => BigInt(optionLeg.strikeCents))];
  let minimumPnl: bigint | null = null;
  for (const spot of breakpoints) {
    const pnl = legs.reduce((total, optionLeg) => {
      const strike = BigInt(optionLeg.strikeCents);
      const intrinsic = optionLeg.right === "call" ? (spot > strike ? spot - strike : 0n) : (strike > spot ? strike - spot : 0n);
      return total + (optionLeg.side === "buy" ? intrinsic : -intrinsic) * BigInt(optionLeg.ratio);
    }, premium);
    minimumPnl = minimumPnl === null || pnl < minimumPnl ? pnl : minimumPnl;
  }
  return { kind: "bounded", maxLossPerShareCents: minimumPnl === null || minimumPnl >= 0n ? 0n : -minimumPnl };
}

function reserveFromPayoff(legs: readonly OptionLeg[], entryLimit: EntryCandidate["entryLimit"], priceCents: number, quantity: number, structure: string): DefinedRiskResult {
  const bound = expiryPayoffBound(legs, entryLimit, priceCents);
  if (bound.kind === "unbounded") return { maxLossCents: null, reasons: [`${structure} leg pattern has unbounded loss`] };
  const product = bound.maxLossPerShareCents * 100n * BigInt(quantity);
  return product <= 9_007_199_254_740_991n
    ? { maxLossCents: asMoneyCents(Number(product)), reasons: [] }
    : { maxLossCents: null, reasons: [`${structure} maximum loss exceeds the exact integer range`] };
}

function definedRisk(candidate: EntryCandidate, quantity: number = candidate.quantity, priceCents: number = candidate.entryLimit.priceCents): DefinedRiskResult {
  const duplicateContract = new Set(candidate.legs.map(optionLeg => optionLeg.contractId)).size !== candidate.legs.length;
  if (duplicateContract) return { maxLossCents: null, reasons: ["degenerate structure repeats a contract"] };
  if (!hasUnitRatios(candidate.legs)) return { maxLossCents: null, reasons: ["non-unit leg ratio can leave a net short side"] };
  if (!sameContractShape(candidate.legs)) return { maxLossCents: null, reasons: ["legs do not share underlying and expiry"] };

  if (candidate.declaredStructureType === "long_option") {
    if (candidate.legs.length !== 1 || candidate.legs[0]?.side !== "buy" || candidate.entryLimit.kind !== "debit") {
      return { maxLossCents: null, reasons: ["long option must contain one buy leg and a debit limit"] };
    }
    return reserveFromPayoff(candidate.legs, candidate.entryLimit, priceCents, quantity, "long-option");
  }

  if (candidate.declaredStructureType === "vertical_debit" || candidate.declaredStructureType === "vertical_credit") {
    if (candidate.legs.length !== 2) return { maxLossCents: null, reasons: ["vertical must contain exactly two legs"] };
    const [first, second] = candidate.legs;
    if (first === undefined || second === undefined || first.right !== second.right || first.side === second.side) {
      return { maxLossCents: null, reasons: ["vertical must contain one buy and one sell of the same option right"] };
    }
    const widthCents = Math.abs(first.strikeCents - second.strikeCents);
    if (widthCents === 0) return { maxLossCents: null, reasons: ["vertical width must be positive"] };
    const longLeg = first.side === "buy" ? first : second;
    const shortLeg = first.side === "sell" ? first : second;
    const isLongPayoff = first.right === "call"
      ? longLeg.strikeCents < shortLeg.strikeCents
      : longLeg.strikeCents > shortLeg.strikeCents;
    if (candidate.declaredStructureType === "vertical_debit" && candidate.entryLimit.kind === "debit" && isLongPayoff) {
      return reserveFromPayoff(candidate.legs, candidate.entryLimit, priceCents, quantity, "vertical");
    }
    if (candidate.declaredStructureType === "vertical_credit" && candidate.entryLimit.kind === "credit" && !isLongPayoff && priceCents <= widthCents) {
      return reserveFromPayoff(candidate.legs, candidate.entryLimit, priceCents, quantity, "vertical");
    }
    return { maxLossCents: null, reasons: ["vertical leg direction, limit kind, or credit is incompatible with its declared payoff"] };
  }

  if (candidate.declaredStructureType === "iron_condor") {
    if (candidate.legs.length !== 4 || candidate.entryLimit.kind !== "credit") {
      return { maxLossCents: null, reasons: ["iron condor requires four legs and a credit limit"] };
    }
    const puts = candidate.legs.filter(optionLeg => optionLeg.right === "put").sort((left, right) => left.strikeCents - right.strikeCents);
    const calls = candidate.legs.filter(optionLeg => optionLeg.right === "call").sort((left, right) => left.strikeCents - right.strikeCents);
    if (puts.length !== 2 || calls.length !== 2 || puts[0]?.side !== "buy" || puts[1]?.side !== "sell" || calls[0]?.side !== "sell" || calls[1]?.side !== "buy") {
      return { maxLossCents: null, reasons: ["iron condor legs do not cap both wings"] };
    }
    if (puts[1].strikeCents >= calls[0].strikeCents) return { maxLossCents: null, reasons: ["iron condor wings overlap: the short put must lie below the short call"] };
    const putWidth = puts[1].strikeCents - puts[0].strikeCents;
    const callWidth = calls[1].strikeCents - calls[0].strikeCents;
    const widestWing = Math.max(putWidth, callWidth);
    if (widestWing <= 0 || priceCents > widestWing) return { maxLossCents: null, reasons: ["iron condor credit exceeds the widest wing"] };
    return reserveFromPayoff(candidate.legs, candidate.entryLimit, priceCents, quantity, "iron-condor");
  }

  return { maxLossCents: null, reasons: ["maximum loss is not computable from the leg pattern"] };
}

function countedRisk(component: ExposureRiskComponent): bigint {
  if (component.kind === "exit") return 0n;
  if (component.kind === "filled") return BigInt(component.maxLossCents);
  // Fail closed: only an explicitly released reservation stops counting.
  return component.state === "rejected" || component.state === "canceled" || component.state === "expired"
    ? 0n
    : BigInt(component.maxLossCents);
}

function riskBySleeve(snapshot: DecisionSnapshot, sleeve: Sleeve): bigint | null {
  const components = snapshot.exposureLifecycles
    .filter(lifecycle => lifecycle.sleeve === sleeve)
    .flatMap(lifecycle => lifecycle.risk);
  if (components.some(component => !Number.isSafeInteger(component.maxLossCents) || component.maxLossCents < 0)) return null;
  return components.reduce((total, component) => total + countedRisk(component), 0n);
}

function riskByUnderlying(snapshot: DecisionSnapshot, underlying: string): bigint | null {
  const components = snapshot.exposureLifecycles
    .filter(lifecycle => lifecycle.underlying === underlying)
    .flatMap(lifecycle => lifecycle.risk);
  if (components.some(component => !Number.isSafeInteger(component.maxLossCents) || component.maxLossCents < 0)) return null;
  return components.reduce((total, component) => total + countedRisk(component), 0n);
}

function verdict(gate: GateVerdict["gate"], code: GateVerdict["code"], reasons: readonly string[]): GateVerdict {
  return { gate, passed: reasons.length === 0, code: reasons.length === 0 ? "PASS" : code, reasons };
}

function ownRecordValue<Value>(record: Readonly<Record<string, Value>>, key: string): Value | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function isRuntimeOptionQuote(value: unknown): value is OptionQuote {
  if (!isRecord(value)) return false;
  return [value["bidCents"], value["askCents"], value["bidSize"], value["askSize"], value["quotedAt"]]
    .every(field => isSafeInteger(field) && field >= 0);
}

function quoteFor(snapshot: DecisionSnapshot, contractId: string): OptionQuote | undefined {
  const value = ownRecordValue(snapshot.quotesByContract, contractId);
  return isRuntimeOptionQuote(value) ? value : undefined;
}

function evaluateLiquidity(candidate: EntryCandidate, snapshot: DecisionSnapshot, config: DecisionConfig, now: number): GateVerdict {
  const reasons: string[] = [];
  for (const optionLeg of candidate.legs) {
    const optionQuote = quoteFor(snapshot, optionLeg.contractId);
    if (optionQuote === undefined) {
      reasons.push(`${optionLeg.contractId}: missing quote`);
      continue;
    }
    if (optionQuote.bidCents <= 0) reasons.push(`${optionLeg.contractId}: bid is not positive`);
    if (optionQuote.askCents < optionQuote.bidCents) reasons.push(`${optionLeg.contractId}: crossed market`);
    const spread = BigInt(optionQuote.askCents) - BigInt(optionQuote.bidCents);
    const midTwice = BigInt(optionQuote.askCents) + BigInt(optionQuote.bidCents);
    if (spread * 20_000n > midTwice * BigInt(config.maxRelativeSpreadBps)) reasons.push(`${optionLeg.contractId}: relative spread exceeds limit`);
    if (optionQuote.bidSize < config.minQuoteSize || optionQuote.askSize < config.minQuoteSize) reasons.push(`${optionLeg.contractId}: quote size below minimum`);
    const age = BigInt(now) - BigInt(optionQuote.quotedAt);
    if (age < 0n || age > BigInt(config.quoteMaxAgeMs)) reasons.push(`${optionLeg.contractId}: quote is stale`);
  }
  return verdict("G5", "LIQUIDITY", reasons);
}

function quotesEqualExceptTimestamp(left: OptionQuote, right: OptionQuote): boolean {
  return left.bidCents === right.bidCents
    && left.askCents === right.askCents
    && left.bidSize === right.bidSize
    && left.askSize === right.askSize;
}

function evaluateSession(candidate: EntryCandidate, snapshot: DecisionSnapshot, config: DecisionConfig, now: number): GateVerdict {
  const reasons: string[] = [];
  if (!snapshot.calendar.isTradingDay || now < snapshot.calendar.opensAt || now >= snapshot.calendar.closesAt) {
    reasons.push("calendar is closed at explicit now");
  }
  const underlying = candidate.legs[0]?.underlying;
  if (underlying === undefined) {
    reasons.push("candidate has no underlying");
    return verdict("G6", "SESSION", reasons);
  }
  const currentQuotes = candidate.legs.map(optionLeg => quoteFor(snapshot, optionLeg.contractId));
  if (currentQuotes.some(optionQuote => optionQuote === undefined || BigInt(now) - BigInt(optionQuote.quotedAt) > BigInt(config.quoteMaxAgeMs) || now < optionQuote.quotedAt)) {
    reasons.push(`${underlying}: stale quote signal`);
  }
  const prior = ownRecordValue(snapshot.priorQuotesByUnderlying, underlying);
  const priorObservedAtIsValid = prior !== undefined && Number.isSafeInteger(prior.observedAt) && prior.observedAt >= 0;
  const historyAge = priorObservedAtIsValid ? BigInt(now) - BigInt(prior.observedAt) : null;
  const historyComplete = prior !== undefined
    && historyAge !== null
    && historyAge >= 0n
    && historyAge <= 2n * BigInt(config.cycleIntervalMs)
    && currentQuotes.every(optionQuote => optionQuote !== undefined)
    && candidate.legs.every(optionLeg => isRuntimeOptionQuote(ownRecordValue(prior.quotesByContract, optionLeg.contractId)));
  if (!historyComplete) {
    reasons.push(`${underlying}: missing or over-age complete quote history`);
  } else {
    const frozen = candidate.legs.every(optionLeg => {
      const currentQuote = quoteFor(snapshot, optionLeg.contractId);
      const priorQuote = ownRecordValue(prior.quotesByContract, optionLeg.contractId);
      return currentQuote !== undefined
        && isRuntimeOptionQuote(priorQuote)
        && currentQuote.quotedAt > priorQuote.quotedAt
        && quotesEqualExceptTimestamp(currentQuote, priorQuote);
    });
    if (frozen) reasons.push(`${underlying}: price and size frozen while timestamps advance`);
  }
  return verdict("G6", "SESSION", reasons);
}

function netPremiumSign(candidate: EntryCandidate, snapshot: DecisionSnapshot): number | null {
  let signedMidTwice = 0n;
  for (const optionLeg of candidate.legs) {
    const optionQuote = quoteFor(snapshot, optionLeg.contractId);
    if (optionQuote === undefined) return null;
    const midTwice = (BigInt(optionQuote.bidCents) + BigInt(optionQuote.askCents)) * BigInt(optionLeg.ratio);
    signedMidTwice += optionLeg.side === "buy" ? midTwice : -midTwice;
  }
  return signedMidTwice < 0n ? -1 : signedMidTwice > 0n ? 1 : 0;
}

function evaluateWhitelist(candidate: EntryCandidate, snapshot: DecisionSnapshot, config: DecisionConfig): GateVerdict {
  const whitelistReasons: string[] = [];
  const unknownContracts = candidate.legs.filter(optionLeg => {
    const contract = ownRecordValue(snapshot.contractsById, optionLeg.contractId);
    return contract === undefined
      || contract.contractId !== optionLeg.contractId
      || contract.underlying !== optionLeg.underlying
      || contract.expiry !== optionLeg.expiry
      || contract.strikeCents !== optionLeg.strikeCents
      || contract.right !== optionLeg.right;
  });
  if (unknownContracts.length > 0) {
    return verdict("G8", "UNKNOWN_CONTRACT", unknownContracts.map(optionLeg => `${optionLeg.contractId}: absent from fetched chain or metadata contradicts it`));
  }
  if (candidate.legs.length === 0 || candidate.legs.some(optionLeg => !config.underlyingUniverse.includes(optionLeg.underlying))) whitelistReasons.push("underlying outside UNDERLYING_UNIVERSE");
  if (!config.structureWhitelist.includes(candidate.declaredStructureType)) whitelistReasons.push("declaredStructureType outside STRUCTURE_WHITELIST");
  if (candidate.remainingTradingSessions < config.expiryMinSessions || candidate.remainingTradingSessions > config.expiryMaxSessions) whitelistReasons.push("remainingTradingSessions outside inclusive bounds");
  if (candidate.quantity > config.maxCandidateQuantity) whitelistReasons.push("quantity exceeds MAX_CANDIDATE_QTY");
  for (const optionLeg of candidate.legs) {
    const spotValue = ownRecordValue(snapshot.spotCentsByUnderlying, optionLeg.underlying);
    const spotCents = typeof spotValue === "number" && Number.isSafeInteger(spotValue) && spotValue >= 0 ? spotValue : undefined;
    const distance = spotCents === undefined ? null : BigInt(optionLeg.strikeCents) - BigInt(spotCents);
    const absoluteDistance = distance === null ? null : distance < 0n ? -distance : distance;
    if (spotCents === undefined || spotCents <= 0 || absoluteDistance === null || absoluteDistance * 10_000n > BigInt(spotCents) * BigInt(config.maxStrikeDistanceBps)) {
      whitelistReasons.push(`${optionLeg.contractId}: strike distance exceeds inclusive bound or spot is missing`);
    }
  }
  if (whitelistReasons.length > 0) return verdict("G8", "WHITELIST", whitelistReasons);

  const premiumSign = netPremiumSign(candidate, snapshot);
  const sleeveMatches = (premiumSign !== null && premiumSign < 0 && candidate.sleeve === "income")
    || (premiumSign !== null && premiumSign > 0 && candidate.sleeve === "convex");
  if (!sleeveMatches) return verdict("G8", "SLEEVE_MISMATCH", [premiumSign === 0 ? "zero net premium is degenerate" : "sleeve tag contradicts leg premium economics"]);
  return verdict("G8", "PASS", []);
}

function evaluateCandidate(
  snapshot: DecisionSnapshot,
  candidate: EntryCandidate,
  config: DecisionConfig,
  now: number,
  acceptedRiskBySleeve: Readonly<Record<Sleeve, bigint>>,
  acceptedRiskByUnderlying: ReadonlyMap<string, bigint>,
  plannedEntryOrderIds: ReadonlySet<string>,
): CandidateEvaluation {
  const risk = definedRisk(candidate);
  const clientOrderId = entryClientOrderId(snapshot, candidate);
  const underlying = candidate.legs[0]?.underlying ?? "";
  const sleeveBudget = candidate.sleeve === "income" ? config.incomeBudgetCents : config.convexBudgetCents;
  const snapshotSleeveRisk = riskBySleeve(snapshot, candidate.sleeve);
  const snapshotUnderlyingRisk = riskByUnderlying(snapshot, underlying);
  const currentSleeveRisk = snapshotSleeveRisk === null ? null : snapshotSleeveRisk + acceptedRiskBySleeve[candidate.sleeve];
  const currentUnderlyingRisk = snapshotUnderlyingRisk === null ? null : snapshotUnderlyingRisk + (acceptedRiskByUnderlying.get(underlying) ?? 0n);
  const riskUnavailable = risk.maxLossCents === null;
  const gateVector: GateVerdict[] = [
    verdict("G1", "DEFINED_RISK", risk.reasons),
    verdict("G2", "BUDGET", riskUnavailable || currentSleeveRisk === null || currentSleeveRisk + BigInt(risk.maxLossCents) > BigInt(sleeveBudget) ? [riskUnavailable ? "reservedMaxLoss unavailable" : currentSleeveRisk === null ? "snapshot sleeve risk is invalid" : "sleeve budget exceeded"] : []),
    verdict("G3", "POSITION_SIZE", riskUnavailable || BigInt(risk.maxLossCents) * 10_000n > BigInt(sleeveBudget) * BigInt(config.maxLossPerPositionBps) ? [riskUnavailable ? "reservedMaxLoss unavailable" : "position cap exceeded"] : []),
    verdict("G4", "CONCENTRATION", riskUnavailable || currentUnderlyingRisk === null || currentUnderlyingRisk + BigInt(risk.maxLossCents) > BigInt(config.maxUnderlyingExposureCents) ? [riskUnavailable ? "reservedMaxLoss unavailable" : currentUnderlyingRisk === null ? "snapshot underlying risk is invalid" : "underlying concentration exceeded"] : []),
    evaluateLiquidity(candidate, snapshot, config, now),
    evaluateSession(candidate, snapshot, config, now),
    verdict("G7", "IDEMPOTENCY", plannedEntryOrderIds.has(clientOrderId) ? ["entry client order ID already submitted or planned"] : []),
    evaluateWhitelist(candidate, snapshot, config),
  ];
  const passed = gateVector.every(gateVerdict => gateVerdict.passed);
  const action = passed && risk.maxLossCents !== null && underlying !== ""
    ? Object.freeze({
        kind: "ENTRY_ACTION_PLAN" as const,
        candidateId: candidate.candidateId,
        exposureLifecycleId: `exposure:${clientOrderId}`,
        clientOrderId,
        sleeve: candidate.sleeve,
        underlying,
        submittedLimit: Object.freeze({ kind: candidate.entryLimit.kind, priceCents: candidate.entryLimit.priceCents }),
        reservedMaxLossCents: risk.maxLossCents,
        legs: Object.freeze(candidate.legs.map(optionLeg => Object.freeze({
          contractId: optionLeg.contractId,
          underlying: optionLeg.underlying,
          expiry: optionLeg.expiry,
          strikeCents: optionLeg.strikeCents,
          right: optionLeg.right,
          side: optionLeg.side,
          ratio: optionLeg.ratio,
        }))),
        quantity: candidate.quantity,
      })
    : null;
  return {
    verdict: {
      candidateId: candidate.candidateId,
      candidateRationale: candidate.rationale,
      decision: passed ? "PASS" : "VETO",
      reservedMaxLossCents: risk.maxLossCents,
      gateVector,
    },
    action,
  };
}

export function decide(snapshot: DecisionSnapshot, batch: AnalystBatch, config: DecisionConfig, now: number): DecisionResult {
  if (batch.kind === "structural_failure") {
    return { batchVerdicts: [{ code: "SCHEMA_VETO", reason: batch.issue }], candidateVerdicts: [], actions: [] };
  }
  if (new Set(batch.candidates.map(candidate => candidate.candidateId)).size !== batch.candidates.length) {
    return { batchVerdicts: [{ code: "SCHEMA_VETO", reason: "candidate IDs must be unique within one analyst batch" }], candidateVerdicts: [], actions: [] };
  }
  const stale = BigInt(now) - BigInt(snapshot.snapshotAt) > BigInt(config.snapshotStalenessBoundMs);
  const batchVerdicts: DecisionResult["batchVerdicts"][number][] = stale ? [{ code: "STALE_SNAPSHOT", reason: "snapshot exceeds SNAPSHOT_STALENESS_BOUND" }] : [];
  // S-G12-03: the persisted halt flag is a snapshot input; it vetoes every entry action while the full vector is still recorded.
  if (snapshot.halt) batchVerdicts.push({ code: "HALT", reason: "halt flag is set; entry actions are vetoed, management continues" });
  const blocked = stale || snapshot.halt;
  const candidateVerdicts: CandidateVerdict[] = [];
  const actions: EntryActionPlan[] = [];
  const acceptedRiskBySleeve: Record<Sleeve, bigint> = { income: 0n, convex: 0n };
  const acceptedRiskByUnderlying = new Map<string, bigint>();
  const plannedEntryOrderIds = new Set(snapshot.submittedOrderIds);
  for (const candidate of batch.candidates) {
    const evaluation = evaluateCandidate(snapshot, candidate, config, now, acceptedRiskBySleeve, acceptedRiskByUnderlying, plannedEntryOrderIds);
    candidateVerdicts.push(evaluation.verdict);
    if (!blocked && evaluation.action !== null) {
      actions.push(evaluation.action);
      acceptedRiskBySleeve[candidate.sleeve] += BigInt(evaluation.action.reservedMaxLossCents);
      acceptedRiskByUnderlying.set(evaluation.action.underlying, (acceptedRiskByUnderlying.get(evaluation.action.underlying) ?? 0n) + BigInt(evaluation.action.reservedMaxLossCents));
      plannedEntryOrderIds.add(evaluation.action.clientOrderId);
    }
  }
  return { batchVerdicts, candidateVerdicts, actions };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(record: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isWellFormedString(value: unknown): value is string {
  if (typeof value !== "string") return false;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function parseLeg(value: unknown): OptionLeg | null {
  if (!isRecord(value) || !hasExactKeys(value, ["contractId", "underlying", "expiry", "strikeCents", "right", "side", "ratio"])) return null;
  const contractId = value["contractId"];
  const underlying = value["underlying"];
  const expiry = value["expiry"];
  const strikeCents = value["strikeCents"];
  const right = value["right"];
  const side = value["side"];
  const ratio = value["ratio"];
  if (typeof contractId !== "string" || typeof underlying !== "string" || typeof expiry !== "string" || !isSafeInteger(strikeCents) || strikeCents < 0 || (right !== "call" && right !== "put") || (side !== "buy" && side !== "sell") || !isSafeInteger(ratio) || ratio <= 0) return null;
  return { contractId, underlying, expiry, strikeCents: integerUnit(strikeCents, "StrikeCents"), right, side, ratio: lotCount(ratio) };
}

function parseCandidate(value: unknown): EntryCandidate | null {
  if (!isRecord(value) || !hasExactKeys(value, ["candidateId", "declaredStructureType", "sleeve", "quantity", "remainingTradingSessions", "rationale", "entryLimit", "legs"])) return null;
  const candidateId = value["candidateId"];
  const declaredStructureType = value["declaredStructureType"];
  const sleeve = value["sleeve"];
  const quantity = value["quantity"];
  const remainingTradingSessions = value["remainingTradingSessions"];
  const rationale = value["rationale"];
  const entryLimit = value["entryLimit"];
  const legsValue = value["legs"];
  if (!isWellFormedString(candidateId) || typeof declaredStructureType !== "string" || (sleeve !== "income" && sleeve !== "convex") || !isSafeInteger(quantity) || quantity <= 0 || !isSafeInteger(remainingTradingSessions) || remainingTradingSessions < 0 || typeof rationale !== "string" || !isRecord(entryLimit) || !hasExactKeys(entryLimit, ["kind", "priceCents"]) || !Array.isArray(legsValue)) return null;
  const entryLimitKind = entryLimit["kind"];
  const entryLimitPriceCents = entryLimit["priceCents"];
  if ((entryLimitKind !== "debit" && entryLimitKind !== "credit") || !isSafeInteger(entryLimitPriceCents) || entryLimitPriceCents < 0) return null;
  const legs = legsValue.map(parseLeg);
  if (legs.some(optionLeg => optionLeg === null)) return null;
  return {
    candidateId,
    declaredStructureType,
    sleeve,
    quantity: lotCount(quantity),
    remainingTradingSessions: integerUnit(remainingTradingSessions, "Quantity"),
    rationale,
    entryLimit: { kind: entryLimitKind, priceCents: integerUnit(entryLimitPriceCents, "OptionPriceCents") },
    legs: legs as readonly OptionLeg[],
  };
}

export function parseAnalystOutput(raw: string): AnalystBatch {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { kind: "structural_failure", issue: "invalid or truncated JSON" };
  }
  try {
    if (!isRecord(parsed) || !hasExactKeys(parsed, ["candidates"]) || !Array.isArray(parsed["candidates"])) return { kind: "structural_failure", issue: "analyst envelope schema mismatch" };
    const candidates = parsed["candidates"].map(parseCandidate);
    if (candidates.some(candidateValue => candidateValue === null)) return { kind: "structural_failure", issue: "candidate schema mismatch or non-candidate text" };
    const candidateValues = candidates as readonly EntryCandidate[];
    if (new Set(candidateValues.map(candidate => candidate.candidateId)).size !== candidateValues.length) return { kind: "structural_failure", issue: "candidate IDs must be unique within one analyst batch" };
    return { kind: "candidates", candidates: candidateValues };
  } catch {
    return { kind: "structural_failure", issue: "candidate schema validation failed" };
  }
}

/**
 * The exact reserved maximum loss of `quantity` units of `candidate` if the
 * structure were entered at `priceCents`, or null when the leg pattern has no
 * fixed loss. P3's journal fold prices filled portions through this at the
 * broker's actual fill price, including a fill worse than the limit
 * (S-X-02 reserves the actual exposure rather than the original bound).
 */
export function definedRiskAt(candidate: EntryCandidate, quantity: Quantity, priceCents: OptionPriceCents): MoneyCents | null {
  return definedRisk(candidate, quantity, priceCents).maxLossCents;
}

export function reconcilePartialFillRisk(
  candidate: EntryCandidate,
  filledQuantity: Quantity,
  averageFillPriceCents: OptionPriceCents,
  remainingQuantity: Quantity,
): { readonly components: readonly ExposureRiskComponent[]; readonly totalMaxLossCents: MoneyCents } {
  // Every approved unit stays accounted: a report that adds up to more than the
  // approved quantity is impossible, and one that adds up to less has lost a
  // unit whose terminal state nobody observed (S-G2-07 releases only on an
  // observed terminal state). Both are rejected fail-closed rather than repaired.
  if (BigInt(filledQuantity) + BigInt(remainingQuantity) !== BigInt(candidate.quantity)) throw new RangeError("filled plus remaining quantity must equal the approved quantity");
  const fillIsWorseThanLimit = candidate.entryLimit.kind === "debit"
    ? averageFillPriceCents > candidate.entryLimit.priceCents
    : averageFillPriceCents < candidate.entryLimit.priceCents;
  if (fillIsWorseThanLimit) throw new RangeError("broker fill price is worse than the approved entry limit");
  const filledRisk = definedRisk(candidate, filledQuantity, averageFillPriceCents).maxLossCents;
  const remainingRisk = definedRisk(candidate, remainingQuantity, candidate.entryLimit.priceCents).maxLossCents;
  if (filledRisk === null || remainingRisk === null) throw new RangeError("partial fill risk is unavailable for undefined-risk structure");
  const components: ExposureRiskComponent[] = [];
  if (filledQuantity > 0) components.push({ kind: "filled", maxLossCents: filledRisk });
  if (remainingQuantity > 0) components.push({ kind: "entry", state: "fillable", maxLossCents: remainingRisk });
  return { components, totalMaxLossCents: asMoneyCents(filledRisk + remainingRisk) };
}
