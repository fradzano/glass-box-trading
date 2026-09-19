// One invocation of the activation CLI, from the command line to the exit code (unit 10).
//
// This is the imperative shell of the activation: it holds the lease, spends the reads,
// applies what the core decided and appends what happened. It decides nothing about the
// activation itself — `decide()` does that — and it performs no I/O of its own: every
// port arrives as a parameter, which is what lets the whole orchestration be tested
// against fakes long before unit 13 binds it to this host.
//
// Two orderings in here are deliberate and must not be tidied away:
//
//   * The owner's abort disables both tasks **before** it takes the lease (spec §5,
//     ACT-27). A deliberate stop that waits for a running invocation's lease is a stop
//     that did not happen when it was typed.
//   * `disarm` fails **safe**, not closed: a ledger it cannot read disables both tasks
//     rather than aborting. Residual G1 (an unparseable `ledger.lock`) would otherwise
//     turn the one command whose job is to disable into the one command that cannot.
import { randomUUID } from "node:crypto";
import { applyAction } from "../actions/apply.ts";
import type { ActionContext, ActionPorts } from "../actions/apply.ts";
import { compensationFor, stopMarkLine, stopRefusal } from "../core/stop.ts";
import type { StopMark, StopMarkState } from "../core/stop.ts";
import { clearStopMark, readStopMark, writeStopLiftFailure, writeStopMark } from "../store/stop-mark.ts";
import type { StopClearResult } from "../store/stop-mark.ts";
import { abortTeardown, decide, fullTeardown } from "../core/decide.ts";
import { foldLedgerSnapshot, stepDone } from "../core/fold.ts";
import type { LedgerFold } from "../core/fold.ts";
import { LedgerStoreError, withActivationLedger } from "../store/ledger-store.ts";
import type { ActivationLedgerSession, ActivationLedgerSnapshot, LedgerLockOwner } from "../store/ledger-store.ts";
import type { LedgerDraft } from "../core/ledger.ts";
import type { ObservationPlan } from "../readers/observe.ts";
import type { Observations, Schedule, TaskName, WorldAction } from "../core/types.ts";
import type { ActivationInvocation } from "./args.ts";
import { buildSchedule } from "./schedule.ts";
import type { DeploymentFacts, ToLocal } from "./schedule.ts";
import {
  abortDraft,
  classifyStoreFailure,
  intentDraft,
  monotonicStamp,
  nextAttemptId,
  observationPlanFor,
  openingDraft,
  ownerAbortDraft,
  ownerAbortRepeatDraft,
  ownerAbortWithoutAttemptDraft,
  recordDraft,
  resultDraft,
  stopVerdictClause,
  systemDraftFactory,
  teardownClauseOrSilence,
  waitNoteDraft,
} from "./plan.ts";
import type { ActionReport, InvocationOutcome, StampAt } from "./plan.ts";

const BOTH_TASKS: readonly TaskName[] = ["cycle", "watchdog"];

export interface InvocationDeps {
  readonly now: () => number;
  /** A UTC instant as the ledger wants it: local time with its offset. */
  readonly stampAt: StampAt;
  readonly toLocal: ToLocal;
  readonly owner: LedgerLockOwner;
  /**
   * The two paths every command knows without reading anything: the checkout the
   * compiled entry point lives in, and the `--state-root` it was given. They used to be
   * reached through `facts`, which meant a command that needs no measured fact still
   * could not run without the file that carries them.
   */
  readonly repoRoot: string;
  readonly activationRoot: string;
  /**
   * What had to be **measured off this host** — the masked long-run account, the coverage
   * date, the disk floor, the expected preconditions. `null` when
   * `ops/activation/deployment.json` is absent or unreadable.
   *
   * It is nullable because three commands consume none of it and must not be held
   * hostage by it: `status` reads the ledger, `abort` is the owner's typed stop, and
   * `disarm` is the 15:05 one-shot whose entire purpose is to make the deployment safe.
   * A missing host file used to refuse all five commands alike, so the two that exist to
   * end a run could be stopped by the file that describes it.
   */
  readonly facts: DeploymentFacts | null;
  /** The `.env` the certificate line lives in. */
  readonly envFile: string;
  /** Unit 7's observation path, already bound to this host and the activation root. */
  readonly observe: (plan: ObservationPlan) => Promise<Observations>;
  /**
   * Unit 8's action ports. `null` until unit 13 binds them to this host (DECISIONS,
   * 2026-09-14): with no bindings the CLI reads, decides and records, and refuses to
   * claim any action it cannot perform.
   */
  readonly actions: ActionPorts | null;
  readonly print: (line: string) => void;
  /** Reading the ledger without taking the lease — `status` only. */
  readonly readLedger?: (root: string) => Promise<ActivationLedgerSnapshot>;
  readonly withLedger?: typeof withActivationLedger;
  /**
   * The owner's stop mark (`core/stop.ts`, SC-2 to SC-8). It is a port like every other,
   * so a test can make the read fail — which is a state the contract has an answer for —
   * without making a file unreadable on the machine it runs on.
   */
  readonly readStopMark?: (root: string) => Promise<StopMarkState>;
  readonly writeStopMark?: (root: string, mark: StopMark) => Promise<void>;
  /** Compare-and-delete: it lifts the stop whose id was read, and no other (R4-01). */
  readonly clearStopMark?: (root: string, expectedId: string) => Promise<StopClearResult>;
  /**
   * What makes one stop distinguishable from the next. It is a port because randomness is
   * not the core's and not this module's: the shell supplies it, a test pins it.
   */
  readonly newStopId?: () => string;
}

/** The four actions the owner's stop owes the world, in the order it applies them. */
const STOP_TEARDOWN: readonly WorldAction[] = [
  { kind: "disable-tasks", tasks: BOTH_TASKS },
  { kind: "remove-certificate-line" },
  { kind: "delete-disarm" },
  { kind: "clear-checks" },
];

