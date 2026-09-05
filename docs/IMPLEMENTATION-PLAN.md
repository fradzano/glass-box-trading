# Implementation plan — proof-gated sessions

This plan schedules implementation. It does not redefine behavior.
[`SCENARIOS.md`](SCENARIOS.md) remains the external standard,
[`AXIOMS.md`](AXIOMS.md) owns the invariants, [`SPEC.md`](SPEC.md) owns runtime
cases, and [`SUBMISSION-SPEC.md`](SUBMISSION-SPEC.md) owns judge-facing
acceptance. [`STATE.md`](../STATE.md) names the one active phase and links here;
this file does not duplicate live status.

A phase is a coherent objective, not a fixed chat duration. It may survive
context compaction or several commits. Work may be reprioritized, but a later
phase cannot make an earlier safety gate pass. A waiver advances an acceptance
state only where the owning SPEC explicitly permits one; otherwise the phase
remains incomplete and arming remains blocked.

## Shared completion gate

Every implementation phase P1–P7 ends under the same rules:

1. The phase's exact SPEC case scope has red-first tests and is green through
   one documented repository command. Tests name stable SPEC IDs.
2. `src/core/**` is pure. A checked architecture rule rejects I/O/framework
   imports, environment access, ambient time/randomness, and mutable global
   state there. Time, IDs, configuration, and observations are inputs.
3. Money and option-price arithmetic is exact and integer-based. Binary
   floating-point values never enter a risk or P&L decision.
4. A row in `EVIDENCE-DEBT.md` is discharged only when its complete trigger
   path executes. Partial overlap with the named SPEC cases is not enough.
5. The phase's correctness surface runs through the repository verification
   rules, including mutation and independent counter-verification where they
   add evidence. A green suite alone is not completion.
6. No secret enters source, fixtures, logs, snapshots, journal evidence, or
   generated public artifacts.
7. `README.md`, `TEST_MAP.md`, `REPO_MAP.md`, `STATE.md`, and `DECISIONS.md`
   are updated where the phase changed their truth. The coherent result is
   committed on its dedicated phase branch; `main` remains release-only and no
   remote action is implied.

Failure is defined. The agent leaves the last coherent green commit, records
the exact open case IDs and reproduced blocker in `STATE.md`, and does not
weaken the SPEC or mark partial evidence as complete. A contradiction between
scenario, axiom, and SPEC is a valid stop condition that requires an explicit
resolution rather than an implementation guess.

Production O5 thresholds are not invented inside an implementation phase.
Until the owner freezes them, tests use conspicuously named fixture values and
startup remains unable to arm.

## Phase map

| Phase | System state produced | SPEC allocation | External-effect boundary | Target |
|---|---|---|---|---|
| P0 | Sourced contract, scenarios, axioms, runtime SPEC, submission SPEC, and this plan | Planning only | Documentation and local git only | Complete before scaffolding |
| P1 | Complete pure entry-decision core and local glass-box fixture | 37 cases: S-CORE-01..03 and G1–G8 | No process, file, network, or broker effect from core | First implementation session |
| P2 | Durable journal and single-writer authority | 12 cases: S-J-01..06 and S-G12-01..05/07 | Local temporary state only; no broker adapter | After P1 |
| P3 | Broker execution state machine and cycle safety under fakes | 12 cases: S-CYC-01/02/04/05/06, G13, S-X-01..04 | Fake broker only; zero credential use | After P2 |
| P4 | Fail-closed startup and analyst boundary | 2 cases: S-CYC-11 and S-G12-06 | Pinned MCP child and optional read-only dev smoke; no broker mutation | Tier 1 completion |
| P5 | Recovery, watchdog, expiry, and deadline lifecycle | 21 test cases plus declared limit S-G14-04: S-CYC-03/08/09/10, G9–G11, S-G14-01..03, S-X-05/06 | Fakes and local processes only | Before unattended or deadline pressure |
| P6 | Public evidence pipeline and qualification-state projection | 5 cases: S-CYC-07/12 and S-J-07..09; SUB-02/11 delivery acceptance | Local candidate artifacts and fake promotion endpoints; no GitHub/Vercel mutation | Before public launch |
| P7 | Broker-backed dev live-test certificate | S-ARM-01; this completed all 90 runtime test obligations the competition arc defined | Explicit owner go; dev paper account only; finish flat | Market-hours pre-arm gate |
| P8 | Kickoff release and competition bootstrap | SUB-01/02/08/09/12 plus event-form delta | Owner creates account and authorizes publish/arm | Aug 28 from 17:00 CEST |
| P9 | Competition operation and public golden path | Runtime acceptance in operation; S-CYC-12 checkpoints | Competition mutations only through the armed runtime | Aug 28–Sep 3 |
| P10 | Presentation cutoff, submission, and terminal evidence | All mandatory SUB rows | Upload, stable alias promotion, submission, terminal reconciliation | Sep 3–4 |
| P11 | Post-competition hardening: the A- and B-class backlog of the competition week | 2 cases: S-X-07 and S-X-08 | Disabled schedulers; dev account only; the competition journal is a read-only archive | After the `TERMINAL` entry |
| P12 | Three-month paper run as its own deployment | Runtime acceptance in operation; no new SPEC cases yet | A chosen paper account through freshly installed tasks; the competition journal is never reopened | Owner decision pending (see P12 below) |

