// The single final mutation gateway (S-G12-07): every broker mutation and
// every journal append passes here. The shell part is thin — take the local
// mutex, read the epoch store and the journal tail, hand the facts to the
// pure core (`authorizeMutation`, `planAppend`, `haltStateAfter`), and apply
// the result. Holding or reacquiring the mutex grants no broker authority; the
// epoch does, and only for the gateway instance that acquired it in this
// process. The sole non-authoritative safety exception is a denial-only halt
// interlock for startup auth/account failures; it can never reach the broker.
import { authorizeMutation, bindingsEqual, compareAndIncrement, planEpochAcquisition, resetPairPresent, shouldAttemptTakeover } from "../core/authority.js";
import type { AccountVirginity, EpochStoreState } from "../core/authority.js";
import { haltStateAfter, haltStateFrom, intentRationaleTexts, isWitnessEntryType, planAppend, redactSecrets } from "../core/journal.js";
import type { AccountBinding, HaltReason, HaltState, JournalDraft, JournalEntry } from "../core/journal.js";
import { setFencePending, readEpochStore, readHolder, withMutex, writeEpochStore, writeHolder } from "./epoch-store.js";
import { readHaltState, writeHaltState } from "./halt-state.js";
import { appendJournalLine, quarantineTornTail, readJournalFile } from "./journal-store.js";
import type { JournalFile } from "./journal-store.js";
import type { StatePaths } from "./state-dir.js";
import { AccountBindingError, httpStatusOf } from "./broker-errors.js";

export interface BrokerMutation {
  readonly kind: "submit_order" | "cancel_order" | "close_position";
  readonly clientOrderId: string;
  readonly binding: AccountBinding;
  readonly payload?: unknown;
  /** Absolute wall-clock deadline inherited from the cycle; no local mutation may begin after it, and a later remote answer is uncertain. */
  readonly notAfterMs?: number;
}

export type BrokerMutationResult = { readonly ok: true; readonly brokerOrderId: string } | { readonly ok: false; readonly reason: string };

export interface BrokerMutationPort {
  mutate(mutation: BrokerMutation): Promise<BrokerMutationResult>;
}

/** P2 ships no broker implementation: the only port refuses every mutation. */
export const NO_BROKER_PORT: BrokerMutationPort = {
  mutate: () => Promise.resolve({ ok: false, reason: "BROKER_PORT_NOT_IMPLEMENTED" }),
};

export type GatewayAction =
  | { readonly kind: "journal_append"; readonly entry: JournalDraft }
  | { readonly kind: "broker_mutation"; readonly mutation: BrokerMutation };

export type MutationRequest =
  | { readonly class: "authoritative"; readonly epoch: number | null; readonly deadlineAtMs?: number; readonly action: GatewayAction }
  | { readonly class: "witness"; readonly action: GatewayAction };

export type DispatchResult =
  | { readonly ok: true; readonly seq: number; readonly stalenessNeutral: boolean }
  | { readonly ok: true; readonly broker: BrokerMutationResult }
  | {
    readonly ok: false;
    readonly reason: string;
    readonly lockHeld: boolean;
    /** Present when the broker port itself answered or threw; absent when the gateway refused before the port. */
    readonly source?: "broker_port";
    /** Preserved from a typed broker transport error so 401/403 cannot be downgraded to an ordinary rejection. */
    readonly httpStatus?: number;
  };

export type AcquisitionResult =
  | { readonly kind: "WON"; readonly epoch: number; readonly seeded: "bootstrap" | null }
  | { readonly kind: "GAP_HALT"; readonly epoch: number }
  | { readonly kind: "SUPPRESSED"; readonly holderId: string; readonly reason: "LOCK_HELD" }
  | { readonly kind: "LOST"; readonly observedEpoch: number | null }
  | { readonly kind: "REFUSED"; readonly reason: string };

export interface GatewayOptions {
  readonly paths: StatePaths;
  readonly secrets: readonly string[];
  /** Epoch milliseconds; the gateway formats UTC ISO timestamps from it. */
  readonly clock: () => number;
  readonly brokerPort: BrokerMutationPort;
  readonly instanceId: string;
  readonly lockTakeoverBoundMs: number;
  /** The validated {profile, canonical origin, expected account ID} triplet; without it no broker mutation is possible. */
  readonly binding?: AccountBinding;
}

export interface OpenedJournal {
  readonly entries: readonly JournalEntry[];
  readonly quarantined: readonly string[];
  readonly halt: HaltState;
}