/**
 * What the confirming pass re-applies under the lease (SC-4). `clear-checks` is left out
 * deliberately: it sends a real success ping per endpoint, it changes nothing about
 * whether the deployment can trade, and sending three more of them would make the stop's
 * own evidence noisier without making it truer. The three that remain are the ones an
 * invocation racing the stop could have undone.
 */
const STOP_CONFIRMATION: readonly WorldAction[] = [
  { kind: "disable-tasks", tasks: BOTH_TASKS },
  { kind: "remove-certificate-line" },
  { kind: "delete-disarm" },
];

/** Whether this action arms the deployment, asked of the action rather than of its kind. */
function armsDeploymentAction(action: WorldAction): boolean {
  return stopRefusal(action.kind, { kind: "present", mark: { id: "", operator: "", at: "", atUtcMs: 0, reason: "" } }) !== null;
}

/** Reasons that mean "nothing was attempted", as opposed to "something was attempted and failed". */
const NOT_ATTEMPTED: readonly string[] = ["NO_HOST_BINDINGS", "DRY_RUN"];

/**
 * How much of a stop stands, from the reports and the mark alone (SC-4, SC-6).
 *
 * `no-bindings` is not a euphemism for success: it is the state of this deployment until
 * unit 13 binds the ports, and the sentence the owner reads says so. Keeping it apart
 * from `confirmed` is what stops "the stop ran" from meaning two different things.
 */
type StopVerdict = "confirmed" | "no-bindings" | "unconfirmed";

function stopVerdict(reports: readonly ActionReport[], markFailure: string | null): StopVerdict {
  if (markFailure !== null) return "unconfirmed";
  if (reports.some(report => !report.applied && !NOT_ATTEMPTED.includes(report.reason ?? ""))) return "unconfirmed";
  return reports.some(report => report.applied) ? "confirmed" : "no-bindings";
}

export interface InvocationResult {
  readonly outcome: InvocationOutcome;
  /** What the invocation did to the world, in order; empty when it touched nothing. */
  readonly applied: readonly ActionReport[];
  readonly fold: LedgerFold | null;
  readonly schedule: Schedule | null;
}

/**
 * The default identity of a stop: unique per typed stop, and never reused.
 *
 * Deliberately **not** a UUID. The ledger codec refuses UUID-shaped values anywhere in
 * `evidence`, by shape rather than by field name, because a healthchecks ping URL carries
 * one and the 2026-09-12 exposure came from a deny-list that forgot a field. The id goes
 * into the opening entry, so it has to be an identifier that cannot be mistaken for a
 * credential — found by that rule firing on the first run of this code.
 */
function defaultStopId(): string {
  return `stop-${String(Date.now())}-${randomUUID().replaceAll("-", "").slice(0, 8)}`;
}

function refuse(reason: string): InvocationResult {
  return { outcome: { kind: "refused", reason }, applied: [], fold: null, schedule: null };
}

function storeFailure(error: unknown, carried: readonly ActionReport[] = []): InvocationOutcome {
  // SC-7: whatever the failure is classified as, what this invocation already did to the
  // world travels with it. The classification decides which number the task history gets;
  // it never decides whether the owner is told that both tasks were disabled.
  if (error instanceof LedgerStoreError) return classifyStoreFailure(error.stage, error.reason, carried);
  return { kind: "work-failed", reason: "the invocation failed outside the store's own stages", teardown: carried };
}

/**
 * Applies actions in order. `stopAtFirstFailure` separates the two contracts this CLI
 * has to honour and which are not the same: an `act` stops at the first failure, because
 * the steps after it were decided against a world that no longer holds
 * (`core/types.ts`), while a teardown does **all** of its parts — a disable that failed
 * is no reason to leave the certificate line in place.
 *
 * Without bindings, or in a dry run, nothing is applied and every action is reported as
 * refused with the reason — never as applied.
 */
export interface ApplyOptions {
  readonly ports: ActionPorts | null;
  readonly context: ActionContext;
  readonly dryRun: boolean;
  readonly print: (line: string) => void;
  readonly stopAtFirstFailure: boolean;
  /**
   * SC-3: the owner's stop, read **fresh immediately before each action**. Not once per
   * invocation: the whole case this exists for is an invocation that decided before the
   * stop and applies after it, so a value read at the top of the invocation would be the
   * same stale answer that produced R2-03.
   */
  readonly readStop: () => Promise<StopMarkState>;
}

export async function applyAll(actions: readonly WorldAction[], options: ApplyOptions): Promise<readonly ActionReport[]> {
  const { ports, context, dryRun, print, stopAtFirstFailure } = options;
  const reports: ActionReport[] = [];
  for (const action of actions) {
    // Before anything else, including the dry run: a rehearsal of an action that the
    // world would refuse has to show the refusal, or the rehearsal is a different
    // invocation from the one it rehearses.
    const refusal = stopRefusal(action.kind, await options.readStop());
    if (refusal !== null) {
      print(`refusing ${action.kind}: ${refusal}`);
      reports.push({ kind: action.kind, applied: false, detail: null, reason: refusal, completion: null });
      if (stopAtFirstFailure) break;
      continue;
    }
    if (dryRun || ports === null) {
      const reason = dryRun ? "DRY_RUN" : "NO_HOST_BINDINGS";
      print(`would ${action.kind}${action.kind === "enable-tasks" || action.kind === "disable-tasks" ? ` ${action.tasks.join(", ")}` : ""}`);
      reports.push({ kind: action.kind, applied: false, detail: null, reason, completion: null });
      // A dry run prints *every* intended action (spec §9): the rehearsal exists to show
      // the owner the whole step, not its first line, so the loop deliberately runs on.
      // Without bindings there is nothing to be careful about either, since nothing is
      // attempted at all.
      continue;
    }
    const result = await applyAction(action, ports, context);
    if (result.ok) {
      reports.push({ kind: action.kind, applied: true, detail: result.value.detail, reason: null, completion: result.value.completion });
      // SC-3a: the guard before an action closes the window *between* actions; this closes
      // the window *inside* one. An effect that takes time — a real `Enable-ScheduledTask`
      // does — can land after a stop was typed, and the stop may be unable to take the
      // lease to undo it, because this invocation is holding it. Measured as two operating
      // system processes over one file-backed world: the deployment ended armed. So the
      // invocation that applied the effect undoes it, needing nobody's lease.
      const after = await options.readStop();
      if (after.kind !== "absent" && armsDeploymentAction(action)) {
        const compensation = compensationFor(action.kind, action.kind === "enable-tasks" || action.kind === "disable-tasks" ? action.tasks : BOTH_TASKS);
        if (compensation === null) {
          print(`WARNING: ${action.kind} cannot be undone, and a stop was typed while it ran`);
          reports.push({ kind: action.kind, applied: false, detail: null, reason: "STOPPED_BY_OWNER_AFTER_EFFECT_NOT_UNDOABLE", completion: null });
        } else {
          const undo = await applyAction(compensation, ports, context);
          print(`undoing ${action.kind}: a stop was typed while it was being applied`);
          reports.push(undo.ok
            ? { kind: compensation.kind, applied: true, detail: { ...undo.value.detail, compensates: action.kind }, reason: null, completion: undo.value.completion }
            : { kind: compensation.kind, applied: false, detail: null, reason: `COMPENSATION_FAILED:${undo.reason}`, completion: null });
        }
        if (stopAtFirstFailure) break;
      }
      continue;
    }
    reports.push({ kind: action.kind, applied: false, detail: null, reason: result.reason, completion: null });
    if (stopAtFirstFailure) break;
  }
  return reports;
}

