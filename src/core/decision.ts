import { integerUnit } from "./domain.js";
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

function multiplyMoney(priceCents: number, quantity: number): MoneyCents {
  return asMoneyCents(priceCents * 100 * quantity);
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

function definedRisk(candidate: EntryCandidate, quantity = candidate.quantity, priceCents = candidate.entryLimit.priceCents): DefinedRiskResult {
  const duplicateContract = new Set(candidate.legs.map(optionLeg => optionLeg.contractId)).size !== candidate.legs.length;
  if (duplicateContract) return { maxLossCents: null, reasons: ["degenerate structure repeats a contract"] };
  if (!hasUnitRatios(candidate.legs)) return { maxLossCents: null, reasons: ["non-unit leg ratio can leave a net short side"] };
  if (!sameContractShape(candidate.legs)) return { maxLossCents: null, reasons: ["legs do not share underlying and expiry"] };

  if (candidate.declaredStructureType === "long_option") {
    if (candidate.legs.length !== 1 || candidate.legs[0]?.side !== "buy" || candidate.entryLimit.kind !== "debit") {
      return { maxLossCents: null, reasons: ["long option must contain one buy leg and a debit limit"] };
    }
    return { maxLossCents: multiplyMoney(priceCents, quantity), reasons: [] };
  }

  if (candidate.declaredStructureType === "vertical_debit" || candidate.declaredStructureType === "vertical_credit") {
    if (candidate.legs.length !== 2) return { maxLossCents: null, reasons: ["vertical must contain exactly two legs"] };
    const [first, second] = candidate.legs;
    if (first === undefined || second === undefined || first.right !== second.right || first.side === second.side) {
      return { maxLossCents: null, reasons: ["vertical must contain one buy and one sell of the same option right"] };
    }
    const widthCents = Math.abs(first.strikeCents - second.strikeCents);
    if (widthCents === 0) return { maxLossCents: null, reasons: ["vertical width must be positive"] };
    if (candidate.declaredStructureType === "vertical_debit" && candidate.entryLimit.kind === "debit") {
      return { maxLossCents: multiplyMoney(priceCents, quantity), reasons: [] };
    }
    if (candidate.declaredStructureType === "vertical_credit" && candidate.entryLimit.kind === "credit" && priceCents < widthCents) {
      return { maxLossCents: multiplyMoney(widthCents - priceCents, quantity), reasons: [] };
    }
    return { maxLossCents: null, reasons: ["vertical limit kind or credit is incompatible with finite max loss"] };
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
    const putWidth = puts[1].strikeCents - puts[0].strikeCents;
    const callWidth = calls[1].strikeCents - calls[0].strikeCents;
    const widestWing = Math.max(putWidth, callWidth);
    if (widestWing <= 0 || priceCents >= widestWing) return { maxLossCents: null, reasons: ["iron condor credit does not leave finite positive max loss"] };
    return { maxLossCents: multiplyMoney(widestWing - priceCents, quantity), reasons: [] };
  }

  return { maxLossCents: null, reasons: ["maximum loss is not computable from the leg pattern"] };
}

function countedRisk(component: ExposureRiskComponent): number {
  if (component.kind === "exit") return 0;
  if (component.kind === "filled") return component.maxLossCents;
  return component.state === "intent" || component.state === "fillable" || component.state === "confirmation_unclear"
    ? component.maxLossCents
    : 0;
}

function riskBySleeve(snapshot: DecisionSnapshot, sleeve: Sleeve): number {
  return snapshot.exposureLifecycles
    .filter(lifecycle => lifecycle.sleeve === sleeve)
    .flatMap(lifecycle => lifecycle.risk)
    .reduce((total, component) => total + countedRisk(component), 0);
}

function riskByUnderlying(snapshot: DecisionSnapshot, underlying: string): number {
  return snapshot.exposureLifecycles
    .filter(lifecycle => lifecycle.underlying === underlying)
    .flatMap(lifecycle => lifecycle.risk)
    .reduce((total, component) => total + countedRisk(component), 0);
}

function verdict(gate: GateVerdict["gate"], code: GateVerdict["code"], reasons: readonly string[]): GateVerdict {
  return { gate, passed: reasons.length === 0, code: reasons.length === 0 ? "PASS" : code, reasons };
}

function evaluateLiquidity(candidate: EntryCandidate, snapshot: DecisionSnapshot, config: DecisionConfig, now: number): GateVerdict {
  const reasons: string[] = [];
  for (const optionLeg of candidate.legs) {
    const optionQuote = snapshot.quotesByContract[optionLeg.contractId];
    if (optionQuote === undefined) {
      reasons.push(`${optionLeg.contractId}: missing quote`);
      continue;
    }
    if (optionQuote.bidCents <= 0) reasons.push(`${optionLeg.contractId}: bid is not positive`);
    if (optionQuote.askCents < optionQuote.bidCents) reasons.push(`${optionLeg.contractId}: crossed market`);
    const spread = optionQuote.askCents - optionQuote.bidCents;
    const midTwice = optionQuote.askCents + optionQuote.bidCents;
    if (BigInt(spread) * 20_000n > BigInt(midTwice) * BigInt(config.maxRelativeSpreadBps)) reasons.push(`${optionLeg.contractId}: relative spread exceeds limit`);
    if (optionQuote.bidSize < config.minQuoteSize || optionQuote.askSize < config.minQuoteSize) reasons.push(`${optionLeg.contractId}: quote size below minimum`);
    const age = now - optionQuote.quotedAt;
    if (age < 0 || age > config.quoteMaxAgeMs) reasons.push(`${optionLeg.contractId}: quote is stale`);
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
  const currentQuotes = candidate.legs.map(optionLeg => snapshot.quotesByContract[optionLeg.contractId]);
  if (currentQuotes.some(optionQuote => optionQuote === undefined || now - optionQuote.quotedAt > config.quoteMaxAgeMs || now < optionQuote.quotedAt)) {
    reasons.push(`${underlying}: stale quote signal`);
  }
  const prior = snapshot.priorQuotesByUnderlying[underlying];
  const historyAge = prior === undefined ? null : now - prior.observedAt;
  const historyComplete = prior !== undefined
    && historyAge !== null
    && historyAge >= 0
    && historyAge <= 2 * config.cycleIntervalMs
    && currentQuotes.every(optionQuote => optionQuote !== undefined)
    && candidate.legs.every(optionLeg => prior.quotesByContract[optionLeg.contractId] !== undefined);
  if (!historyComplete) {
    reasons.push(`${underlying}: missing or over-age complete quote history`);
  } else {
    const frozen = candidate.legs.every(optionLeg => {
      const currentQuote = snapshot.quotesByContract[optionLeg.contractId];
      const priorQuote = prior.quotesByContract[optionLeg.contractId];
      return currentQuote !== undefined
        && priorQuote !== undefined
        && currentQuote.quotedAt > priorQuote.quotedAt
        && quotesEqualExceptTimestamp(currentQuote, priorQuote);
    });
    if (frozen) reasons.push(`${underlying}: price and size frozen while timestamps advance`);
  }
  return verdict("G6", "SESSION", reasons);
}

function netPremiumSign(candidate: EntryCandidate, snapshot: DecisionSnapshot): number | null {
  let signedMidTwice = 0;
  for (const optionLeg of candidate.legs) {
    const optionQuote = snapshot.quotesByContract[optionLeg.contractId];
    if (optionQuote === undefined) return null;
    const midTwice = (optionQuote.bidCents + optionQuote.askCents) * optionLeg.ratio;
    signedMidTwice += optionLeg.side === "buy" ? midTwice : -midTwice;
  }
  return Math.sign(signedMidTwice);
}

function evaluateWhitelist(candidate: EntryCandidate, snapshot: DecisionSnapshot, config: DecisionConfig): GateVerdict {
  const whitelistReasons: string[] = [];
  const unknownContracts = candidate.legs.filter(optionLeg => !snapshot.knownContractIds.includes(optionLeg.contractId));
  if (unknownContracts.length > 0) {
    return verdict("G8", "UNKNOWN_CONTRACT", unknownContracts.map(optionLeg => `${optionLeg.contractId}: absent from fetched chain`));
  }
  if (candidate.legs.length === 0 || candidate.legs.some(optionLeg => !config.underlyingUniverse.includes(optionLeg.underlying))) whitelistReasons.push("underlying outside UNDERLYING_UNIVERSE");
  if (!config.structureWhitelist.includes(candidate.declaredStructureType)) whitelistReasons.push("declaredStructureType outside STRUCTURE_WHITELIST");
  if (candidate.remainingTradingSessions < config.expiryMinSessions || candidate.remainingTradingSessions > config.expiryMaxSessions) whitelistReasons.push("remainingTradingSessions outside inclusive bounds");
  if (candidate.quantity > config.maxCandidateQuantity) whitelistReasons.push("quantity exceeds MAX_CANDIDATE_QTY");
  for (const optionLeg of candidate.legs) {
    const spotCents = snapshot.spotCentsByUnderlying[optionLeg.underlying];
    if (spotCents === undefined || spotCents <= 0 || BigInt(Math.abs(optionLeg.strikeCents - spotCents)) * 10_000n > BigInt(spotCents) * BigInt(config.maxStrikeDistanceBps)) {
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
  acceptedRiskBySleeve: Readonly<Record<Sleeve, number>>,
  acceptedRiskByUnderlying: Readonly<Record<string, number>>,
): CandidateEvaluation {
  const risk = definedRisk(candidate);
  const underlying = candidate.legs[0]?.underlying ?? "";
  const sleeveBudget = candidate.sleeve === "income" ? config.incomeBudgetCents : config.convexBudgetCents;
  const currentSleeveRisk = riskBySleeve(snapshot, candidate.sleeve) + acceptedRiskBySleeve[candidate.sleeve];
  const currentUnderlyingRisk = riskByUnderlying(snapshot, underlying) + (acceptedRiskByUnderlying[underlying] ?? 0);
  const riskUnavailable = risk.maxLossCents === null;
  const gateVector: GateVerdict[] = [
    verdict("G1", "DEFINED_RISK", risk.reasons),
    verdict("G2", "BUDGET", riskUnavailable || currentSleeveRisk + risk.maxLossCents > sleeveBudget ? [riskUnavailable ? "reservedMaxLoss unavailable" : "sleeve budget exceeded"] : []),
    verdict("G3", "POSITION_SIZE", riskUnavailable || BigInt(risk.maxLossCents) * 10_000n > BigInt(sleeveBudget) * BigInt(config.maxLossPerPositionBps) ? [riskUnavailable ? "reservedMaxLoss unavailable" : "position cap exceeded"] : []),
    verdict("G4", "CONCENTRATION", riskUnavailable || currentUnderlyingRisk + risk.maxLossCents > config.maxUnderlyingExposureCents ? [riskUnavailable ? "reservedMaxLoss unavailable" : "underlying concentration exceeded"] : []),
    evaluateLiquidity(candidate, snapshot, config, now),
    evaluateSession(candidate, snapshot, config, now),
    verdict("G7", "IDEMPOTENCY", snapshot.submittedOrderIds.includes(entryClientOrderId(snapshot, candidate)) ? ["entry client order ID already submitted"] : []),
    evaluateWhitelist(candidate, snapshot, config),
  ];
  const passed = gateVector.every(gateVerdict => gateVerdict.passed);
  const action = passed && risk.maxLossCents !== null && underlying !== ""
    ? {
        kind: "ENTRY_ACTION_PLAN" as const,
        candidateId: candidate.candidateId,
        exposureLifecycleId: `exposure:${entryClientOrderId(snapshot, candidate)}`,
        clientOrderId: entryClientOrderId(snapshot, candidate),
        sleeve: candidate.sleeve,
        underlying,
        submittedLimit: candidate.entryLimit,
        reservedMaxLossCents: risk.maxLossCents,
        legs: candidate.legs,
        quantity: candidate.quantity,
      }
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
  const stale = now - snapshot.snapshotAt > config.snapshotStalenessBoundMs;
  const batchVerdicts = stale ? [{ code: "STALE_SNAPSHOT" as const, reason: "snapshot exceeds SNAPSHOT_STALENESS_BOUND" }] : [];
  const candidateVerdicts: CandidateVerdict[] = [];
  const actions: EntryActionPlan[] = [];
  const acceptedRiskBySleeve: Record<Sleeve, number> = { income: 0, convex: 0 };
  const acceptedRiskByUnderlying: Record<string, number> = {};
  for (const candidate of batch.candidates) {
    const evaluation = evaluateCandidate(snapshot, candidate, config, now, acceptedRiskBySleeve, acceptedRiskByUnderlying);
    candidateVerdicts.push(evaluation.verdict);
    if (!stale && evaluation.action !== null) {
      actions.push(evaluation.action);
      acceptedRiskBySleeve[candidate.sleeve] += evaluation.action.reservedMaxLossCents;
      acceptedRiskByUnderlying[evaluation.action.underlying] = (acceptedRiskByUnderlying[evaluation.action.underlying] ?? 0) + evaluation.action.reservedMaxLossCents;
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

function parseLeg(value: unknown): OptionLeg | null {
  if (!isRecord(value) || !hasExactKeys(value, ["contractId", "underlying", "expiry", "strikeCents", "right", "side", "ratio"])) return null;
  const contractId = value["contractId"];
  const underlying = value["underlying"];
  const expiry = value["expiry"];
  const strikeCents = value["strikeCents"];
  const right = value["right"];
  const side = value["side"];
  const ratio = value["ratio"];
  if (typeof contractId !== "string" || typeof underlying !== "string" || typeof expiry !== "string" || !isSafeInteger(strikeCents) || (right !== "call" && right !== "put") || (side !== "buy" && side !== "sell") || !isSafeInteger(ratio) || ratio <= 0) return null;
  return { contractId, underlying, expiry, strikeCents: integerUnit(strikeCents, "StrikeCents"), right, side, ratio: integerUnit(ratio, "Quantity") };
}

function parseCandidate(value: unknown): EntryCandidate | null {
  if (!isRecord(value) || !hasExactKeys(value, ["candidateId", "structureIdentity", "declaredStructureType", "sleeve", "quantity", "remainingTradingSessions", "rationale", "entryLimit", "legs"])) return null;
  const candidateId = value["candidateId"];
  const structureIdentity = value["structureIdentity"];
  const declaredStructureType = value["declaredStructureType"];
  const sleeve = value["sleeve"];
  const quantity = value["quantity"];
  const remainingTradingSessions = value["remainingTradingSessions"];
  const rationale = value["rationale"];
  const entryLimit = value["entryLimit"];
  const legsValue = value["legs"];
  if (typeof candidateId !== "string" || typeof structureIdentity !== "string" || typeof declaredStructureType !== "string" || (sleeve !== "income" && sleeve !== "convex") || !isSafeInteger(quantity) || quantity <= 0 || !isSafeInteger(remainingTradingSessions) || remainingTradingSessions < 0 || typeof rationale !== "string" || !isRecord(entryLimit) || !hasExactKeys(entryLimit, ["kind", "priceCents"]) || !Array.isArray(legsValue)) return null;
  const entryLimitKind = entryLimit["kind"];
  const entryLimitPriceCents = entryLimit["priceCents"];
  if ((entryLimitKind !== "debit" && entryLimitKind !== "credit") || !isSafeInteger(entryLimitPriceCents) || entryLimitPriceCents < 0) return null;
  const legs = legsValue.map(parseLeg);
  if (legs.some(optionLeg => optionLeg === null)) return null;
  return {
    candidateId,
    structureIdentity,
    declaredStructureType,
    sleeve,
    quantity: integerUnit(quantity, "Quantity"),
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
  if (!isRecord(parsed) || !hasExactKeys(parsed, ["candidates"]) || !Array.isArray(parsed["candidates"])) return { kind: "structural_failure", issue: "analyst envelope schema mismatch" };
  const candidates = parsed["candidates"].map(parseCandidate);
  if (candidates.some(candidateValue => candidateValue === null)) return { kind: "structural_failure", issue: "candidate schema mismatch or non-candidate text" };
  return { kind: "candidates", candidates: candidates as readonly EntryCandidate[] };
}

export function reconcilePartialFillRisk(
  candidate: EntryCandidate,
  filledQuantity: Quantity,
  averageFillPriceCents: OptionPriceCents,
  remainingQuantity: Quantity,
): { readonly components: readonly ExposureRiskComponent[]; readonly totalMaxLossCents: MoneyCents } {
  if (filledQuantity + remainingQuantity > candidate.quantity) throw new RangeError("filled plus remaining quantity exceeds approved quantity");
  const filledRisk = definedRisk(candidate, filledQuantity, averageFillPriceCents).maxLossCents;
  const remainingRisk = definedRisk(candidate, remainingQuantity, candidate.entryLimit.priceCents).maxLossCents;
  if (filledRisk === null || remainingRisk === null) throw new RangeError("partial fill risk is unavailable for undefined-risk structure");
  const components: ExposureRiskComponent[] = [];
  if (filledQuantity > 0) components.push({ kind: "filled", state: "filled", maxLossCents: filledRisk });
  if (remainingQuantity > 0) components.push({ kind: "entry", state: "fillable", maxLossCents: remainingRisk });
  return { components, totalMaxLossCents: asMoneyCents(filledRisk + remainingRisk) };
}