export interface MutationGateway {
  openJournal(): Promise<OpenedJournal>;
  /** Atomically proves this process still owns `epoch`, refreshes its heartbeat, and opens journal truth under the same mutex. */
  openJournalAsWriter(epoch: number): Promise<OpenedJournal | null>;
  acquireAuthority(evidence: { readonly account: AccountVirginity }): Promise<AcquisitionResult>;
  heartbeat(): Promise<boolean>;
  dispatch(request: MutationRequest): Promise<DispatchResult>;
  /**
   * Monotonic startup interlock: it can only add one of the two broker-identity
   * safety halts. It never acquires authority, changes the holder, reaches the
   * broker, or clears a halt.
   */
  dispatchSafetyHalt(action: { readonly reason: Extract<HaltReason, "AUTH_FAILURE" | "ACCOUNT_BINDING_MISMATCH">; readonly detail: string }): Promise<DispatchResult>;
  /** Reachable only from src/shell/manual-unhalt.ts: the human path of S-G12-04, and the only way to clear a fence. */
  dispatchManualUnhalt(action: { readonly operator: string; readonly reason: string; readonly expectedHaltSeq?: number; readonly expectedHaltReason?: string; readonly expectedEpoch?: number; readonly expectedHolderId?: string; readonly expectedJournalSeq?: number }): Promise<DispatchResult>;
  /**
   * S-G12-08: record that a credential fence was detected, before its HALT is
   * attempted. Fails only when the epoch store itself cannot be written, which
   * is exactly the state in which no authority can be taken either.
   */
  markCredentialFence(): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }>;
  /** Whether an unreleased fence mark stands right now (S-G12-08); read for reporting, never for permission. */
  fencePending(): boolean;
}