/**
 * Applies the teardown a decision owes the world.
 *
 * The list comes from the core — `abortTeardown` in `core/decide.ts` — and is not
 * rebuilt here. It used to be: the core returned a boolean and this file turned it back
 * into `[{ disable-tasks }]`, one action where spec §5 names two, so every automatic
 * abort left `PRE_ARM_CERTIFICATE` in `.env` while reporting a completed teardown. The
 * shell's job is to apply what it is handed, and `stopAtFirstFailure: false` because a
 * disable that failed is no reason to leave the certificate line in place.
 */
export async function applyTeardown(teardown: readonly WorldAction[], options: Omit<ApplyOptions, "stopAtFirstFailure">): Promise<readonly ActionReport[]> {
  return applyAll(teardown, { ...options, stopAtFirstFailure: false });
}

function contextFor(deps: InvocationDeps, schedule: Schedule, observations: Observations | null): ActionContext | null {
  const boundary = observations?.executionBoundary;
  if (boundary === undefined || !boundary.known) return null;
  return {
    envFile: deps.envFile,
    repoRoot: schedule.repoRoot,
    activationRoot: schedule.activationRoot,
    anchorDay: schedule.anchorDay,
    nodePath: boundary.value.nodePath,
    taskUserId: boundary.value.taskUserId,
    taskUserSid: boundary.value.taskUserSid,
    platform: process.platform,
  };
}

/**
 * A context for the actions an abort or a disarm owes even when no observation was taken
 * — disabling a task needs the task's name, not this host's identity. The fields that
 * only matter to the certificate write are empty on purpose: `applyAction` refuses a
 * certificate write without them, which is the safe direction.
 */
function teardownContext(deps: InvocationDeps, anchorDay: string): ActionContext {
  return { envFile: deps.envFile, repoRoot: deps.repoRoot, activationRoot: deps.activationRoot, anchorDay, nodePath: "", taskUserId: "", taskUserSid: "", platform: process.platform };
}

/**
 * The owner's abort knows no anchor day: it is typed at a keyboard, not scheduled, and
 * it names no day on its command line. None of its four actions may use one —
 * `register-disarm` is the only action that reads `anchorDay`, and it is not among them
 * — so the field is empty rather than guessed. `applyAction` refuses a registration
 * without it, which is the safe direction.
 */
function ownerContext(deps: InvocationDeps): ActionContext {
  return { envFile: deps.envFile, repoRoot: deps.repoRoot, activationRoot: deps.activationRoot, anchorDay: "", nodePath: "", taskUserId: "", taskUserSid: "", platform: process.platform };
}

/**
 * One place that says how an action application is set up, so that no call site can
 * forget the stop guard. The read is a closure over the state root: `applyAll` calls it
 * again before every single action.
 */
function applyOptionsFor(invocation: ActivationInvocation, deps: InvocationDeps, context: ActionContext, stopAtFirstFailure: boolean): ApplyOptions {
  const read = deps.readStopMark ?? readStopMark;
  return {
    ports: deps.actions,
    context,
    dryRun: invocation.dryRun,
    print: deps.print,
    stopAtFirstFailure,
    readStop: () => read(invocation.stateRoot),
  };
}

async function append(session: ActivationLedgerSession, draft: LedgerDraft): Promise<void> {
  await session.append(draft);
}

/** `status`: the one command that takes no lease and appends nothing. */
async function status(invocation: ActivationInvocation, deps: InvocationDeps): Promise<InvocationResult> {
  const read = deps.readLedger;
  if (read === undefined) return refuse("no ledger reader is bound");
  // SC-9: a stop is visible without reading the ledger, and it is printed before the
  // ledger page, because it changes what every line after it means.
  deps.print(stopMarkLine(await (deps.readStopMark ?? readStopMark)(invocation.stateRoot)));
  const snapshot = await read(invocation.stateRoot);
  const fold = foldLedgerSnapshot(snapshot);
  const anchorDay = fold.currentAttempt?.anchorDay ?? null;
  // The schedule is only a projection for the reader. Without the measured facts there
  // is nothing to project and the ledger still reports in full.
  const facts = deps.facts;
  const built = anchorDay === null || facts === null ? null : buildSchedule(anchorDay, facts, deps.toLocal);
  return { outcome: { kind: "reported" }, applied: [], fold, schedule: built !== null && built.ok ? built.schedule : null };
}

/**
 * `run`: what the scheduled task invokes every five minutes.
 *
 * `carried` is the caller's array, not a copy: a teardown that ran inside the lease has to
 * reach the caller even when the invocation leaves through a throw, and a return value
 * cannot carry anything past one.
 */