The case allocation is machine-owned by
[`config/implementation-phases.json`](../config/implementation-phases.json)
and checked by `python tools/check_implementation_phases.py`; the table above is
its human projection. The check requires every runtime test case to appear
exactly once across the phases it names — 92 cases across P1–P7 and P11 as of
2026-09-05, when the post-competition fixes added S-X-07 and S-X-08.
`S-G14-04` remains the sole declared limit and is not counted as a test.
The SPEC tier partition remains authoritative for arming deadlines; phase order
may implement a later-tier pure gate early but can never move a required gate
past its tier deadline.

## P1 — pure entry-decision core

Build the TypeScript/Node foundation around the Functional Core / Imperative
Shell boundary. The core consumes typed snapshots, candidates, configuration,
and explicit time, then returns verdicts and action plans. G1–G8 execute for
every candidate without hidden short-circuiting. Exact money types, exposure
lifecycle identities, and route-independent order identities are domain types,
not adapter conventions.

Acceptance adds to the shared gate:

- Node and dependency versions are pinned; install, typecheck, lint, test,
  architecture check, and build are reproducible from a clean clone.
- The root repository contains the required MIT `LICENSE` and a minimal README
  that runs the same checks without tribal knowledge.
- All 37 allocated cases pass without network, filesystem, clock, or environment
  mocks inside the core.
- One recorded fixture contains at least one fully passing candidate and one
  vetoed candidate. The same core output renders a local static decision view
  with the complete gate vector and candidate rationale.
- The fixture runner has no order-capable adapter. “Pass” means a core action
  plan, never a broker submission.

## P2 — durable journal and mutation authority

Implement the append-only JSONL journal, its closed entry schemas, redaction,
account binding, halt state, epoch store, serialized append path, and the single
final mutation gateway. The journal is an adapter; validation and transition
decisions remain pure.

Acceptance adds to the shared gate:

- Crash/torn-append, concurrent append, stale writer, unreadable epoch,
  takeover race, witness append, and non-virgin epoch-reset paths execute in
  isolated temporary state.
- Holding or reacquiring an OS lock never authorizes a stale epoch.
- The broker port still has no real implementation. P2 cannot mutate Alpaca.

## P3 — broker execution under fakes

Implement the Alpaca port contract and pure execution transitions: exact limit
pricing, pre-submit revalidation, reservations, idempotent entry/close
lifecycles, synchronous/asynchronous rejection, confirmation-unclear recovery,
journal-failure emergency close, and same-cycle kill behavior. Drive every
effect through deterministic broker fakes that model fills and races.

Acceptance adds to the shared gate:

- Full/partial fills, cancel/fill races, lost acknowledgements, duplicate IDs,
  price improvement, impossible worse-than-limit records, and an already
  resting close are executable fixtures rather than assertions in prose.
- Every fake broker mutation passes the P2 authority gateway and has a durable
  intent or the one explicit emergency audit-gap path.
- No Alpaca credential is loaded and no network origin is contacted.

## P4 — startup and analyst boundary

Implement fail-closed configuration, role/account/origin selection, policy and
runtime digests, the pinned MCP build/launch verifier, minimal child
environment, exact read-only tool inventory, and credential-fence behavior.
Connect the analyst schema boundary to the P1 core without giving the analyst
an order-capable path.