function utcIso(ms: number): string {
  return new Date(ms).toISOString();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createMutationGateway(options: GatewayOptions): MutationGateway {
  for (const secret of options.secrets) if (secret.length === 0) throw new RangeError("empty secret cannot be redacted");
  if (options.instanceId.length === 0) throw new RangeError("instanceId must be non-empty");
  const { paths, secrets, clock, instanceId } = options;
  /** The epoch this gateway instance acquired in this process; a persisted holder id is not an acquisition (G3-F2). */
  let ownEpoch: number | null = null;

  const redact = (text: string): string => redactSecrets(text, secrets);

  function loadJournal(): { readonly file: JournalFile; readonly quarantined: string | null } | { readonly corrupt: string } {
    let file = readJournalFile(paths);
    const quarantined = quarantineTornTail(paths, file, clock());
    if (quarantined !== null) file = readJournalFile(paths);
    const firstCorrupt = file.parsed.corrupt[0];
    if (firstCorrupt !== undefined) return { corrupt: `journal corrupt at line ${String(firstCorrupt.line)}: ${firstCorrupt.reason}` };
    return { file, quarantined };
  }

  function appendUnderLock(entries: readonly JournalEntry[], draft: JournalDraft): { readonly ok: true; readonly entry: JournalEntry } | { readonly ok: false; readonly reason: string } {
    const lastSeq = entries.at(-1)?.seq ?? 0;
    const planned = planAppend({ lastSeq, priorIntentRationales: intentRationaleTexts(entries) }, draft, secrets);
    if (!planned.ok) return { ok: false, reason: redact(planned.reason) };
    appendJournalLine(paths, planned.line);
    const before = haltStateFrom(entries);
    const after = haltStateAfter(before, planned.entry);
    if (planned.entry.type === "HALT" || planned.entry.type === "UNHALT") writeHaltState(paths, after);
    return { ok: true, entry: planned.entry };
  }

  /**
   * The JSONL transition is authoritative; halt.json is only its atomic-read
   * projection. A crash may land between those two durable writes. Whenever
   * the journal contains a halt transition, repair any missing, stale, or
   * unreadable projection from that transition while the gateway mutex is
   * held. With no journal transition, retain the persisted fail-closed state
   * so an unreadable flag can never be silently cleared.
   */
  function reconcileHaltProjection(entries: readonly JournalEntry[]): HaltState {
    const persisted = readHaltState(paths);
    const hasJournalTransition = entries.some(entry => entry.type === "HALT" || entry.type === "UNHALT");
    if (!hasJournalTransition) return persisted;
    const authoritative = haltStateFrom(entries);
    if (persisted.halted !== authoritative.halted || persisted.reason !== authoritative.reason || persisted.sticky !== authoritative.sticky) {
      writeHaltState(paths, authoritative);
    }
    return authoritative;
  }

  /**
   * S-G12-08 / A30: what a cycle must actually obey. The journal is
   * authoritative for the halt, but a fence that could not be journaled lives
   * in the epoch store, and it must weigh the same. Deliberately NOT stricter
   * than a journaled halt: a risk-reducing close stays possible, so a fenced
   * book can still be flattened once the credentials work again.
   */
  function effectiveHaltState(entries: readonly JournalEntry[]): HaltState {
    const journal = reconcileHaltProjection(entries);
    if (journal.halted) return journal;
    const store = readEpochStore(paths);
    if (store.kind === "present" && store.fencePending) {
      // R47-A2: the mark used to be reported as `AUTH_FAILURE, sticky: false`
      // whatever it recorded. Once R46 let a KILL set it, that mapping quietly
      // downgraded the strongest stop in the system: after a sticky KILL whose
      // append failed, a softer halt could land on top and an ordinary manual
      // release then cleared both. The reason travels with the mark, and
      // stickiness follows the same rule the pure `haltDraft` uses, so a
      // marker-only KILL is exactly as irreversible as a journaled one.
      const reason = store.fenceReason ?? "AUTH_FAILURE";
      return { halted: true, reason, sticky: reason === "KILL" || reason === "PROVENANCE_BROKEN" };
    }
    return journal;
  }

  /**
   * R45-A1: the third seam. R44-A1 made `dispatchSafetyHalt` mark for both of
   * its reasons, but this path -- the account-bound port rejecting inside a
   * dispatch -- halts on its own and used to write no mark at all. A blind
   * gate executed it: with the journal read-only the HALT never landed, the
   * store still read `fencePending: false`, and after recovery and a restart
   * the same deployment submitted a risk-increasing order with no human
   * release. That is the same defect as R44-A1 at a different entry point,
   * which is the signature of a duty living in several places instead of one.
   *
   * So the marking lives here, in the one helper both paths call. The mark
   * goes down BEFORE the append is attempted, so a process that dies between
   * the two leaves the strict state behind (S-G12-08). Its failure is returned
   * rather than swallowed: the caller must be able to tell the declared
   * "neither surface is writable" boundary from a fence that stands.
   */
  /**
   * The one implementation of "a safety halt marks the fence before it tries
   * to append" (S-G12-08). It exists because the rule kept being re-stated
   * per entry point and kept being incomplete somewhere: R43-B3 found the
   * startup path unmarked, R44-A1 found ACCOUNT_BINDING_MISMATCH unmarked in
   * `dispatchSafetyHalt`, and R45-A1 found the account-bound port's own halt
   * inside `dispatch` unmarked as well -- a blind gate drove that one to a
   * risk-increasing order after recovery and a restart, with no human
   * release. Three findings, one cause: a duty spread over three call sites.
   * Both callers now go through here, and the mark goes down first, so a
   * process that dies between the two steps leaves the strict state behind.
   */
  function markFenceBeforeHalt(reason: string): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
    const store = readEpochStore(paths);
    if (store.kind === "present" && store.fencePending) return { ok: true };
    return setFencePending(paths, true, reason);
  }

  function haltForBindingMismatch(entries: readonly JournalEntry[], epoch: number, detail: string): void {
    markFenceBeforeHalt("ACCOUNT_BINDING_MISMATCH");
    const current = reconcileHaltProjection(entries);
    if (current.halted && current.reason === "ACCOUNT_BINDING_MISMATCH") return;
    appendUnderLock(entries, { at: utcIso(clock()), epoch, type: "HALT", reason: "ACCOUNT_BINDING_MISMATCH", detail: redact(detail), sticky: false });
  }

  function isRiskIncreasingEntry(mutation: BrokerMutation): boolean {
    if (mutation.kind !== "submit_order") return false;
    if (typeof mutation.payload !== "object" || mutation.payload === null || Array.isArray(mutation.payload)) return true;
    return (mutation.payload as { readonly intent?: unknown }).intent !== "close";
  }

  /** Suppression check at acquisition: a live rival holder (fresh heartbeat) suppresses; a stale one may be fenced. */
  function liveRivalHolder(): string | null {
    const holder = readHolder(paths);
    if (holder === null || holder.holderId === instanceId) return null;
    if (shouldAttemptTakeover(clock() - holder.heartbeatAt, options.lockTakeoverBoundMs)) return null;
    return holder.holderId;
  }

  async function dispatchUnderLock(request: MutationRequest): Promise<DispatchResult> {
    const mutationDeadline = request.action.kind === "broker_mutation" ? request.action.mutation.notAfterMs : undefined;
    const deadlineAtMs = request.class === "authoritative"
      ? request.deadlineAtMs === undefined ? mutationDeadline : mutationDeadline === undefined ? request.deadlineAtMs : Math.min(request.deadlineAtMs, mutationDeadline)
      : undefined;
    if (deadlineAtMs !== undefined && clock() >= deadlineAtMs) {
      return { ok: false, reason: "CYCLE_WALLTIME_EXCEEDED", lockHeld: true };
    }
    const store = readEpochStore(paths);
    const entryType = request.action.kind === "journal_append" ? String((request.action.entry as { readonly type?: unknown }).type) : "";
    const authorization = authorizeMutation(
      request.class === "authoritative"
        ? { class: "authoritative", epoch: request.epoch, action: request.action.kind === "journal_append" ? { kind: "journal_append", entryType } : { kind: "broker_mutation" } }
        : { class: "witness", action: request.action.kind === "journal_append" ? { kind: "journal_append", entryType } : { kind: "broker_mutation" } },
      store,
    );
    if (!authorization.authorized) return { ok: false, reason: authorization.reason, lockHeld: true };

    // R47-A1: the fifth place this rule was missing, and the first where the
    // journal was not merely unwritable but unREADABLE. A Windows handle with
    // FileShare.None on the journal alone makes `loadJournal` throw EBUSY
    // below, and every line after it -- including the halt marking -- never
    // runs; once the handle is released the same writer accepts a
    // risk-increasing order with no human release. So a HALT marks HERE,
    // before the journal is touched at all. The mark is a claim about the
    // epoch store and it may not be made conditional on a second file being
    // available. Nothing else moves: authorization is already decided above,
    // and a request that is refused there never reaches this line.
    const haltReason = request.action.kind === "journal_append"
      ? (request.action.entry as { readonly reason?: unknown }).reason
      : undefined;
    const haltMark = entryType === "HALT"
      ? markFenceBeforeHalt(typeof haltReason === "string" ? haltReason : "HALT")
      : { ok: true as const };

    const loaded = loadJournal();
    if ("corrupt" in loaded) {
      return {
        ok: false,
        reason: haltMark.ok ? "JOURNAL_CORRUPT" : `JOURNAL_CORRUPT:FENCE_NOT_MARKED:${haltMark.reason}`,
        lockHeld: true,
      };
    }
    const entries = loaded.file.parsed.entries;

    if (request.class === "witness") {
      if (request.action.kind !== "journal_append") return { ok: false, reason: "WITNESS_CANNOT_MUTATE_BROKER", lockHeld: true };
      const draft = request.action.entry;
      const witnessInstance = (draft as { readonly instanceId?: unknown }).instanceId;
      // One witness line per instance, whatever its type: a suppressed instance never held an epoch, a fenced one was never suppressed.
      if (entries.some(entry => isWitnessEntryType(entry.type) && entry["instanceId"] === witnessInstance)) return { ok: false, reason: "WITNESS_ALREADY_RECORDED", lockHeld: true };
      const appended = appendUnderLock(entries, draft);
      return appended.ok ? { ok: true, seq: appended.entry.seq, stalenessNeutral: true } : { ok: false, reason: appended.reason, lockHeld: true };
    }

    // G1-F1: matching the epoch is necessary, not sufficient — the store names the instance that acquired it.
    if (store.kind !== "present" || store.holderId !== instanceId) return { ok: false, reason: "NOT_THE_WRITER", lockHeld: true };
    const epoch = request.epoch as number;
    // G3-F2: a persisted holder id is not an acquisition. A restarted process with the same id must acquire again;
    // the epoch it presents must be the one this gateway instance won.
    if (ownEpoch !== epoch) return { ok: false, reason: "NOT_ACQUIRED_IN_PROCESS", lockHeld: true };
    if (store.seedPending) {
      const isSeedEntry = request.action.kind === "journal_append" && entryType === "BOOTSTRAP" && (request.action.entry as { readonly epochSeeded?: unknown }).epochSeeded === true;
      if (!isSeedEntry) return { ok: false, reason: "SEED_NOT_JOURNALED", lockHeld: true };
    }

    if (request.action.kind === "broker_mutation") {
      if (options.binding === undefined) return { ok: false, reason: "NO_ACCOUNT_BINDING", lockHeld: true };
      if (!bindingsEqual(options.binding, request.action.mutation.binding)) {
        haltForBindingMismatch(entries, epoch, `broker mutation ${request.action.mutation.kind} carried a foreign binding`);
        return { ok: false, reason: "ACCOUNT_BINDING_MISMATCH", lockHeld: true };
      }
      // The snapshot's halt bit can become stale after phase 0. Reconcile the
      // journal-authoritative state and its persisted projection while holding
      // the final gateway mutex so a concurrent monotonic safety halt vetoes
      // an entry before broker I/O, including after a projection-write crash.
      // Explicit close submissions, cancels and close_position remain usable
      // for reconciliation and flattening under S-G12-03.
      if (isRiskIncreasingEntry(request.action.mutation) && effectiveHaltState(entries).halted) {
        return { ok: false, reason: "HALT", lockHeld: true };
      }
      try {
        const broker = await options.brokerPort.mutate(request.action.mutation);
        // A request begun in time can still settle remotely after the hard
        // cycle boundary. It is never reported as success: the caller must
        // retain the reservation and reconcile it as a lost acknowledgement.
        if (deadlineAtMs !== undefined && clock() >= deadlineAtMs) {
          return { ok: false, reason: "PORT_ERROR:CYCLE_WALLTIME_EXCEEDED", lockHeld: true, source: "broker_port" };
        }
        return broker.ok ? { ok: true, broker } : { ok: false, reason: redact(broker.reason), lockHeld: true, source: "broker_port" };
      } catch (error) {
        if (error instanceof AccountBindingError) {
          haltForBindingMismatch(entries, epoch, error.message);
          return { ok: false, reason: "ACCOUNT_BINDING_MISMATCH", lockHeld: true, source: "broker_port" };
        }
        // The port threw after the gateway authorized: the order may or may not exist at the broker (S-CYC-04).
        const httpStatus = httpStatusOf(error);
        return { ok: false, reason: `PORT_ERROR:${redact(messageOf(error))}`, lockHeld: true, source: "broker_port", ...(httpStatus === null ? {} : { httpStatus }) };
      }
    }

    const draft = request.action.entry;
    if (entryType === "UNHALT") return { ok: false, reason: "UNHALT_REQUIRES_MANUAL_PATH", lockHeld: true };
    if (isWitnessEntryType(entryType)) return { ok: false, reason: "AUTHORITATIVE_TYPE_REQUIRED", lockHeld: true };
    // G3-F1: the line that lands must claim the epoch that authorized it, not one the caller chose.
    if ((draft as { readonly epoch?: unknown }).epoch !== epoch) return { ok: false, reason: "ENTRY_EPOCH_MISMATCH", lockHeld: true };
    if (options.binding !== undefined && (entryType === "INTENT" || entryType === "OUTCOME")) {
      const entryBinding = (draft as { readonly binding?: unknown }).binding;
      const bindingRecord = typeof entryBinding === "object" && entryBinding !== null ? entryBinding as Partial<AccountBinding> : {};
      if (typeof bindingRecord.profile !== "string" || typeof bindingRecord.tradingOrigin !== "string" || typeof bindingRecord.accountId !== "string"
        || !bindingsEqual(options.binding, { profile: bindingRecord.profile, tradingOrigin: bindingRecord.tradingOrigin, accountId: bindingRecord.accountId })) {
        haltForBindingMismatch(entries, epoch, `${entryType} carried a foreign binding`);
        return { ok: false, reason: "ACCOUNT_BINDING_MISMATCH", lockHeld: true };
      }
    }
    // R46-A2 set the mark for every halt rather than for two reasons; R47-A1
    // moved it above the journal read, because an unreadable journal skipped
    // it entirely. `haltMark` therefore already holds that result here, and
    // the append only reports it: a failure that ALSO lost the mark is the
    // declared residual of S-G12-08 and has to be distinguishable from one
    // where the deployment is fenced.
    const appended = appendUnderLock(entries, draft);
    if (!appended.ok) {
      return {
        ok: false,
        reason: haltMark.ok ? appended.reason : `${appended.reason}:FENCE_NOT_MARKED:${haltMark.reason}`,
        lockHeld: true,
      };
    }
    if (store.seedPending) writeEpochStore(paths, { epoch: store.epoch, holderId: store.holderId, acquiredAt: store.acquiredAt, seedPending: false, resetPending: false });
    return { ok: true, seq: appended.entry.seq, stalenessNeutral: false };
  }

  function acquireUnderLock(observed: EpochStoreState, evidence: { readonly account: AccountVirginity }): AcquisitionResult {
    const fresh = readEpochStore(paths);
    // Observed outside the mutex: the epoch this taker expects to increment. Of two concurrent takers exactly one
    // still sees it inside the mutex; the other observes the change and demotes itself to a witness.
    if (fresh.kind === "present" && !(observed.kind === "present" && observed.epoch === fresh.epoch)) {
      return { kind: "LOST", observedEpoch: fresh.epoch };
    }
    const rival = liveRivalHolder();
    if (rival !== null) return { kind: "SUPPRESSED", holderId: rival, reason: "LOCK_HELD" };
    const loaded = loadJournal();
    if ("corrupt" in loaded) return { kind: "REFUSED", reason: "JOURNAL_CORRUPT" };
    const entries = loaded.file.parsed.entries;
    const plan = planEpochAcquisition(fresh, { account: evidence.account, journalEmpty: entries.length === 0 });
    const now = clock();
    switch (plan.kind) {
      case "REFUSE":
        return { kind: "REFUSED", reason: plan.reason };
      case "SEED_BOOTSTRAP":
        writeEpochStore(paths, { epoch: plan.epoch, holderId: instanceId, acquiredAt: utcIso(now), seedPending: true, resetPending: false });
        writeHolder(paths, { holderId: instanceId, heartbeatAt: now });
        ownEpoch = plan.epoch;
        return { kind: "WON", epoch: plan.epoch, seeded: "bootstrap" };
      case "SEED_GAP":
        // G5-F1: the reset is a persisted *pending* acquisition. The store is written first with resetPending: true —
        // an epoch that authorizes nothing — then the GAP/HALT pair and the flag are completed under it, then it is
        // promoted. A failed store write leaves nothing behind; an interruption after it leaves a pending store that
        // the next acquirer completes exactly once (`resetPairPresent`) and promotes.
        writeEpochStore(paths, { epoch: plan.epoch, holderId: instanceId, acquiredAt: utcIso(now), seedPending: false, resetPending: true });
        writeHolder(paths, { holderId: instanceId, heartbeatAt: now });
        return completeReset(entries, plan.epoch, now);
      case "INCREMENT": {
        const decision = compareAndIncrement(fresh, plan.expected);
        if (decision.kind === "REFUSE") return { kind: "REFUSED", reason: decision.reason };
        if (decision.kind === "CHANGED") return { kind: "LOST", observedEpoch: decision.observed };
        // G2-F1: a seed that has not been journaled yet is inherited by the new acquirer, never cleared by acquisition.
        // G5-F1: likewise a pending reset is inherited and completed by the new acquirer under its own epoch.
        // S-G12-08: and so is an unreleased credential fence — a restart, a takeover or any other acquisition
        // must not be a way to get trading back without the human release the fence is waiting for.
        writeEpochStore(paths, { epoch: decision.next, holderId: instanceId, acquiredAt: utcIso(now), seedPending: plan.seedPending, resetPending: plan.resetPending, fencePending: plan.fencePending });
        writeHolder(paths, { holderId: instanceId, heartbeatAt: now });
        if (plan.resetPending) return completeReset(entries, decision.next, now);
        ownEpoch = decision.next;
        return { kind: "WON", epoch: decision.next, seeded: plan.seedPending ? "bootstrap" : null };
      }
    }
  }

  /** Completes a pending reset under `epoch`: appends the GAP/HALT pair unless it is already durable, then promotes the store. */
  function completeReset(entries: readonly JournalEntry[], epoch: number, now: number): AcquisitionResult {
    let current = entries;
    if (!resetPairPresent(current)) {
      const gap = appendUnderLock(current, { at: utcIso(now), epoch, type: "GAP", reasonCodes: [], snapshot: null, detail: "epoch store absent or reset outside the virgin bootstrap state; prior authority unknown" });
      if (!gap.ok) return { kind: "REFUSED", reason: gap.reason };
      current = [...current, gap.entry];
      const halt = appendUnderLock(current, { at: utcIso(now), epoch, type: "HALT", reason: "EPOCH_STORE_RESET", detail: "epoch store re-seeded on the GAP path; reconcile before un-halt", sticky: false });
      if (!halt.ok) return { kind: "REFUSED", reason: halt.reason };
    } else {
      // The pair is durable from an interrupted attempt; make the flag durable too before promoting.
      writeHaltState(paths, haltStateFrom(current));
    }
    writeEpochStore(paths, { epoch, holderId: instanceId, acquiredAt: utcIso(now), seedPending: false, resetPending: false });
    ownEpoch = epoch;
    return { kind: "GAP_HALT", epoch };
  }

  return {
    async openJournal() {
      return withMutex(paths, () => {
        const loaded = loadJournal();
        if ("corrupt" in loaded) throw new Error(loaded.corrupt);
        const entries = loaded.file.parsed.entries;
        return { entries, quarantined: loaded.quarantined === null ? [] : [loaded.quarantined], halt: effectiveHaltState(entries) };
      });
    },

    async openJournalAsWriter(epoch) {
      return withMutex(paths, () => {
        const store = readEpochStore(paths);
        if (store.kind !== "present" || store.epoch !== epoch || store.holderId !== instanceId || ownEpoch !== epoch || store.seedPending || store.resetPending) return null;
        const loaded = loadJournal();
        if ("corrupt" in loaded) throw new Error(loaded.corrupt);
        writeHolder(paths, { holderId: instanceId, heartbeatAt: clock() });
        const entries = loaded.file.parsed.entries;
        return { entries, quarantined: loaded.quarantined === null ? [] : [loaded.quarantined], halt: effectiveHaltState(entries) };
      });
    },

    async acquireAuthority(evidence) {
      const observed = readEpochStore(paths);
      try {
        return await withMutex(paths, () => acquireUnderLock(observed, evidence));
      } catch (error) {
        // A failed durable write (journal, store, holder) is a refusal, never a half-acquired authority.
        return { kind: "REFUSED", reason: redact(messageOf(error)) };
      }
    },

    async heartbeat() {
      return withMutex(paths, () => {
        const store = readEpochStore(paths);
        if (store.kind !== "present" || ownEpoch === null || store.epoch !== ownEpoch) return false;
        writeHolder(paths, { holderId: instanceId, heartbeatAt: clock() });
        return true;
      });
    },

    async dispatch(request) {
      try {
        return await withMutex(paths, () => dispatchUnderLock(request));
      } catch (error) {
        return { ok: false, reason: redact(messageOf(error)), lockHeld: false };
      }
    },

    async dispatchSafetyHalt(action) {
      // Keep the runtime boundary closed too; TypeScript types are not an
      // authorization mechanism for CLI/imported JavaScript callers.
      const reason: unknown = (action as { readonly reason: unknown }).reason;
      if (reason !== "AUTH_FAILURE" && reason !== "ACCOUNT_BINDING_MISMATCH") {
        return { ok: false, reason: "SAFETY_HALT_REASON_NOT_ALLOWED", lockHeld: false };
      }
      try {
        return await withMutex(paths, () => {
          const store = readEpochStore(paths);
          if (store.kind !== "present") {
            return { ok: false, reason: store.kind === "absent" ? "EPOCH_ABSENT" : "EPOCH_UNREADABLE", lockHeld: true };
          }
          // Both reasons this entry point accepts mark, so the reason no
          // longer decides (R44-A1); the shared helper above says why.
          const marked = markFenceBeforeHalt(reason);
          const loaded = loadJournal();
          if ("corrupt" in loaded) {
            return {
              ok: false,
              reason: marked.ok ? "JOURNAL_CORRUPT" : `JOURNAL_CORRUPT:FENCE_NOT_MARKED:${marked.reason}`,
              lockHeld: true,
            };
          }
          const entries = loaded.file.parsed.entries;
          const current = haltStateFrom(entries);
          const transition = [...entries].reverse().find(entry => entry.type === "HALT" || entry.type === "UNHALT");
          if (current.halted && current.reason === reason && transition?.type === "HALT") {
            // Repair a missing/stale projection without weakening the journal state.
            writeHaltState(paths, current);
            return { ok: true, seq: transition.seq, stalenessNeutral: false };
          }
          const appended = appendUnderLock(entries, {
            at: utcIso(clock()),
            epoch: store.epoch,
            type: "HALT",
            reason,
            detail: redact(action.detail),
            sticky: false,
          });
          if (appended.ok) return { ok: true, seq: appended.entry.seq, stalenessNeutral: false };
          // Neither the halt nor the mark landed: this is the one declared
          // residual of S-G12-08, and the caller must alarm rather than assume
          // the deployment is fenced. Naming both failures keeps that visible
          // instead of reporting only the append.
          return {
            ok: false,
            reason: marked.ok ? appended.reason : `${appended.reason}:FENCE_NOT_MARKED:${marked.reason}`,
            lockHeld: true,
          };
        });
      } catch (error) {
        return { ok: false, reason: redact(messageOf(error)), lockHeld: false };
      }
    },

    /**
     * S-G12-08: mark the fence BEFORE the HALT append is attempted, under the
     * same mutex, so a process that dies between the two steps leaves the
     * strict state behind. Only `dispatchManualUnhalt` clears it. Returns the
     * failure when the epoch store itself could not be written — the caller
     * must not treat that as a fence, because it is the case where authority
     * cannot be taken either.
     */
    async markCredentialFence() {
      return withMutex(paths, () => Promise.resolve(setFencePending(paths, true)));
    },

    fencePending() {
      const store = readEpochStore(paths);
      return store.kind === "present" && store.fencePending;
    },

    async dispatchManualUnhalt(action) {
      if (action.operator.trim().length === 0) return { ok: false, reason: "OPERATOR_REQUIRED", lockHeld: false };
      return withMutex(paths, () => {
        const store = readEpochStore(paths);
        if (store.kind !== "present") return { ok: false, reason: store.kind === "absent" ? "EPOCH_ABSENT" : "EPOCH_UNREADABLE", lockHeld: true };
        // G6-F1: the human path is not exempt from the store's obligations. Under a pending reset the pair must stay
        // terminal for recovery; under an unjournaled seed nothing authoritative but the BOOTSTRAP may land.
        if (store.resetPending) return { ok: false, reason: "RESET_PENDING", lockHeld: true };
        if (store.seedPending) return { ok: false, reason: "SEED_NOT_JOURNALED", lockHeld: true };
        if ((action.expectedEpoch !== undefined && store.epoch !== action.expectedEpoch)
          || (action.expectedHolderId !== undefined && store.holderId !== action.expectedHolderId)) {
          return { ok: false, reason: "WRITER_CHANGED_SINCE_RECONCILIATION", lockHeld: true };
        }
        if (action.expectedHolderId !== undefined && readHolder(paths)?.holderId !== action.expectedHolderId) {
          return { ok: false, reason: "WRITER_CHANGED_SINCE_RECONCILIATION", lockHeld: true };
        }
        const loaded = loadJournal();
        if ("corrupt" in loaded) return { ok: false, reason: "JOURNAL_CORRUPT", lockHeld: true };
        const entries = loaded.file.parsed.entries;
        if (action.expectedJournalSeq !== undefined && (entries.at(-1)?.seq ?? 0) !== action.expectedJournalSeq) {
          return { ok: false, reason: "JOURNAL_CHANGED_SINCE_RECONCILIATION", lockHeld: true };
        }
        const current = effectiveHaltState(entries);
        if (!current.halted) return { ok: false, reason: "NOT_HALTED", lockHeld: true };
        if (current.sticky) return { ok: false, reason: "HALT_IS_STICKY", lockHeld: true };
        if (action.expectedHaltSeq !== undefined || action.expectedHaltReason !== undefined) {
          const transition = [...entries].reverse().find(entry => entry.type === "HALT" || entry.type === "UNHALT");
          if (transition === undefined || transition.type !== "HALT"
            || (action.expectedHaltSeq !== undefined && transition.seq !== action.expectedHaltSeq)
            || (action.expectedHaltReason !== undefined && transition["reason"] !== action.expectedHaltReason)) {
            return { ok: false, reason: "HALT_CHANGED_SINCE_RECONCILIATION", lockHeld: true };
          }
        }
        // S-G12-08, ordering: the release is only a release once it is DURABLE.
        // The fence mark is therefore cleared strictly AFTER the UNHALT entry
        // has landed, and only then. Clearing it earlier — which is what this
        // did until 2026-09-05, R43-A1 — meant a release refused by the CAS
        // check, or one whose append threw on an unwritable journal, still
        // removed the only fence that was standing: the operator saw a failure
        // and the deployment was quietly free to trade again.
        const appended = appendUnderLock(entries, { at: utcIso(clock()), epoch: store.epoch, type: "UNHALT", operator: action.operator, reason: action.reason, actor: "human" });
        if (!appended.ok) return { ok: false, reason: appended.reason, lockHeld: true };
        if (store.fencePending) {
          const cleared = setFencePending(paths, false);
          // The UNHALT is journaled but the mark could not be lifted, so the
          // deployment stays fenced and the operator is told exactly that.
          // Fail-closed: a second release attempt clears it once the store is
          // writable again. The same state survives a process death between
          // these two writes, for the same reason and with the same recovery.
          if (!cleared.ok) return { ok: false, reason: `FENCE_NOT_CLEARED:${cleared.reason}`, lockHeld: true };
        }
        return { ok: true, seq: appended.entry.seq, stalenessNeutral: false };
      });
    },
  };
}