async function run(invocation: ActivationInvocation, deps: InvocationDeps, schedule: Schedule, carried: ActionReport[] = []): Promise<InvocationResult> {
  const withLedger = deps.withLedger ?? withActivationLedger;
  const anchorDay = schedule.anchorDay;
  let applied: readonly ActionReport[] = [];
  let fold: LedgerFold | null = null;

  /**
   * Every action this invocation applies goes through here, and `carried` is what leaves
   * through a throw (SC-7, R4-03).
   *
   * The previous version populated `carried` at exactly one place — the result-append
   * catch at the gate — and the contract claimed every exit after effects carried them.
   * Executed by the review of 2026-09-19: the **opening** branch disabled both tasks and
   * removed the certificate line, its note then failed to append, and the owner was told
   * `ledger-defect` with `teardown: []` and `applied: []`. A single accumulator, written
   * where the effect happens, is what makes that claim true rather than intended.
   */
  const carry = async (actions: readonly WorldAction[], options: ApplyOptions): Promise<readonly ActionReport[]> => {
    const reports = await applyAll(actions, options);
    carried.push(...reports);
    return reports;
  };

  const result = await withLedger<InvocationOutcome>(
    {
      root: invocation.stateRoot,
      owner: deps.owner,
      makeSystemDraft: systemDraftFactory({ nowUtcMs: deps.now(), stampAt: deps.stampAt, attempt: nextAttemptId([], anchorDay), anchorDay }),
    },
    async session => {
      const snapshot = await session.read();
      fold = foldLedgerSnapshot(snapshot);
      const tail = { lastSeq: snapshot.entries.at(-1)?.seq ?? 0, lastAtUtcMs: snapshot.entries.at(-1)?.atUtcMs ?? null };
      const stamp = monotonicStamp(deps.stampAt(deps.now()), tail, deps.stampAt);

      // Spec §4: an absent or empty ledger disables both tasks, pages, and opens a new
      // attempt whose first entry records what was found. It does not also act: the next
      // invocation decides, against a ledger that now says where the attempt starts.
      //
      // The second case is the retry of spec §5. An ended attempt for an *earlier* anchor
      // day is history: the new day resets steps 4 and 7 to 11 anyway, so this invocation
      // opens the new day's attempt itself. An ended attempt for *this* anchor day is not
      // reopened here — a same-day retry is the owner's decision and needs
      // `activation open`, or an abort at 22:30 would be undone by the tick at 22:35.
      const ended = fold.attemptEnded !== null;
      const otherDay = fold.currentAttempt !== null && fold.currentAttempt.anchorDay !== anchorDay;
      if (fold.currentAttempt === null || (ended && otherDay)) {
        const found = fold.currentAttempt !== null
          ? `PREVIOUS_ATTEMPT_ENDED_${fold.currentAttempt.anchorDay}`
          : snapshot.state === "absent" ? "LEDGER_ABSENT" : snapshot.state === "empty" ? "LEDGER_EMPTY" : `LEDGER_${snapshot.state.toUpperCase()}`;
        if (fold.currentAttempt === null && snapshot.state !== "absent" && snapshot.state !== "empty") {
          return { kind: "ledger-defect", stage: "read-ledger", reason: found };
        }
        // `fullTeardown`, not `abortTeardown`, and for the same reason as
        // `SCHEDULE_NOT_FOR_THIS_ATTEMPT`: the fold's answer about the gate belongs to the
        // attempt being left behind, not to the day being opened. A previous attempt that
        // reached step 10 and then aborted at step 11 reads `stepDone(fold, "10-gate")`
        // true, so `abortTeardown` would owe **nothing** — and a new anchor day would
        // start on top of the old day's enabled tasks and certificate line. A new day
        // begins clean or it does not begin.
        applied = await carry(fullTeardown(), applyOptionsFor(invocation, deps, teardownContext(deps, schedule.anchorDay), false));
        const attempt = nextAttemptId(snapshot.entries, anchorDay);
        if (!invocation.dryRun) {
          await append(session, openingDraft(found, attempt, anchorDay, stamp, { teardown: applied.map(report => ({ kind: report.kind, applied: report.applied, reason: report.reason })) }));
        }
        return { kind: "opened", attempt, found };
      }

      const attempt = fold.currentAttempt.id;
      const observations = await deps.observe(observationPlanFor(fold));
      const decision = decide(fold, observations, schedule);

      switch (decision.kind) {
        case "wait": {
          const drafted = waitNoteDraft(decision.reason, fold, attempt, anchorDay, stamp);
          if (drafted !== null && !invocation.dryRun) await append(session, drafted);
          return { kind: "waited", reason: decision.reason, noted: drafted !== null && !invocation.dryRun };
        }
        case "ended":
          return { kind: "ended", seq: decision.seq, reason: decision.reason };
        case "done":
          return { kind: "done", reason: decision.reason };
        case "record": {
          if (!invocation.dryRun) await append(session, recordDraft(decision, attempt, anchorDay, stamp));
          return { kind: "recorded", step: decision.step, outcome: decision.outcome };
        }
        case "abort": {
          applied = await carry(decision.teardown, applyOptionsFor(invocation, deps, contextFor(deps, schedule, observations) ?? teardownContext(deps, schedule.anchorDay), false));
          if (!invocation.dryRun) await append(session, abortDraft(decision, attempt, anchorDay, stamp));
          return { kind: "aborted", step: decision.step, reason: decision.reason, teardown: applied, nextOwnerAction: decision.nextOwnerAction };
        }
        case "act": {
          const context = contextFor(deps, schedule, observations);
          if (context === null) {
            return { kind: "work-failed", reason: "the execution boundary could not be read, so no action may be attributed to this host" };
          }
          if (!invocation.dryRun) await append(session, intentDraft(decision, attempt, anchorDay, stamp));
          applied = await carry(decision.actions, applyOptionsFor(invocation, deps, context, true));
          const closing = monotonicStamp(deps.stampAt(deps.now()), { lastSeq: tail.lastSeq + 1, lastAtUtcMs: stamp.atUtcMs }, deps.stampAt);
          const drafted = resultDraft(decision, applied, attempt, anchorDay, closing);
          if (drafted !== null && !invocation.dryRun) {
            // Axiom A4: "an append that fails is itself an abort — disable both tasks,
            // page, exit" (ACT-44, ACT-60). This is the one place where that matters
            // most and where it was not done: the actions above have already landed on
            // the host, so at step 10 the certificate line is durably written, and an
            // append that throws here used to escape to the outermost catch — which
            // applies no teardown at all. The invocation that armed the deployment tore
            // nothing down, and the abort on the next tick, deciding from a ledger that
            // shows an intent and no result, owes only what `abortTeardown` gives it.
            //
            // The teardown runs here, inside the session, because that is where the
            // lease is still held and the action context is still in scope. The store
            // failure is then reported as it was, with what the teardown managed in the
            // outcome rather than a claim that it ran.
            try {
              await append(session, drafted);
            } catch (error) {
              const teardown = await carry(abortTeardown(fold), applyOptionsFor(invocation, deps, context, false));
              applied = [...applied, ...teardown];
              throw error;
            }
          }
          const outcome = drafted === null ? "ok" : (drafted.outcome ?? "unknown");
          return { kind: "acted", step: decision.step, outcome, deferred: drafted === null };
        }
      }
    },
  );

  if (result.kind === "contended") {
    return { outcome: { kind: "yielded", reason: "another invocation holds the activation lease; one note was written and nothing else was done" }, applied: [], fold, schedule };
  }
  return { outcome: result.value, applied, fold, schedule };
}