Acceptance adds to the shared gate:

- Wrong/empty account IDs, live or lookalike origins, unknown fields, invalid
  timing inequalities, policy drift, runtime drift, package substitution,
  malicious bytecode, capability drift, and leaked executor environment all
  fail before mutation.
- The official MCP child may run only after source, dependency, interpreter,
  immutable content, and environment verification. No analyst request is
  released before exact post-start inventory acceptance.
- All Tier 1 cases in `SPEC.md` are now green. Arming remains blocked because
  P5–P7 have not yet passed.

## P5 — recovery and lifecycle

Implement the scheduler-facing degraded paths, restart/gap bootstrap,
reconciliation, watchdog takeover, close-escalation ladder, residue policy,
expiry eviction, Thursday flatten, and Friday terminal behavior. Use calendar
and broker fixtures; keep all effects behind ports.

Acceptance adds to the shared gate:

- Host/process gaps, total connectivity loss, unexplained positions/orders,
  assignment residue, stuck closes, watchdog takeover, expiry hold, Thursday
  failure, and Friday terminal remainder all execute through their named cases.
- The watchdog is a separate process entry point that shares the authoritative
  epoch store and cannot bypass the mutation gateway.
- S-G14-04 is displayed as the accepted single-host limit, never converted into
  a green test claim.

## P6 — public evidence pipeline

Build the pure journal projection, static dashboard, immutable candidate build,
anonymous probe contract, promotion/rollback scripts, and the deterministic
golden path. Add source skeletons for the one-pager, deck, video, cover, form
copy, and preflight so delivery does not become a final-day side project.

Acceptance adds to the shared gate:

- The dashboard renders only a chosen committed journal revision and explicit
  cutoff. P&L totals reconcile to fixture broker components; unmatched values
  remain visible as `UNATTRIBUTED`.
- Interrupted render, stale journal push, rejected candidate, successful
  promotion, rollback, and presentation-cutoff route stability are tested.
- A clean local browser can traverse the SUBMISSION-SPEC golden path. No page
  depends on a market being open or a new trade occurring.
- The S-CYC-12 checkpoint/window/failure projection is implemented before any
  competition arming.

## P7 — supervised dev live certificate

Run the exact P1–P6 artifact against the disposable dev paper account during
market hours. This phase is externally stateful and starts only after an
explicit owner go in that session.

Acceptance adds to the shared gate:

- S-ARM-01 proves fresh option liquidity inputs, positive credit-mleg broker
  acceptance, one real minimal fill and reconciliation, credential fencing,
  and a final fully paginated flat account with no non-terminal orders.
- The certificate binds the verified runtime and role-neutral policy digests.
  Any subsequent covered change invalidates it.
- All 90 runtime test obligations are green, every required Tier 2 path is
  executable, and the candidate remains unable to arm without O5 production
  values and competition identity/provenance.

## P8 — kickoff release

This is an owner-coordinated release session, not an autonomous coding flight.
At or after kickoff, inspect the actual submission form and announcements,
record deltas, tag the last pre-kickoff commit `pre-kickoff-baseline`, create the
new $100k competition paper account, bind its credentials locally, publish the
MIT repository and staged public dashboard, and run virgin-account provenance.

Acceptance:

- The account was created at or after kickoff and proves $100k, zero positions,
  zero orders, and empty fully paginated activity before its first mutation.
- Anonymous clean-browser checks pass for the submitted repository and demo
  candidate. No secret is present in git history or public build output.
- Arming occurs only if the P7 certificate still matches and every startup,
  account, provenance, O5, and publication gate is green. Delay is a valid
  result; waiving a safety gate is not.

## P9 — competition operation

Operate the armed system, harden only against observed failures, and keep the
public golden path current without rewriting history. The agent's account,
journal, dashboard, and alerts must tell one reconcilable story.

Acceptance:

- Every scheduled cycle is either journaled or becomes a bounded visible gap;
  orders/fills reconcile to lifecycle IDs and rationales.