/**
 * `run`, with its own reports carried out of a failure.
 *
 * The A4 teardown at step 10 runs inside the lease and the store failure is rethrown after
 * it. Without this the throw reached the dispatcher's catch, which knows nothing about what
 * was applied and reports `applied: []` — so an invocation that had just disabled both tasks
 * and removed the certificate line told the owner only that it had failed.
 */
async function runCarryingTeardown(invocation: ActivationInvocation, deps: InvocationDeps, schedule: Schedule): Promise<InvocationResult> {
  const carried: ActionReport[] = [];
  try {
    return await run(invocation, deps, schedule, carried);
  } catch (error) {
    return { outcome: storeFailure(error, carried), applied: carried, fold: null, schedule };
  }
}

/**
 * `abort --confirm` (spec §5, ACT-27). The teardown runs first and is idempotent; the
 * terminal entry is written afterwards, under a bounded wait. If the entry cannot be
 * written the command says so and exits non-zero, because an owner who typed the abort
 * and got a shrug would go to bed believing the run was stopped.
 */
async function abort(invocation: ActivationInvocation, deps: InvocationDeps): Promise<InvocationResult> {
  const withLedger = deps.withLedger ?? withActivationLedger;
  const write = deps.writeStopMark ?? writeStopMark;
  const context = ownerContext(deps);
  const operator = invocation.operator ?? "";
  const opening = deps.stampAt(deps.now());

  // SC-2: the mark before the first action, because a stop that has not been written down
  // cannot be seen by the invocation it is racing. A failure here does not stop the
  // teardown — the owner typed a stop and the world still owes him one — but it is
  // carried into the verdict, and a stop without its mark is never reported as confirmed.
  const stopId = (deps.newStopId ?? defaultStopId)();
  let markFailure: string | null = null;
  if (!invocation.dryRun) {
    try {
      await write(invocation.stateRoot, { id: stopId, operator, at: opening.at, atUtcMs: opening.atUtcMs, reason: "OWNER_ABORT" });
    } catch (error) {
      markFailure = error instanceof Error ? error.message : "the stop mark could not be written";
      deps.print(`WARNING: the stop mark could not be written (${markFailure}); a concurrent invocation will not see this stop`);
    }
  }

  // Every part of the teardown is attempted, whatever the part before it did: the owner
  // typed a stop, and a failed disable is a reason to keep going, not to stop halfway.
  const immediate = await applyTeardown(STOP_TEARDOWN, applyOptionsFor(invocation, deps, context, false));

  let fold: LedgerFold | null = null;
  let confirming: readonly ActionReport[] = [];
  // Only used when the ledger has no entry at all to take an attempt from — a ledger on
  // which there is nothing to abort in the first place.
  const today = opening.at.slice(0, 10);
  // SC-7 for the stop itself: a store failure here leaves a disarmed world and no record
  // of it. Without this catch the throw reaches the dispatcher, which knows nothing about
  // the four actions that already ran and reports `applied: []`.
  /**
   * How often the stop comes back for the lease before it gives up on recording itself.
   *
   * The store answers `contended` immediately when a **live** owner holds the lease — it
   * does not wait — so without this a stop typed while a tick is applying an action wrote
   * no entry at all: the world was disarmed, the mark stood, the report was honest, and
   * the append-only record said nothing about the owner having stopped the run. Measured
   * with two operating-system processes. Three rounds a second apart covers an
   * invocation that is finishing one action; a holder that stays longer than that is
   * reported rather than waited out, because a stop that blocks is worse than one that
   * says it could not finish.
   */
  const CONFIRM_ROUNDS = 3;
  const CONFIRM_WAIT_MS = 1_000;
  const leaseOptions = (): Parameters<typeof withActivationLedger<InvocationOutcome>>[0] => ({
    root: invocation.stateRoot,
    owner: deps.owner,
    makeSystemDraft: systemDraftFactory({ nowUtcMs: deps.now(), stampAt: deps.stampAt, attempt: nextAttemptId([], today), anchorDay: today }),
    contentionTimeoutMs: 30_000,
  });

  const leaseWork = async (session: ActivationLedgerSession): Promise<InvocationOutcome> => {
      // SC-4: holding the lease is the instant at which no other invocation is inside an
      // `act`. Whatever a racing invocation applied between the immediate pass and this
      // moment is undone here, before anything is written down — so the record describes
      // the world the stop leaves behind rather than the world it found halfway through.
      confirming = await applyTeardown(STOP_CONFIRMATION, applyOptionsFor(invocation, deps, context, false));
      const all = [...immediate, ...confirming];
      const verdict = stopVerdict(all, markFailure);

      const snapshot = await session.read();
      fold = foldLedgerSnapshot(snapshot);
      const attempt = fold.currentAttempt;
      const tail = { lastSeq: snapshot.entries.at(-1)?.seq ?? 0, lastAtUtcMs: snapshot.entries.at(-1)?.atUtcMs ?? null };
      const stamp = monotonicStamp(deps.stampAt(deps.now()), tail, deps.stampAt);
      const clause = `${stopVerdictClause(verdict, markFailure)}; ${teardownClauseOrSilence(all)}`;

      if (attempt === null) {
        // The teardown has already run — it runs before the lease, deliberately — and this
        // branch used to append nothing at all, so a deliberate stop against a fresh or
        // rotated state root left no trace in the append-only record: both tasks disabled,
        // the certificate line gone, the disarm deleted, and a console line in a context
        // that may never show one. A note, not a terminal entry: there is no attempt to end.
        const day = stamp.at.slice(0, 10);
        if (!invocation.dryRun) await append(session, ownerAbortWithoutAttemptDraft(operator, nextAttemptId(snapshot.entries, day), day, stamp, immediate, confirming));
        return {
          kind: "aborted",
          step: null,
          reason: "OWNER_ABORT_NO_ATTEMPT",
          teardown: all,
          nextOwnerAction: `No attempt was open in this state root, so there was nothing to end — but the stop was applied to the world: ${clause}. Check that this is the state root you meant.`,
        };
      }

      if (fold.attemptEnded !== null) {
        // SC-5. This branch used to return `ended` with exit 0, no page and no entry at
        // all — after applying four real actions and pinging three checks — and the line
        // the owner read finished with "Nothing was done" (R3-08). The attempt is not
        // ended a second time; what this invocation did to the world is.
        if (!invocation.dryRun) await append(session, ownerAbortRepeatDraft(operator, attempt.id, attempt.anchorDay, stamp, immediate, confirming, fold.attemptEnded.seq));
        return {
          kind: "aborted",
          step: null,
          reason: `OWNER_ABORT_REPEAT: attempt ${attempt.id} was already ended at seq ${String(fold.attemptEnded.seq)}`,
          teardown: all,
          nextOwnerAction: `The attempt was already ended; this stop was applied again and changed nothing about that: ${clause}. Open a new attempt when the run is to continue.`,
        };
      }

      if (!invocation.dryRun) await append(session, ownerAbortDraft(operator, attempt.id, attempt.anchorDay, stamp, immediate, confirming));
      return {
        kind: "aborted",
        step: null,
        reason: "OWNER_ABORT",
        teardown: all,
        nextOwnerAction: `The attempt is ended: ${clause}. Open a new one when the run is to continue.`,
      };
    };

  let result: Awaited<ReturnType<typeof withActivationLedger<InvocationOutcome>>>;
  try {
    result = await withLedger<InvocationOutcome>(leaseOptions(), leaseWork);
    for (let round = 1; round < CONFIRM_ROUNDS && result.kind === "contended"; round += 1) {
      await new Promise(resolve => { setTimeout(resolve, CONFIRM_WAIT_MS); });
      result = await withLedger<InvocationOutcome>(leaseOptions(), leaseWork);
    }
  } catch (error) {
    const all = [...immediate, ...confirming];
    return { outcome: storeFailure(error, all), applied: all, fold, schedule: null };
  }

  const all = [...immediate, ...confirming];
  if (result.kind === "contended") {
    // SC-4: the stop disarmed, but nothing confirmed it and nothing recorded it. That is
    // not a confirmed stop and it does not get a confirmed stop's exit code.
    return {
      outcome: {
        kind: "work-failed",
        reason: "another invocation holds the lease, so this stop was neither confirmed under the lease nor recorded. Retry the abort.",
        teardown: all,
      },
      applied: all,
      fold,
      schedule: null,
    };
  }

  // SC-2a, added after R4-01: a stop is durable only if its own mark is still the one
  // standing when it finishes. Executed before this read-back existed: a continuation
  // running concurrently erased the mark and this command still reported "the stop is
  // confirmed". The mark is the only thing that stops a later tick from arming, so a
  // report that outlives it is the most expensive sentence this CLI can print.
  let markFailureAfter = markFailure;
  if (markFailureAfter === null && !invocation.dryRun) {
    const standing = await (deps.readStopMark ?? readStopMark)(invocation.stateRoot);
    if (standing.kind === "absent") markFailureAfter = "the stop mark was gone again by the time this stop finished; something lifted it";
    else if (standing.kind === "unreadable") markFailureAfter = `the stop mark could not be read back (${standing.reason})`;
    else if (standing.mark.id !== stopId) markFailureAfter = `a different stop stands now (${standing.mark.operator} at ${standing.mark.at}); this one was superseded while it ran`;
    if (markFailureAfter !== null) deps.print(`WARNING: ${markFailureAfter}`);
  }

  // SC-4 again, at the other end: the record landed, but something the stop attempted
  // failed, or its mark was never written or did not survive. The outcome says so
  // instead of reporting the abort that the branches above built.
  const verdict = stopVerdict(all, markFailureAfter);
  if (verdict === "unconfirmed") {
    return {
      outcome: {
        kind: "work-failed",
        reason: `the stop is NOT confirmed: ${stopVerdictClause(verdict, markFailureAfter)}. ${teardownClauseOrSilence(all)}`,
        teardown: all,
      },
      applied: all,
      fold,
      schedule: null,
    };
  }
  return { outcome: result.value, applied: all, fold, schedule: null };
}

/**
 * `disarm` — the 15:05 one-shot of spec §6. The rule is one sentence: disable both tasks
 * unless the ledger shows a green gate for this anchor day, and disable them when the
 * ledger cannot be read at all.
 */
async function disarm(invocation: ActivationInvocation, deps: InvocationDeps, anchorDay: string): Promise<InvocationResult> {
  const withLedger = deps.withLedger ?? withActivationLedger;
  const context = teardownContext(deps, anchorDay);
  let fold: LedgerFold | null = null;

  try {
    const result = await withLedger<InvocationOutcome>(
      {
        root: invocation.stateRoot,
        owner: deps.owner,
        makeSystemDraft: systemDraftFactory({ nowUtcMs: deps.now(), stampAt: deps.stampAt, attempt: nextAttemptId([], anchorDay), anchorDay: anchorDay }),
        // The one-shot fires at 15:05 and owes its answer in seconds, not in the store's
        // default five. Whatever it cannot resolve in that time it resolves by disabling,
        // which is the direction this command exists for.
        contentionTimeoutMs: 2_000,
      },
      async session => {
        const snapshot = await session.read();
        fold = foldLedgerSnapshot(snapshot);
        const attempt = fold.currentAttempt;
        // `stepDone` is this codebase's definition of a finished step, and the disarm
        // uses it rather than inventing a stricter second one: a gate recorded as
        // `already_in_target_state` met the same conjunction as one recorded `ok`.
        const green = attempt !== null
          && attempt.anchorDay === anchorDay
          && fold.attemptEnded === null
          && stepDone(fold, "10-gate");
        const tail = { lastSeq: snapshot.entries.at(-1)?.seq ?? 0, lastAtUtcMs: snapshot.entries.at(-1)?.atUtcMs ?? null };
        const stamp = monotonicStamp(deps.stampAt(deps.now()), tail, deps.stampAt);
        const id = attempt?.id ?? nextAttemptId(snapshot.entries, anchorDay);
        const day = attempt?.anchorDay ?? anchorDay;

        if (green) {
          if (!invocation.dryRun) {
            await append(session, { at: stamp.at, atUtcMs: stamp.atUtcMs, attempt: id, anchorDay: day, step: null, kind: "note", outcome: null, evidence: { disarm: "GATE_GREEN", tasksLeftEnabled: true }, nextOwnerAction: null });
          }
          return { kind: "recorded", step: "10-gate", outcome: "already_in_target_state" };
        }
        const reports = await applyTeardown(fullTeardown(), applyOptionsFor(invocation, deps, context, false));
        if (!invocation.dryRun) {
          await append(session, { at: stamp.at, atUtcMs: stamp.atUtcMs, attempt: id, anchorDay: day, step: null, kind: "note", outcome: null, evidence: { disarm: "NO_GREEN_GATE", actions: reports.map(report => ({ kind: report.kind, applied: report.applied, reason: report.reason })) }, nextOwnerAction: null });
        }
        return { kind: "aborted", step: null, reason: "DISARMED", teardown: reports, nextOwnerAction: `The disarm one-shot found no green gate: ${teardownClauseOrSilence(reports)}. Read the ledger before the next attempt.` };
      },
    );
    if (result.kind === "contended") {
      // A live invocation may be mid-gate. The one-shot still owes the world its
      // disable: the gate either wrote its result before 15:05 or it did not.
      const reports = await applyTeardown(fullTeardown(), applyOptionsFor(invocation, deps, context, false));
      return { outcome: { kind: "aborted", step: null, reason: "DISARMED_UNDER_CONTENTION", teardown: reports, nextOwnerAction: `The disarm ran while another invocation held the lease: ${teardownClauseOrSilence(reports)}. Read the ledger.` }, applied: reports, fold, schedule: null };
    }
    // What the disarm applied travels in `applied` like every other command's does; it
    // used to live only inside the outcome, so a caller reading `result.applied` was told
    // nothing had happened by the one command whose whole purpose is to act.
    return { outcome: result.value, applied: result.value.kind === "aborted" ? result.value.teardown : [], fold, schedule: null };
  } catch (error) {
    // Fail safe, not closed: a ledger that cannot be read is exactly the case the
    // disarm exists for (spec §6; residual G1, an unparseable `ledger.lock`).
    const reports = await applyTeardown(fullTeardown(), applyOptionsFor(invocation, deps, context, false));
    const failure = storeFailure(error);
    const detail = failure.kind === "ledger-defect" ? `${failure.stage}:${failure.reason}` : failure.kind;
    return {
      outcome: { kind: "aborted", step: null, reason: `DISARMED_LEDGER_UNREADABLE (${detail})`, teardown: reports, nextOwnerAction: `The disarm could not read the ledger: ${teardownClauseOrSilence(reports)}. Read the activation state root by hand before anything else.` },
      applied: reports,
      fold,
      schedule: null,
    };
  }
}