- The public golden path works by Aug 29 17:00 CEST.
- At the Sep 1 US close, qualifying activity exists or
  `COMPETITIVENESS_AT_RISK` is visible. After the Sep 2 US close, absence of a
  qualifying fill becomes `WINNING_ACCEPTANCE_FAILED` and requires an owner
  waiver; normal gates are never widened to manufacture activity.
- Feature work stops after the Sep 2 freeze except for a reproduced safety or
  judging-criterion blocker.

## P10 — submission and terminal evidence

Complete every mandatory SUB row from one reconciled presentation dataset,
submit with contingency, and preserve truthful post-submit evidence.

Acceptance:

- Sep 3 narration/layout freezes before close; the reconciled post-close
  dataset and immutable route then drive every mutable number in the one-page
  PDF, video, deck, cover, and form copy.
- Canonical artifacts render by 23:30 CEST and the cutoff-identical preflight
  passes by 23:45. Submission finishes by Sep 4 12:00.
- Deadline and US-close journal revisions pass candidate probes before stable
  alias promotion. Uploaded artifacts retain their labelled Sep 3 cutoff.
- Every mandatory SUB row is accepted or carries a specific organiser-approved
  exception. Terminal evidence states any remaining exposure rather than
  claiming flatness.

## P11 — post-competition hardening

The competition ended with the `TERMINAL` entry of 2026-09-04 and both
scheduled tasks disabled. P11 lands the backlog the competition week produced
and could not land while the digest was frozen. It is complete.

Delivered 2026-09-05 (DECISIONS 2026-09-05, branch `p7/dev-live-certificate`):

- The entry-lifecycle resolver ignores close attempts, so a journaled close
  fill no longer blocks a certificate run (`f5c6ab4`, gated as R40).
- S-X-07: one shared market-window builder; a cycle quotes every contract its
  book holds by identity, so neither an expiry that has come nearer than
  `EXPIRY_MIN_SESSIONS` nor a strike the underlying has drifted away from can
  make a held structure unpriceable.
- S-X-08: a refused management close is journaled as its own
  `MANAGEMENT_REFUSAL` entry instead of living only in a printed report.
- The scheduled cycle task keeps that printed report in
  `STATE_DIR/cycle-run.log` (`tools/cycle-run.ps1`).
- The publish manifest states an expected journal revision per JSON route and
  the probe names its failed checks.

Acceptance: `npm run verify` exit 0 at 44 files / 576 tests; a gate round on
the change set; a fourth dev certificate run during market hours before
anything operates unattended again.

## P12 — three-month paper run (owner decision pending)

The owner's ruling of 2026-09-04 established that a long paper run is a new
deployment rather than a tail of the competition one, and called it "P9". That
label is already taken by competition operation above, so the plan numbers the
long run **P12** and records the collision rather than quietly reusing a
number; the label is the owner's to settle.

The run answers one question — *do the gates hold, and what does the outcome
distribution look like, over a quarter rather than a week* — and it cannot
answer a second one: paper fills at the limit and near-zero fees measure the
gross path only. That limitation belongs in the projection and in every claim
made from it.

### The window decision, which comes first

`config/policy.json` binds a deployment to `COMPETITION_START` and
`FLATTEN_DATE`, and every one of `COMPETITION_START`,
`QUALIFYING_ACTIVITY_CHECKPOINT`, `QUALIFICATION_WINDOW_END`,
`QUALIFICATION_MAX_LOSS_CENTS` and `FLATTEN_DATE` is mandatory and validated
fail-closed (`src/core/startup.ts`), ordered
`COMPETITION_START < QUALIFYING_ACTIVITY_CHECKPOINT < QUALIFICATION_WINDOW_END`.
Any change to them changes the policy digest, so the run needs a new
certificate either way.

**G11 does not need a rolling regime.** Read as specified, `FLATTEN_DATE` is
the *deployment's* own end — the day it stops opening and starts closing
(S-G11-01), followed by a journaling-only day (S-G11-02) and `TERMINAL`
(S-G11-04). Per-position expiry pressure is G9's job (S-G9-01, A17) and runs
independently every session. A three-month run therefore wants a single
`FLATTEN_DATE` at its planned end, not a date that rolls; a rolling date would
flatten the book every week for no reason the spec asks for.

What does need deciding is the **qualification window**, which is a
competition artifact with no meaning for a long run:

| Option | What it does | Cost |
|---|---|---|
| **A. Dev profile** (recommended) | `projectQualification` returns `NOT_APPLICABLE` for any non-competition profile, so the window simply never speaks; the fields stay in the config unused, satisfying validation | The competition-only gates go with it: the arming certificate gate (`src/shell/arming-gate.ts`) and the S-CYC-09 provenance proof do not run, which is a real reduction in pre-flight safety for an unattended quarter |
| **B. Competition profile, window inside the run** | Keeps the arming gate and the provenance proof; the window opens, the first fill sets `QUALIFIED`, and it stays there | Until that first fill the projection is `NOT_DUE`, then `COMPETITIVENESS_AT_RISK` — reason codes on the dashboard that mean nothing here |
| **C. Competition profile, window in the past** | Same gates as B | With no qualifying fill in the journal the projection is `WINNING_ACCEPTANCE_FAILED` from the first cycle: a standing false alarm for three months. Rejected |

Recommendation: **B**, with the window set to the run's first week, so the
arming gate and the provenance proof both apply and the qualification state
resolves to `QUALIFIED` early and stays there; then a separate, small change
that teaches the projection a "not a competition deployment" state so the
labels stop lying. A is the cheaper path and is the right answer only if the
run stays on the dev account with the owner watching it weekly.

### Prerequisites, all before the first armed cycle

1. P11 landed (done) — the closing-window defect alone would bite every week
   of a quarter.
0. **The credential fence must survive an unwritable journal (R42-B2, open).**
   Today a 401/403 that coincides with a journal write failure leaves
   `halted: false`, and the next cycle arms and opens a position with no human
   un-halt. It is pre-existing — the competition ran on it — and it is the one
   B-class finding of 2026-09-05 left open on purpose, because the shape that
   holds is a `fencePending` marker in the epoch store beside `resetPending`
   and `seedPending`, blocking every authoritative mutation until the HALT
   lands. That is a change to the authority core: scenario, axiom check, spec
   case, tests, gate round. An unattended quarter is exactly the deployment
   that must not re-arm itself after a credential rejection, so this comes
   before the first armed cycle, not after.
2. Certificate run four green on the dev account during market hours, with the
   dev scheduled tasks disabled for its duration (R40 C-2). Monday 2026-09-07
   is Labor Day, so the earliest is Tuesday 2026-09-08 from 15:30 CEST.
3. The account decided: the dev account, or a fresh paper account. The
   competition journal stays an archive with `TERMINAL` as its last entry and
   is never reopened.
4. Tasks reinstalled against the chosen profile (`tools/install-scheduled-task.ps1`),
   the watchdog armed, and both read back `Ready`.
5. Publish as a weekly routine through the digest-neutral path
   (`tools/*.ps1`, `docs/PUBLISH-RUNBOOK.md`).
6. A cost model in the projection: per-contract regulatory and exchange fees,
   and a slippage haircut against paper fills at the limit. Without it the run
   measures the gross path again — the failure that ended TradeScan-AI and
   Vigil was the cost side, not the logic.

### Open questions this plan does not answer

- **Journal and render scale.** The projection folds the whole journal on
  every render. The competition journal is 105 entries; a quarter at
  fifteen-minute cycles is on the order of 1,700 `CYCLE` entries at roughly
  50 KB each. Nothing has ever exercised that, and the dashboard render is on
  the publish path. Measure before the run, not after.
- **Retention.** Whether a quarter of quote samples belongs in the journal at
  all, or whether the sample should be bounded to the contracts a cycle
  actually reasoned about.
- **Two composition-root bindings and one CLI binding are unmeasured**
  (declared 2026-09-05): `buildRuntime`'s two `cycleMarketPort` call sites and
  `deadline-cli.ts`'s `recordCredentialFence` call pass the whole suite when
  mutated. The functions are tested; the wiring is not, because `buildRuntime`
  spawns the pinned analyst child and acquires an epoch. Whether that is worth
  a harness is a P12 question, not a P11 one.

## Handoff protocol

At session close, `STATE.md` records the active phase ID, accepted criteria,
exact next criterion, open case IDs, blockers, the last accepted phase-artifact
commit, branch, and any external process still running. An Ahoy note points
first to `STATE.md`, then to the active section in this file, followed by the
relevant SPEC and submission sources. The note never becomes a parallel plan.