/**
 * `open --anchor-day <day> --operator <name>` — the owner's retry (spec §5, "Retry on the
 * next trading day"). An `abort` ends an attempt for good, and no tick may undo that on
 * its own; when the owner has read the ledger and wants the run continued, this is where
 * that decision is written down, with a name on it.
 *
 * It opens nothing while an attempt is still running: that would give one anchor day two
 * open attempts and make the fold ambiguous.
 */
async function open(invocation: ActivationInvocation, deps: InvocationDeps, schedule: Schedule): Promise<InvocationResult> {
  const withLedger = deps.withLedger ?? withActivationLedger;
  const anchorDay = schedule.anchorDay;
  let fold: LedgerFold | null = null;

  const result = await withLedger<InvocationOutcome>(
    {
      root: invocation.stateRoot,
      owner: deps.owner,
      makeSystemDraft: systemDraftFactory({ nowUtcMs: deps.now(), stampAt: deps.stampAt, attempt: nextAttemptId([], anchorDay), anchorDay }),
    },
    async session => {
      const snapshot = await session.read();
      fold = foldLedgerSnapshot(snapshot);
      if (snapshot.state === "corrupt") {
        return { kind: "ledger-defect", stage: "read-ledger", reason: "LEDGER_CORRUPT" };
      }
      // The refusal exists so that one anchor day never has two open attempts, and it
      // stands — except over the owner's own stop, which is the one fact that says this
      // attempt is over whatever the ledger's last entry looks like (SC-8).
      //
      // Two states reach this line with a mark standing and nothing ended. A stop against
      // a state root with no attempt writes a note, and the fold reads the last entry's
      // attempt id as the current one, so an ordinary note looks like an open attempt —
      // found by the cross-process probe of 2026-09-19, and without this clause the stop
      // would have left the owner no way back in at all. And a stop that could not take
      // the lease disarmed and marked without ending anything. In both, `open` is
      // precisely the command the contract points him at.
      const standing = await (deps.readStopMark ?? readStopMark)(invocation.stateRoot);
      if (fold.currentAttempt !== null && fold.attemptEnded === null && standing.kind !== "present") {
        return { kind: "refused", reason: `attempt ${fold.currentAttempt.id} is still open for anchor day ${fold.currentAttempt.anchorDay}; end it before opening another` };
      }
      const tail = { lastSeq: snapshot.entries.at(-1)?.seq ?? 0, lastAtUtcMs: snapshot.entries.at(-1)?.atUtcMs ?? null };
      const stamp = monotonicStamp(deps.stampAt(deps.now()), tail, deps.stampAt);
      const attempt = nextAttemptId(snapshot.entries, anchorDay);
      const previous = fold.currentAttempt?.id ?? null;
      // SC-8, rebuilt after R4-01 and R4-02. Two things changed, and neither alone is
      // enough:
      //
      //   * The opening is **recorded first** and the stop lifted afterwards. The old
      //     order lifted first, so an append that failed with the shape the store really
      //     throws left the mark gone and no continuation on the record — executed, and
      //     the deployment was armable again with nothing saying why.
      //   * The lift names the **id** it read. A stop typed while this continuation was
      //     working is a different stop, it is left standing, and it is reported. The
      //     owner's most recent word is the one that counts.
      //
      // What is left is an explicit, recoverable state rather than a silent one: the
      // attempt is open and a stop still stands, so nothing arms, `status` shows both,
      // and typing `open` again lifts the newer stop.
      let lift: StopClearResult = { kind: "absent" };
      if (!invocation.dryRun) {
        await append(session, openingDraft("OWNER_OPENED", attempt, anchorDay, stamp, {
          operator: invocation.operator ?? "",
          previousAttempt: previous,
          liftsStop: standing.kind === "present" ? standing.mark.id : null,
        }));
        lift = standing.kind === "present"
          ? await (deps.clearStopMark ?? clearStopMark)(invocation.stateRoot, standing.mark.id)
          : { kind: "absent" };
        if (lift.kind !== "cleared" && standing.kind === "present") {
          await writeStopLiftFailure(invocation.stateRoot, { attempt, anchorDay, operator: invocation.operator ?? "", intendedId: standing.mark.id, outcome: lift.kind, at: stamp.at });
          await append(session, {
            at: stamp.at,
            atUtcMs: stamp.atUtcMs,
            attempt,
            anchorDay,
            step: null,
            kind: "note",
            outcome: null,
            evidence: { stopLift: lift.kind, intendedId: standing.mark.id, standing: lift.kind === "superseded" ? { operator: lift.standing.operator, at: lift.standing.at } : null },
            nextOwnerAction: "The attempt was opened and the owner's stop was NOT lifted, so nothing will be armed. Read `activation status` and run `open` again.",
          });
        }
      }
      if (lift.kind === "cleared") deps.print("the owner's stop mark was lifted; arming actions are permitted again");
      else if (lift.kind !== "absent") deps.print(`the attempt is open, but the stop was NOT lifted (${lift.kind}); nothing will be armed until it is`);
      return { kind: "opened", attempt, found: "OWNER_OPENED" };
    },
  );

  if (result.kind === "contended") {
    return { outcome: { kind: "refused", reason: "another invocation holds the lease; nothing was opened. Try again in a moment." }, applied: [], fold, schedule };
  }
  return { outcome: result.value, applied: [], fold, schedule };
}

/** One invocation, end to end. Every failure that is not the CLI's own is classified, never thrown. */
export async function invoke(invocation: ActivationInvocation, deps: InvocationDeps): Promise<InvocationResult> {
  if (invocation.command === "status") {
    try {
      return await status(invocation, deps);
    } catch (error) {
      return { outcome: storeFailure(error), applied: [], fold: null, schedule: null };
    }
  }

  if (invocation.command === "abort") {
    try {
      return await abort(invocation, deps);
    } catch (error) {
      return { outcome: storeFailure(error), applied: [], fold: null, schedule: null };
    }
  }

  // `run`, `open` and `disarm` all carry an anchor day; the parser refuses them without one.
  const anchorDay = invocation.anchorDay;
  if (anchorDay === null) return refuse(`${invocation.command} needs an anchor day`);

  // The disarm is dispatched before the schedule is built, because it needs no measured
  // fact — only the day on its own command line and the two paths every command knows.
  // It used to share the schedule build with `run` and `open`, which meant the one
  // command whose whole purpose is to make the deployment safe could be stopped by a
  // missing or malformed host file. The 15:05 one-shot must not have a prerequisite it
  // does not consume.
  if (invocation.command === "disarm") {
    try {
      return await disarm(invocation, deps, anchorDay);
    } catch (error) {
      return { outcome: storeFailure(error), applied: [], fold: null, schedule: null };
    }
  }

  const facts = deps.facts;
  if (facts === null) return refuse("ops/activation/deployment.json could not be read, and this command needs the facts it carries");
  const built = buildSchedule(anchorDay, facts, deps.toLocal);
  if (!built.ok) return refuse(built.reason);
  const schedule = built.schedule;

  try {
    if (invocation.command === "run") return await runCarryingTeardown(invocation, deps, schedule);
    return await open(invocation, deps, schedule);
  } catch (error) {
    return { outcome: storeFailure(error), applied: [], fold: null, schedule };
  }
}
