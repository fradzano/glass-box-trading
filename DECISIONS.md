# DECISIONS

Owner = Felix. Format: date — decision — rationale (one line each; this repo is
small, no ADR split).

- **2026-08-24 — Enter the hackathon; framing: compete on every published
  criterion and treat P&L as declared variance.** One week of P&L is noise, but
  it is explicitly scored; pursue a positive absolute result inside declared
  max-loss budgets without presenting it as proven alpha. (CONCEPT §1)
- **2026-08-24 — Strategy: two-sleeve barbell (Option C), defined-risk only.**
  Serves both P&L outcomes, gives the agent real decisions to journal; chosen
  over pure-income and pure-convex. (CONCEPT §2)
- **2026-08-24 — Architecture: "AI proposes, gates dispose"** — LLM analyst
  read-only via MCP, deterministic pure core owns every order. (CONCEPT §3)
- **2026-08-24 — Constraints: agent must run autonomously; budget 3 build
  evenings + 1 close-out; own throwaway repo; own Alpaca accounts (the
  pre-existing account is out of bounds).**
- **2026-08-24 — CLAUDE.md committed openly**, not hidden via exclude — the
  build rules are part of the exhibit.
- **2026-08-24 — Social track (O4): NO for now.** Revisit only if development
  shows presentable results.
- **2026-08-24 — Pre-kickoff build pulled forward.** The rule book bans
  plagiarism, not preparation; timeline stays transparent in the history.
  Replaces the earlier self-imposed "scaffold only before kickoff" policy (O3).
- **2026-08-24 — Build ladder before code: Szenario → Axiom → Spec → Code, with
  a CAPPED adversarial pass on the spec (2–3 rounds, not the full bis-0 end
  condition).** Deliberate, named deviation: paper money, schedule is the
  scarce resource; a non-zero end state is declared to the owner, not hidden.
- **2026-08-24 — Calendar corrected: Sep 4 2026 is a Friday.** The original
  five-session statement was superseded on 2026-08-25 when the rendered event
  page established a Fri Aug 28 17:00 kickoff; see the dated decision below.
  Flatten remains Thu Sep 3 close. (SCENARIOS.md #38)
- **2026-08-24 — Analyst auth: Claude subscription via `claude setup-token`
  (1-year OAuth), API key only as deliberately-injected fallback** — never both
  in the same environment (precedence). (CONCEPT §9 O2)
- **2026-08-24 — Journal lives on a dedicated `journal` branch; humans never
  commit there.** The initial direct-Vercel-production choice is superseded by
  the staged candidate/promotion decision dated 2026-08-25 below. (CONCEPT §5)
- **2026-08-25 — Axiom distillation reviewed (owner-directed blind/gate pass,
  explicitly NOT a terminated bis-0 run).** Findings fixed before the spec:
  A finding — no axiom bound the executor to the permitted account (→ new
  A24); B findings — A23 ignored fillable/confirmation-unclear entry orders,
  A11's "never leg-wise" forbade risk-reducing recovery after assignment or
  orphan fills, missing pre-submit revalidation under concurrent human action
  (→ A13), missing working-order ownership across trading halts (→ A16),
  missing concrete "why" per fill (→ A5). Distillation declared load-bearing
  after these fixes. (docs/AXIOMS.md)
- **2026-08-25 — Owner call A (A23): unattended worst case accepted as max
  $12k income + $8k convex against the initial $100k paper capital.**
  Counting rule: exactly once per exposure-lifecycle identity — filled
  position plus fillable or confirmation-unclear entry remainder or INTENT;
  partial fills split into filled portion and remaining reservation; exit
  orders not counted additionally. $20k is the declared constructive paper
  worst case, not a guarantee against broker/assignment/liquidation
  mechanics.
- **2026-08-25 — Owner call B (A22): Friday is journaling-only.** Thursday
  close = zero risk-bearing positions and zero non-terminal orders. The sole
  permitted remainder is S-X-06's visibly not-flat, non-exercising declared
  expiry hold. 17:00 CEST: dedicated
  `DEADLINE_RECONCILIATION` cycle with full broker snapshot and a reference
  to the submitted revision. US close: final snapshot, durable terminal
  state, controlled end of scheduler and dead-man expectation. Immutable
  submitted uploads stay unchanged; the public journal/dashboard may append
  the labelled deadline and terminal snapshots, then stay available through
  judging.
- **2026-08-25 — Owner call C (A18): silence SLA is 45–60 minutes ABSOLUTE**
  (not "two missed cycles"). healthchecks.io check: pre-activated, finite,
  cron/OnCalendar on `America/New_York` and the actual session slots; ping
  success ping only after a durable local journal append; active failure pings
  may precede it and never refresh liveness; mail plus one concretely named
  push channel, both tested in practice; ping URL stays secret. SaaS
  blindness is declared as an A23 residual — two delivery paths of one
  service are not two detectors.
- **2026-08-25 — Owner call D (A19): panic path is NOT key regeneration
  alone** — it is a credential fence, not an atomic stop (accepted/working
  orders survive; cancellation is a separate operation). Halt flag = calm
  stop. Key rotation qualifies as broker-side panic fence only after a
  dev-account drill proving a single order-capable credential, and is always
  followed by a working-order check/cancellation in the broker dashboard.
  Re-arm exclusively under halt after full reconciliation.
- **2026-08-25 — spec-pass accepted as capped Vorlage (2 rounds), NOT a
  bis-0 termination; no third finder round.** Remaining bookkeeping
  discrepancies of the final audit (N1/N2) stay on record and preclude a
  clean termination claim. After the mechanism rulings below: one narrow
  cold counter-verification of the changed seams, then TypeScript.
- **2026-08-25 — D16 ruled "executable: yes"** (VERIFY doubt-default):
  config equations and closed journal sets are an executable surface.
  Argumentative-only closures of spec-pass become a named EVIDENCE DEBT —
  their trigger paths must be executed in the red-first tests.
- **2026-08-25 — GV-2 ruled: writer authority by fencing, never by time.**
  Authority = monotone control epoch checked at the final single mutation
  gateway for every authoritative request. The OS lock serializes local work
  but never grants authority. Fence the old writer irrevocably before any
  takeover or watchdog mutation, then reconcile, then act. `SUPPRESSED` is
  staleness-neutral, no success ping, serialized journal access only. O5:
  `CYCLE_INTERVAL` = 15 min, `DEAD_MAN_BOUND` on the 60-min SLA side;
  30-min cycles excluded. Corrected inequality (with the doubled
  mid-cycle-death term) kept as scheduling constraint only. (SPEC
  S-G12-01/02/07, S-G14-02)
- **2026-08-25 — GV-3/6/8 ruled, to close before domain interfaces:**
  typed revalidation claimset per approved action (re-check account,
  positions, non-terminal orders, control epoch, kill-equity predicate at
  submit); discriminated recovery policy — intact structures keep the
  width cap, unbounded orphan shorts/short stock close under halt +
  fail-ping as requoted marketable limits, journaled as an assignment
  exception to A23, and this policy is an arming precondition for
  short-capable structures; quote history reconstructed from fully
  journaled observations — missing history blocks entries, not
  risk-reducing management, until current + immediately-prior complete
  samples exist (before that only reversible scaffold). (SPEC S-CYC-05,
  S-X-05/06, §1, S-G6-05, S-J-03)
- **2026-08-25 — Freeze the event-specific external contract in
  `docs/HACKATHON-FACTS.md`.** The rendered event page controls challenge,
  eligibility, account rules, criteria, window, and prizes; the actual form
  controls accepted submission fields/files/URLs. A material conflict blocks
  submission pending organiser clarification. Event-specific authorities
  outrank generic lablab guidance; later corrections are appended with date
  and source instead of being re-researched from memory.
- **2026-08-25 — Correct the operating window and make arming single-valued.**
  The event touches six US market dates: partial Fridays on Aug 28 and Sep 4,
  plus four full Mon–Thu sessions. Actual risk-bearing days depend on the
  safety gate. Canonical rule:
  `first_arm = max(kickoff, successful_dev_live_test_at)`; move the remaining
  market-hours dev checks to Aug 26–27, never waive them for Friday P&L.
  Thursday close remains the last risk moment; Friday Sep 4 remains
  reconciliation/journaling-only by owner call B.
- **2026-08-25 — Submission is a specified product boundary, not a Thursday
  checklist.** `docs/SUBMISSION-SPEC.md` owns the criterion evidence map,
  public-demo golden path, one-pager, video, PDF deck, cover, form copy,
  account evidence, preflight, and internal deadlines. The judge-facing
  vertical slice and delivery skeleton precede broad runtime coverage.
- **2026-08-25 — P&L evidence is part of the runtime surface.** The public
  dashboard must reconcile starting/current equity, absolute/percentage P&L,
  realized/unrealized values, drawdown, sleeve attribution, orders, fills,
  and journal intents against the submitted account ID and revision. Missing
  attribution is shown as a discrepancy, never silently assigned.
- **2026-08-25 — Separate the presentation and deadline evidence cutoffs.**
  Immutable uploaded assets use a labelled, reconciled Sep 3 post-flatten
  revision. The public journal/dashboard may append the Sep 4 17:00 deadline
  and US-close terminal snapshots. All cuts share account identity,
  provenance, and reconciliation logic; numbers are equal only when their
  labelled cutoff is equal.
- **2026-08-25 — Post-submission dashboard revisions are release-gated.**
  Each journal revision first becomes an immutable candidate deployment. An
  anonymous external probe must observe the expected revision, evidence cutoff,
  and freshness before an atomic alias operation may move the submitted URL.
  Failure preserves or restores the prior accepted deployment and alarms.
  Deployment receipts live outside the trading journal to avoid a recursive
  publish loop; a local render never counts as judge-visible evidence.
- **2026-08-25 — Competition arming requires three independent evidence
  gates.** A fail-closed BOOTSTRAP proves new-account creation, exact $100k
  opening values and fully empty paginated history; a positive MCP capability
  manifest proves the analyst has dev-data tools only; and S-ARM-01 derives the
  live-test timestamp from a runtime/policy-bound broker certificate. None may
  be asserted manually. Later competition manual activity irreversibly fails
  SUB-08 while risk-reducing cleanup remains allowed.
- **2026-08-25 — Track the analyst MCP capability manifest before scaffold.**
  `config/analyst-mcp-readonly.json` pins `alpaca-mcp-server` 2.3.0,
  `assets,stock-data,options-data`, the dev profile, and the exact 32 tools
  observed locally. The package adds docs and stock/crypto override tools, so
  a broad verbal “data only” claim is insufficient; exact inventory drift
  blocks arming.
- **2026-08-25 — Journal failure has one narrow safety exception.** If only
  the append fails while writer authority is valid, an existing exposure may
  receive a deterministic, mechanically risk-reducing emergency close. The
  next reconciliation exposes that there was no durable prior INTENT; this
  audit gap is never rewritten as a normal decision. If authority state also
  fails, no broker mutation occurs.
- **2026-08-25 — Expiry and watchdog recovery dispatch by actual exposure.**
  Intact structures close whole; residues route through S-X-06. A worthless
  long may be held to expiry only with fresh proof of long-only, OTM,
  non-exercising, zero-additional-liability state and remains visibly not-flat.
  The watchdog uses the same classification after fencing, including uncapped
  marketable-limit recovery for orphan shorts/short stock.
- **2026-08-25 — Bootstrap diagnostics are independent but never authoritative.**
  An invalid `STATE_DIR` writes a redacted Windows Application event and sends
  a failure-only healthchecks ping before broker access. That sink cannot hold
  journal, halt, or epoch state; after repair its diagnostic is imported into
  the real journal.
- **2026-08-25 — Reserve entry risk from the executable net limit.** One
  `reservedMaxLoss`, derived from the least favourable fill allowed by the
  exact final tick-rounded net mleg limit, feeds G1–G4, INTENT, reservation,
  partial-fill conversion, revalidation, and submit. Midpoint or target premium
  never buys risk capacity; price improvement releases capacity only after
  broker reconciliation.
- **2026-08-25 — Winning activity gets a checkpoint, never a safety bypass.**
  A qualifying activity is an ordinary core-approved competition-account
  options fill. At Sep 1 US close, absence becomes a public competitiveness
  alarm; through Sep 2 US close only, the analyst may prioritize one-lot liquid
  candidates under a stricter cap while every normal gate remains authoritative.
  Continued absence fails internal winning acceptance and requires an owner
  submission waiver. The published rules state no minimum trade count, so this
  is not represented as external ineligibility.
- **2026-08-25 — Paper-only and analyst version pins are executable guards.**
  Each mutation binds explicit role, exact canonical Alpaca paper-trading
  origin, and independent expected account ID; a matching ID from a live,
  redirected, or lookalike origin still fails. Separately, MCP startup compares
  the manifest package/version against the exact launch interpreter before
  checking offered tools. Both resolved launch identity and manifest hash bind
  the pre-arm certificate.
- **2026-08-25 — A drawdown kill owns resting entries before declaring flat.**
  Under the fence it sets sticky halt, cancels all risk-increasing non-terminal
  entries, reconciles cancel/fill races, reloads broker truth, then flattens the
  resulting book. Existing protective closes are adopted, not blindly removed;
  uncertain cancels remain exposure. Flat requires no risk-bearing position and
  no risk-increasing non-terminal order.
- **2026-08-25 — Form-ready means one canonical one-page rendition.** The
  Markdown one-pager is source, not delivery proof. Its canonical rendered
  target is a reproducible one-page PDF unless the kickoff form rejects that
  type; then the target changes once to the accepted type and preflight records
  the form validation. Parallel output variants are not maintained.
- **2026-08-25 — Post-close numbers cannot have a pre-close final deadline.**
  Narrative and layout freeze at Sep 3 20:00 CEST. After US close, one
  reconciled presentation-cutoff dataset and immutable dashboard route feed
  every mutable value in one-pager, video, deck, and copy; canonical renders
  finish by 23:30 and cutoff-identical preflight by 23:45.
- **2026-08-25 — Dev evidence binds role-neutral behavior, not raw secrets.**
  S-ARM-01 uses canonical `runtimeDigest` and `policyDigest`. Only the closed
  profile/account/credential identity set is excluded from policy and checked
  separately at competition bootstrap; the paper origin remains policy and any
  unknown config field blocks arming.
- **2026-08-25 — Every exposure has one close lifecycle across all routes.**
  Ordinary, emergency, expiry, kill, and watchdog management adopt the same
  lifecycle. At most one child may be non-terminal or unclear; fillable close
  quantity is subtracted before residual submit, and replacement waits for a
  broker-terminal cancel. Attempt generations remain broker-ID compatible.
- **2026-08-25 — MCP integrity is anchored outside the installation.**
  `config/analyst-runtime-lock.json` pins the official Alpaca repository at
  commit `872abbf28dab6cdde7d341fc13ac139b8002d1d9`, its `uv.lock`, CPython
  3.14.1 launcher/runtime hashes, and immutable-file policy. The dedicated MCP
  environment is rebuilt and verified from that source; installed bytes never
  define their own expected hash. Metadata and exact tool inventory remain
  separate checks. Generated Python bytecode is never a verification exclusion:
  the launcher removes it, proves it absent, and disables bytecode writes in the
  child before checking immutable source/package bytes and spawning.
- **2026-08-25 — Pre-kickoff code is allowed, visible, and not mislabelled.**
  The published Alpaca event contract contains no all-code-during-event rule and
  explicitly encourages a head start. We may therefore build the TypeScript
  foundation, dev-account vertical slice, tests, deployment shell, and delivery
  sources before kickoff. Preserve that history and create a
  `pre-kickoff-baseline` tag rather than squashing or redating it. Competition
  account creation and competition activity remain kickoff-gated. Substantial
  AI/Alpaca integration, competition hardening, and golden-path evidence must
  still land as honest event-window commits; any stricter kickoff instruction
  supersedes this decision before further implementation.
- **2026-08-25 — Implementation advances through proof-gated phases.**
  `docs/IMPLEMENTATION-PLAN.md` is the canonical phase launcher. It schedules
  the 90 runtime cases once across P1–P7 and then separates kickoff, competition
  operation, and submission into P8–P10. The plan never redefines behavior:
  scenarios, axioms, runtime SPEC, and submission SPEC remain authoritative.
  `STATE.md` names exactly one active phase; session notes point there instead
  of carrying a second checklist. A green suite is necessary but cannot advance
  a phase without its architecture, evidence, verification, documentation, and
  clean-commit gates. `config/implementation-phases.json` owns the case-to-phase
  allocation, and `tools/check_implementation_phases.py` rejects omissions,
  overlaps, stale patterns, or count drift against `docs/SPEC.md`.
- **2026-08-25 — Establish local `main` as the P0 release baseline at
  `598f43e`; begin P1 on `p1/pure-entry-core`.** `main` remains release-only,
  `concept` remains as the historical planning ref, and no remote or push is
  created by this branch cut.
- **2026-08-26 — P1 represents money, option prices, strikes, ratios, quantities,
  basis points, and timestamps as branded safe integers.** Risk comparisons use
  integer cross-multiplication, so binary floating point never enters max-loss,
  budget, concentration, liquidity, or whitelist decisions. Unfrozen O5 values
  exist only in conspicuously named `TEST_ONLY_*` fixtures; the core has no
  defaults for them.
- **2026-08-26 — P1 makes the Functional Core / Imperative Shell boundary a
  checked filesystem boundary.** `src/core/**` may import only within itself;
  the architecture gate rejects platform/package imports, ambient time,
  randomness, environment/global access, module-scope mutable state, and
  relative escapes. Fixture I/O and HTML rendering live under `src/shell/**`.
  The local pass stops at `ENTRY_ACTION_PLAN`; no order-capable port or adapter
  exists in P1.
- **2026-08-31 — The typed core boundary is trusted; validation happens before
  `decide`.** Blind ruling during the P1 adversarial run (store
  `responses/R4-ruling-typed-boundary.md`): `AGENTS.md`, `CONCEPT.md`, A12,
  SPEC §1, and the phase plan place schema and shape validation in front of
  the pure core. Type-invalid runtime values (a `null` contract record, a
  missing prior-quote map) therefore throw inside the core instead of
  producing a veto — and a forged unit brand (`0 as LotCount`, `-1 as
  OptionPriceCents`, a compiler-accepted assertion that bypassed the validating
  constructor) passes without a veto (R5-F1, gate-ruled an instance of this
  residual: obligation row `RES-P1-01d`); this is declared residual `RES-P1-01` and every adapter
  carries the obligation rows `RES-P1-01a..c` in `docs/EVIDENCE-DEBT.md`.
  Type-valid but semantically invalid inputs are made unrepresentable
  instead: `LotCount` (constructed only by `lotCount(≥1)`) types candidate
  quantities and leg ratios, a filled entry exists only as a `filled`
  position component, and exposure counting fails closed unless a
  reservation is explicitly `rejected`/`canceled`/`expired`. Decider if the
  residual becomes live: Felix Radzanowski.
- **2026-08-31 — Reserved maximum loss comes from one exact expiry-payoff
  evaluation.** Per-structure formulas (S-G1-02/03) were the third seam on
  the same mechanism (an overlapping "iron condor" was reserved at one wing).
  `expiryPayoffBound` evaluates the piecewise-linear payoff at price zero,
  every strike, and beyond the highest strike with BigInt arithmetic; a
  negative far slope is unbounded loss. Declared-structure checks still
  constrain which patterns may pass (and now require the short put below the
  short call), but the number is never a formula. Tests compare every
  reservation to an independent payoff scan.
- **2026-08-31 — Action plans are deep-frozen copies.** The core returns
  `ENTRY_ACTION_PLAN` values whose limit and legs are copied and frozen, so
  no holder of the analyst batch can alter an approved plan after the fact.
- **2026-08-31 — The architecture gate is a provenance allow-list, not a
  syntax deny-list.** Blind ruling (`responses/R4-ruling-architecture-seam.md`)
  on the third seam of the checker: shared completion gate 2 requires a rule
  that *rejects* impurity, so a deny-list with a documented hole would
  document non-fulfilment. `tools/check-core-architecture.mjs` now builds a
  TypeScript program over `src/core/**` with `types: []` and `lib: es2024`
  and requires every value-position identifier to resolve to core code or to a
  reviewed ECMAScript allow-list; Node globals, `Date`, `Function`, `eval`,
  `globalThis`, `Reflect`, `Proxy`, `Promise`, `Intl`, reflective members
  (`constructor`/`prototype`/`__proto__`), descriptor/prototype APIs,
  computed access on untyped or callable operands, casts that hide callables,
  explicit `any`, ambient declarations (except unique-symbol brands), async
  code, dynamic import, and non-`.ts` core files fail closed. The self-test
  runs its mutant table plus a pure control on every `npm run architecture`
  (the table grows with every counter-verified laundering class; the count in
  the gate's own output is authoritative).
  Declared limit: the gate proves what the declared core references, not that
  the boundary sits at the right place — that stays with the Core/shell
  lens. `.tmp/**` is ignored by ESLint so concurrent probe files cannot fail
  `npm run verify`.
- **2026-08-31 — Core purity is additionally enforced at runtime, because a
  static gate cannot be sound against deliberate laundering.** Two blind
  counter-verifications of the allow-list gate each produced a new laundering
  path (structural types, type guards, destructuring, generics, alias
  mutation, `Object.freeze(Math)`, `new Error().stack`). A second blind ruling
  (`responses/R4-ruling-architecture-enforcement.md`) held that shared
  completion gate 2 and SPEC §1 carry no "ordinary code only" qualifier, so
  enforcement must hold against source-level laundering. `npm run sandbox`
  (`tools/run-core-sandboxed.mjs`, part of `verify`) executes the compiled
  core inside a `node:vm` realm whose intrinsics are frozen and in which
  `Date`, `Intl`, `Math.random`, `eval`, every function constructor, and the
  locale methods are absent or throw; it first proves the instrument on six
  laundered mutants, then runs the recorded fixture twice (determinism), the
  malformed-parser and stale-snapshot paths, a full-fill reconciliation, and a
  fresh close plan. Declared limits, stated exactly: the runtime guard
  observes only the paths it executes and only the capabilities its taming
  removes (clock, randomness, locale, code generation, stack observation,
  the symbol registry, mutation of intrinsics, and mutation of the core's
  exported values, which are restricted to ordinary functions, arrays, and
  plain records and then hardened after load along their data properties and
  custom prototype chains — accessor properties, proxies, and objects with
  mutable internal slots such as `Map`, `Set`, typed arrays, iterators, and
  generator objects are rejected at load); it does not observe
  unexecuted paths, mutation of non-exported module-scope objects inside the
  core, or any capability not in that list. The static gate rejects every
  impurity and laundering class in its self-test — including any use of a
  standard-library object as a value — but a static analysis of TypeScript
  is **not sound** against an author who intends to escape it: four blind
  counter-verifications each found a new typed laundering path, and the P1
  run records this seam as open (`R4-F5`, PATCHED) rather than resolved.
  What the two gates hold together is: accidental impurity is rejected
  before execution, and the enumerated ambient capabilities cannot be reached
  on executed paths whatever the source spelled. Intent and boundary
  placement remain with the Core/shell lens and human review.
- **2026-08-31 — Owner ruling: residual `RES-P1-01` accepted.** Felix
  Radzanowski accepted the blind ruling above (the typed core boundary is
  trusted; shape validation belongs to the shell). Consequence: the core keeps
  throwing on type-invalid runtime values, every adapter carries the obligation
  rows `RES-P1-01a..c` in `docs/EVIDENCE-DEBT.md`, and a P2/P3 adapter that
  reaches `decide` without shape validation fails its phase gate. A veto would
  have reopened P1 with a core-side validation gateway; that path is closed.
- **2026-08-31 — Owner ruling: the two-gate enforcement with its stated limits
  is the accepted fulfilment of shared completion gate 2 (`R4-F5` declared).**
  After four blind counter-verifications each produced a fresh typed
  laundering path, Felix Radzanowski chose declaration over a fifth patch or a
  hardened-realm dependency (SES/`lockdown`). What is accepted: the static
  provenance allow-list rejects accidental and negligent impurity before
  execution; the runtime sandbox denies the enumerated ambient capabilities on
  every executed path whatever the source spelled; a deliberate core author can
  still write source that passes the static gate, and an ambient reach on a
  path the sandbox does not execute is not observed. The P1 run records this
  as residual `RES-P1-02` with the owner as decider. SES/`lockdown` as a pinned
  dependency stays a backlog candidate for P2, not a P1 obligation.
- **2026-08-31 — R5: the owner's declaration of `RES-P1-02` was refused once
  and then made true, not widened.** The blind residual gate (store
  `responses/R5-residual-architecture-enforcement-3.md`) refused to countersign
  because two bounded, dependency-free omissions survived *inside* the claimed
  coverage: the static rule treated a shorthand property (`{ Math }`) as a
  property name only, and export hardening followed data properties only, so
  accessor properties and custom prototype chains reachable from an export
  stayed mutable on executed paths. Both were closed as the gate prescribed
  (shorthand values go through the provenance check; hardening denies
  accessors, traverses prototypes, and skips realm intrinsics), each with
  calibration mutants in the respective gate. A fourth call then refused once
  more: `Object.freeze` does not reach mutable internal slots, so exported
  `Map`/`Set`/typed-array/iterator/generator values stayed mutable inside the
  claimed coverage. Closed as a class, not per type: export hardening now
  admits only ordinary functions, arrays, and plain records and rejects every
  other shape at load (the real core exports nothing else), and a failing
  freeze is an error. The abstract limit — unexecuted paths, non-exported
  module state including closure state, an author who intends to escape
  static analysis — was confirmed as truthfully declared and remains the
  residual.
  These are the sixth and seventh seams on `Dynamic-import architecture
  coverage`; the ledger records why the seventh is the last: any further finding inside the declared limit is
  not attacked again, and any further finding inside the *claimed* coverage is
  a new owner decision, not a patch.
- **2026-08-31 — Owner ruling: P1 is accepted and merged with its adversarial
  run paused, not terminated.** Felix Radzanowski decided under the competition
  calendar (P2–P6 due before Tuesday's US open, P7 live certificate in that
  session) to accept P1 after R5 and merge `p1/pure-entry-core` into local
  `main`. What is accepted: 37 allocated SPEC cases green (45 tests), the
  static and runtime purity gates with their limits stated exactly, residual
  `RES-P1-01` (both countersignatures), and `R4-F5`/`RES-P1-02` with the
  owner's countersignature only — the blind residual gate refused five times,
  each time on a bounded omission inside the claimed coverage; the last one
  (shape classification spoofable through `Symbol.toStringTag`) was closed by
  the gate's prescribed prototype-identity check with two spoof calibration
  mutants, but that state is **not counter-verified by a gate**. The loop
  stands at R5 of 8 with criteria 1 and 5 met and 2, 3, 4, 6 open; a later
  session may resume it from the store, it must not be reported as a bis-0
  termination. P2 begins on its own branch from this merge.

- **2026-08-31 — P2 design decisions (journal and mutation authority).**
  (a) *`seq` is assigned by the gateway under the writer mutex*, never by
  the caller: a draft carrying `seq` is rejected (`SEQ_ASSIGNED_BY_GATEWAY`),
  which is what makes concurrent appenders from several processes contiguous
  without a coordination protocol of their own. (b) *A torn last line is
  quarantined, then cut*: the unterminated bytes are copied verbatim into
  `STATE_DIR/quarantine/` and the journal is truncated to its last complete
  line before the next append. The fragment was never an entry, so this is
  not a rewrite of history (A6: "at most the single in-flight record"); any
  terminated but invalid line, by contrast, is corruption and nothing after
  it is trusted (`AFTER_CORRUPT_LINE`), the gateway refuses to open or
  append (`JOURNAL_CORRUPT`). (c) *The closed sets are functions*
  (`journalEntryTypes()`, `witnessEntryTypes()`, …) returning fresh literals,
  because the architecture gate forbids module-scope non-primitive state in
  `src/core/**` and the P1 core already lives under that rule; the witness
  class still has exactly one literal (checked by a source scan in
  `tests/j3-j4-entry-schemas.spec.ts`). (d) *One witness line per instance*:
  a second `SUPPRESSED`/`FENCED_OUT` from the same `instanceId` is
  `WITNESS_ALREADY_RECORDED` — "exactly one FENCED_OUT" (S-G12-07) is
  enforced from the journal, not from process memory. (e) *Holder guard is
  local, epoch is authority*: `holder.json` (writer id + heartbeat) lets a
  live writer's rival be `SUPPRESSED` and lets a matching-epoch request from
  a non-holder be refused (`NOT_THE_WRITER`) while the heartbeat is fresh; an
  absent holder record refuses nothing — authority is decided by the epoch
  alone, the holder record only schedules. `heartbeat()` writes the holder
  record only when the store still carries the caller's epoch, so a fenced
  writer cannot clobber its successor. (f) *Store reset under an existing
  journal is a reset* even when the account looks virgin: absent store +
  non-empty journal, absent store + non-virgin or unknown account → `GAP` +
  `HALT EPOCH_STORE_RESET`; only virgin + empty journal seeds, and then every
  authoritative request is `SEED_NOT_JOURNALED` until the `BOOTSTRAP` with
  `epochSeeded: true` lands. (g) *Manual un-halt appends under the current
  store epoch* through `src/shell/manual-unhalt.ts` and the gateway's
  `dispatchManualUnhalt`, without a takeover: the human action is journaled
  with operator and reason and is refused while the halt is sticky; ordinary
  `dispatch` refuses `UNHALT` outright. The "no code path clears the flag"
  claim is held by a source scan (only the manual module and the gateway's
  refusal mention `UNHALT`) plus the pure transition
  (`haltStateAfter` clears only on `actor: "human"`). (h) *A foreign account
  binding halts*: a broker mutation or an order-related entry whose binding
  differs from the gateway's configured triplet is refused before the port,
  one `HALT ACCOUNT_BINDING_MISMATCH` is appended, the flag is set (S-J-06
  "refuse all orders, journal, halt"). (i) *The canonical trading origin is
  configuration*, not a literal in the core: `bindAccount` takes
  `canonicalTradingOrigin` and checks its shape (https, lowercase host,
  `paper-` prefix, no port/path/query/fragment/userinfo) before comparing.
- **2026-08-31 — Verification depth for P2–P6 is reduced by declaration,
  not silently.** Under the competition calendar (P2–P6 before Tuesday
  2026-09-01 15:30 CEST, one phase per session), each phase gets: red-first
  tests for every allocated case, the repository gates (`npm run verify`),
  one hand-written mutation probe on the phase's mechanisms, and one blind
  counter-verification of the phase's riskiest mechanism on the gate tier.
  No bis-0 run: no round protocol, no lens register, no closing round; the
  six bis-0 criteria are not claimed for these phases and must not be
  reported as met. For P2 the record is the store
  `C:\Users\felix\verify-runs\fradzano\glass-box-trading\p2-journal-authority`
  (`LEDGER.md`): `npm run verify` exit 0 at `d8281e5` and `0431ac9`;
  mutation probe 9/9 caught (one mutant re-run after a non-compiling first
  form); blind gate on the epoch/fencing gateway: the first call
  (`task-mth6xs72-d7lqbi`) was ended by the provider content filter without
  a verdict, but its interim inspection named two real edges, closed
  red-first at `0431ac9` — **G1-F1**: epoch equality plus a fresh rival
  heartbeat was the whole holder check, so an instance that had only
  *observed* the winner's epoch could dispatch under it once the winner's
  heartbeat aged out; now the store's `holderId` must be the requesting
  instance (`NOT_THE_WRITER`), the heartbeat only decides suppression at
  acquisition. **G1-F2**: the virgin-seed obligation lived in process
  memory; now `seedPending` is persisted in `epoch.json` and cleared
  atomically after the `BOOTSTRAP` append, so a restart inherits it. The
  second call (`task-mth7dgrq-6dx7ps`, neutral vocabulary, launched
  without `--write`) could not execute a single probe in its read-only
  sandbox and returned `VERDICT: NOT ISSUED`; its read-only diagnostic
  still exposed **G2-F1**: `planEpochAcquisition` had no notion of a
  pending seed, so a takeover or a same-id re-acquisition of a seed-pending
  store cleared the obligation and authorized a non-`BOOTSTRAP` append.
  Closed at `6677b24`: the `INCREMENT` plan inherits `seedPending`, the
  gateway persists it on the new epoch, only the `BOOTSTRAP` append clears
  it. The third call (`task-mth87op3-454yk7`, `--write`, claims restated
  for `6677b24`) executed its probes and returned **`REFUTED`** at
  `d74d2ce`: claims 2 (nine-process race) and 4 (torn UTF-8 tail) held,
  three closures were required — **G3-F1** the entry's own epoch field was
  never bound to the request epoch (a `CYCLE` claiming epoch 99 landed under
  epoch 1); **G3-F2** the persisted holder id was treated as acquisition, so
  a fresh gateway with the same `instanceId` reached the broker port and
  appended without ever acquiring; **G3-F3** the reset path persisted the
  store before its `GAP`/`HALT` pair, so a failed append left a silently
  seeded store. All three closed at `c13ab5e` (`ENTRY_EPOCH_MISMATCH`;
  `NOT_ACQUIRED_IN_PROCESS` — authority is the epoch *this gateway instance
  won in this process*; `GAP`, `HALT`, and the flag durable before store and
  holder, a thrown write is a refused acquisition), plus the variant that
  one witness line per instance now holds across types. **The closures at
  `c13ab5e` were then put to a fix verification**: the fourth call
  (`task-mth9f0wj-a6cuce`) was ended by the provider content filter before
  any probe; the fifth (`task-mth9nyst-0i2n0y`, no verification skill,
  neutral wording) executed and returned **`REJECTED`** — G3-F1, G3-F2 and
  the witness rule **confirmed** under original and adjacent variants (and
  no new bypass found besides the one below), G3-F3 rejected as **G5-F1**:
  the reorder let the reset's `GAP`/`HALT` land under epoch 1 before any
  store existed, and a repaired retry appended a second pair. Second seam
  on the same mechanism, so per the "fixes carry defects" axiom the design
  changed instead of a third patch (`e44809a`): the reset is a persisted
  *pending* acquisition — the store is written first with
  `resetPending: true`, an epoch under which `authorizeMutation` refuses
  everything (`RESET_PENDING`); the `GAP`/`HALT` pair and the flag are
  completed under it, then it is promoted; a failed store write leaves
  nothing; an interrupted reset is inherited by the next acquirer and
  completed exactly once (`resetPairPresent`). The sixth call
  (`task-mthadqew-m9cxj9`, fix verification of G5-F1 with interruption,
  rival-takeover, half-pair, and concurrent-taker variants) held every
  reset variant and returned **`REJECTED`** on one adjacent path, **G6-F1**:
  the manual un-halt bypassed the `resetPending` guard, landed an `UNHALT`
  under a pending epoch, and the next takeover appended a second pair.
  Closed at `5d875ea` as prescribed: the manual path refuses
  `RESET_PENDING` and `SEED_NOT_JOURNALED` before touching the journal. The
  seventh call (`task-mthb03w7-pwxs9p`, fix verification of G6-F1 with the
  manual path under pending, seed-pending, normal, sticky, and live-writer
  stores) returned **`CONFIRMED`** at `5d875ea`, with no new path found.
- **2026-08-31 — P2 closing state: green, gate-confirmed on its riskiest
  mechanism, awaiting the owner's word for the merge.** Final code commit
  `615dbd0` on `p2/journal-authority` (`npm run verify` exit 0: 76 tests,
  static and sandbox gates, partition check). What the reduced depth
  delivered for the epoch/fencing gateway: seven blind gate calls — two ended
  by the provider content filter, one read-only without a verdict, one
  `REFUTED` with three findings, two `REJECTED` with one finding each, one
  `CONFIRMED` — and seven closed findings (G1-F1/F2, G2-F1, G3-F1/F2/F3,
  G5-F1, G6-F1), the last two on the reset path where the second seam
  forced a design change (persisted pending acquisition) rather than a third
  patch. Confirmed by executed evidence: entry epoch bound to the request,
  acquisition in this process, persisted holder id is not authority, one
  witness line per instance and never the broker, atomic
  compare-and-increment across nine processes, serialized appends with a
  UTF-8 torn tail, pending-seed and pending-reset obligations under every
  interruption, rival, half-pair, and concurrent variant, and the manual
  un-halt path. Not counter-verified by a gate: the Windows rename retry in
  `writeJsonAtomically` (`615dbd0`, a robustness fix observed by the seventh
  reviewer) and everything outside the gateway beyond the repository gates
  and the 9/9 mutation probe (schemas, redaction, binding, halt fold). This
  is the declared reduced depth, not a bis-0 termination. Record:
  `C:\Users\felix\verify-runs\fradzano\glass-box-trading\p2-journal-authority\LEDGER.md`.
  Merge into local `main` only on Felix's word; P3 starts from the accepted
  P2 on its own branch.

- **2026-08-31 — P3 starts on `p3/broker-execution` from the unmerged P2 head
  (`f1ff38c`), not from a merge.** The owner's word on merging
  `p2/journal-authority` into `main` was still pending when the P3 session
  began; a branch from P2's head is a superset of any later `--no-ff` merge,
  so it can be merged after P2 without conflict and pre-empts nothing. The
  merge decisions for P2 and P3 remain the owner's.
- **2026-08-31 — P3 design decisions (broker execution under fakes).**
  (a) *The executable limit replaces the analyst's stated limit before
  `decide`* (S-X-01): `priceEntryLimit` derives mid ± `LIMIT_TOLERANCE` from
  the snapshot's quotes at the penny tick (a debit rounds its mid up and adds
  the tolerance, a credit rounds down and subtracts it), so G1–G4 reserve
  from the very value the executor submits; the analyst's limit only
  declares the kind (a contradiction with the quotes is a pricing refusal);
  a re-price is the same function on fresh quotes followed by `decide`
  (WIN-11). The penny tick is the ETF universe's; a coarser broker tick is a
  P7 observation, not a P3 assumption. (b) *An OUTCOME is written only for a
  terminal broker status* (filled, rejected, canceled, expired; a cancel
  after a partial fill is `partially_filled`); a working order yields no
  OUTCOME and keeps counting as fillable exposure from its INTENT until phase
  0 of a later cycle sees its terminal status (S-X-04). Phase 0 re-reads
  every `intent`, `confirmation_unclear`, and `fillable` lifecycle by client
  order ID. The earlier rule that a negative lookup released a never-confirmed
  order is superseded by R20: after a lost acknowledgement, `RECONCILIATION`
  `NOT_SUBMITTED` remains uncertain, reserved, and entry-blocking because the
  request may appear later; a formerly working order that vanished likewise
  blocks entries instead of releasing (fail closed). (c) *The revalidation
  claimset has eight claims and no narrower reading*: account bound, equity
  not below the kill threshold, positions fingerprint, open-orders
  fingerprint, control epoch, not halted, limit and reserve unchanged, G1–G4
  still pass on a `decide` re-run against the fresh book (G7 vetoes there
  because the INTENT is durable; only G1–G4 are read). A void lands as
  `RECONCILIATION` `REVALIDATION_VOID` with the claimset and violated claims
  as item fields (the OUTCOME schema has no room and a void is not a broker
  outcome). (d) *The primary CYCLE entry is appended before phase 4*, so
  the decision is durable before any INTENT or order (A5, A7); a failing
  CYCLE append is the S-CYC-06 case. (e) *A close has a durable intent too*
  (A5): the INTENT schema gains `action: "close"` (route, generation,
  closing legs, limit, reason, no gate vector, no rationale floor); entry
  INTENTs may carry `action: "entry"` or omit it, so P2 fixtures are
  unchanged. (f) *A rejection carries the broker's reason verbatim* (S-X-03):
  OUTCOME gains `brokerReason`, optional in general and mandatory non-empty
  for `rejected` (`BROKER_REASON_ABSENT` when the broker sent none); the one
  P2 fixture that asserted a reasonless rejection validates was updated and a
  negative case added. (g) *Kill management is mechanical*: working orders
  are classified by whether every leg offsets a held position (cancel the
  rest, adopt the reducers); intact journaled structures are flattened whole
  through the S-G7 close lifecycle at a plain S-X-01 limit (the S-X-05
  ladder is P5); anything an intact lifecycle does not explain is residue and
  is closed leg by leg (S-X-06's discriminated policy is P5); `KILL` lands
  only when the reloaded book is flat, a lost cancel acknowledgement keeps it
  non-flat. (h) *The journal-unavailable rule keeps the emergency path
  reachable*: a phase-0 append failure blocks entries but the snapshot and
  the kill predicate still run; the emergency close goes through the same
  gateway under the deterministic attempt ID (`close:<exposure>:g<n>`, next
  unused generation, an existing sufficient close adopted first) and only if
  every leg offsets a held position; detection on recovery probes that
  attempt ID at the broker and journals `AUDIT_GAP_EMERGENCY_CLOSE` with the
  broker's data and an explicit "no durable prior INTENT". (i) *Broker-port
  answers are distinguishable from gateway refusals*: the gateway tags
  `ok: false` results that came from the port with `source: "broker_port"`
  (a thrown port error becomes `PORT_ERROR:…`), so the runner never mistakes
  a refusal before the port for a broker answer; the fake's synchronous
  rejection is `REJECTED:<reason>`, a duplicate is
  `DUPLICATE_CLIENT_ORDER_ID`, anything else is a lost acknowledgement.
  (j) *The adapter is pure and lives in the core*: `assembleDecisionSnapshot`
  validates every contract, quote, spot, broker figure, prior sample, and
  reconstructed lifecycle and builds every unit through `integerUnit`/
  `lotCount`; the shell calls it and passes only raw analyst text to
  `parseAnalystOutput` (RES-P1-01a..d discharged). A rejected snapshot is
  journaled as `SKIP` `WORLD_PARTIAL` with the reason in the runner's
  report only — the closed SKIP schema has no detail field; declared
  limitation. (k) *UTC conversion is done in the core without the host
  clock* (civil-from-days), because journal timestamps are strings and the
  decision core needs milliseconds. (l) *A fill worse than the submitted
  limit halts new entries* (S-X-02): the OUTCOME carries
  `BROKER_PRICE_BREACH`, the fold reserves the actual exposure, and the runner
  appends a non-sticky `HALT` with the new reason `BROKER_PRICE_BREACH` so
  entries stay blocked pending reconciliation and a manual un-halt; the
  fail-ping half of "alarm" is P5.
- **2026-08-31 — P3 additive changes to accepted phases.** P1: `definedRiskAt`
  is exported (the fold prices filled portions at the actual fill price,
  including a breach). P2: OUTCOME `brokerReason` (optional, mandatory for
  rejections), INTENT `action: "close"` variant, HALT reason
  `BROKER_PRICE_BREACH`, and the gateway's `source: "broker_port"` tag. None
  changes an accepted P1/P2 test's claim; one P2 fixture gained the reason.
- **2026-08-31 — P3 verification record (declared reduced depth).** Final
  code commit `c66c3be` on `p3/broker-execution` (`npm run verify` exit 0:
  115 tests, static and sandbox gates — the sandbox now executes the
  execution core as its seventh path — partition check P3 = 12). Order of
  work, stated plainly: the P3 core and its tests were written in one
  sitting and first executed together; the red state was observed only for
  three first-run failures (two test-side, one real: the runner returned
  after a phase-0 journal failure before evaluating the kill predicate,
  which would have made the S-CYC-06 emergency close unreachable exactly
  when the journal is down — corrected before the first commit). P3's
  red-first discipline is therefore weaker than P2's; the probe below is the
  evidence that the tests bite. Mutation probe (store
  `C:/Users/felix/verify-runs/fradzano/glass-box-trading/p3-broker-execution`,
  `responses/P3-probe-mutation.json` and `…-rerun.json`): fourteen
  hand-written mutants on the P3 mechanisms — kill predicate `<=`, debit
  limit minus tolerance, breach/improvement swapped, claimset without
  `POSITIONS_UNCHANGED`, kill never reported by revalidation, emergency close
  allowed to open a leg, `confirmation_unclear` releasing its reservation,
  flatness ignoring positions, runner submitting despite a void verdict,
  runner skipping phase 0, reasonless rejection accepted by the schema,
  rejection mapped to canceled, runner emergency close ignoring eligibility,
  runner executing entries after a mid-cycle kill. 12/14 caught at `3961d64`;
  survivor M14 closed at `c66c3be` by a two-plan test (the second plan must be
  `NOT_SENT` with no second INTENT) and re-run caught; survivor M13 is
  declared, not tested: the runner's eligibility check guards flatten targets
  that `planKillManagement` derived from the very book the check reads, so
  no executed variant can make it fail — defence in depth, C-class. Also
  found by the evidence-debt reconciliation, not by a test: S-X-02's halt
  after a price breach was missing; closed at `c66c3be` (HALT reason
  `BROKER_PRICE_BREACH`, non-sticky, test in `tests/cyc-runner.spec.ts`).
  Limit of the probe: hand-picked mutants on the mechanisms the tests were
  written for, not a mutation-testing tool run. Blind counter-verification:
  one gate call on the executor path (durable intent and passed re-check
  before any entry order; kill management under the fence; the
  journal-unavailable rule; phase-0 resolution before any new order; broker
  answers onto the closed outcome set) — prompt
  `prompts/G1-executor-path.md`, launched `--write` from the repository
  directory as Codex job `task-mthde869-81r6p8`; verdict recorded in the store's
  `LEDGER.md` and in `STATE.md` → Now when it arrives. Until then P3 is
  *green and probed*, not gate-confirmed.
- **2026-08-31 — P3 gate finding G1-F1 closed: kill management sends no
  cancel while the journal is unavailable.** The first blind gate call on
  the executor path (Codex job `task-mthde869-81r6p8`, `REJECTED`) executed the
  case journal read-only + kill + one resting risk-increasing entry: the
  runner canceled the entry before the permitted emergency close, a broker
  mutation with no durable record outside the single S-CYC-06 exception.
  Closed at `5afb5d1` as prescribed: without a durable `HALT` the cancel
  loop does not run; the resting entry stays at the broker, counted as
  fillable exposure from its INTENT, and the next cycle that can append the
  `HALT` cancels it. Trade-off stated: during a journal outage a resting
  entry may fill; the fill becomes held exposure that the same emergency
  route may close, and every mutation stays inside the specified exception.
  Four of five claims held on executed variants; the gateway's two
  administrative appends (reset pair, manual `UNHALT`) were noted as the
  known exceptions to "every append passes `dispatch`". Fix verification
  launched as Codex job `task-mthe6upm-hpouop`; verdict recorded in the store's
  `LEDGER.md` and `STATE.md` → Now.
- **2026-08-31 — P3 closing state: green, gate-confirmed on its riskiest
  mechanism, awaiting the owner's word for the merges.** Final code commit
  `5afb5d1` on `p3/broker-execution` (`npm run verify` exit 0: 116 tests,
  static and sandbox gates, partition check). The reduced depth delivered:
  13/14 mutation probe (M13 declared), one evidence-debt finding closed
  (S-X-02 breach halt), and two blind gate calls on the executor path — one
  `REJECTED` with a single class-A finding (G1-F1: a cancel sent while the
  journal was unavailable), closed red-first as the gate prescribed, and
  one `CONFIRMED` across seven executed variants including recovery order
  and the unreadable epoch store. Confirmed by executed evidence: durable
  INTENT plus passed re-check before any entry order, kill management under
  the fence, the journal-unavailable rule with its single exception,
  phase-0 resolution before any new order, the closed-outcome mapping.
  Not gate-verified: pricing arithmetic, snapshot adapter, fold, and fake
  broker beyond the repository gates and the probe. This is the declared
  reduced depth, not a bis-0 termination. Record:
  `C:/Users/felix/verify-runs/fradzano/glass-box-trading/p3-broker-execution/LEDGER.md`.
  Merges into local `main` only on Felix's word (P2 first, then P3); P4
  starts from the accepted P3 on its own branch.
- **2026-08-31 — owner acceptance and merges: P2 and P3 are on `main`.**
  Felix accepted the declared reduced depth for both phases and ordered both
  merges (session decision prompt). `p2/journal-authority` (`f1ff38c`)
  merged as `9e380fc`, `p3/broker-execution` (`6265cd0`) merged as
  `a737a80`, both `--no-ff`, conflict-free by construction (linear
  ancestry). `npm run verify` exit 0 on the merged `main` (116 tests). P4
  starts from the merge on `p4/fail-closed-startup`.
- **2026-08-31 — P4 design: the CONFIG_INVALID journal entry yields to the
  seed rule on a virgin install.** S-CYC-11's "CONFIG_INVALID journaled
  locally" collides with two harder rules on a first-ever run: S-CYC-11
  itself forbids any broker call before validation, and S-CYC-09 forbids
  seeding the epoch store without an account classification only a broker
  call can provide. Resolution (fail-closed composition): `runStartup`
  appends the `HALT CONFIG_INVALID` only over a present, unencumbered epoch
  store (seed discharged, no pending reset); otherwise the refusal goes to
  the OS diagnostic sink as `CONFIG_INVALID_UNJOURNALABLE` and the first
  armed run over a seeded store imports it as `RECONCILIATION`
  `CONFIG_INVALID`. A refusal must leave no acquisition side effect — a
  virgin install may never be mislabeled as a store reset. The failure-only
  ping fires on every refusal path regardless.
- **2026-08-31 — P4 additive changes to accepted phases.** P3 core:
  `haltDraft` reasons widened by `AUTH_FAILURE` and `CONFIG_INVALID`, both
  non-sticky (manual un-halt after the fence procedure / config repair;
  S-G12-06, S-CYC-11). P3 shell: the fake broker gained persistent scripted
  HTTP read failures (`setReadHttpFailure`), carried by the new
  `BrokerHttpError` transport (`src/shell/broker-errors.ts`); the cycle
  runner classifies broker read failures through the pure
  `classifyBrokerFailure` — 401/403 fence as a durable `AUTH_FAILURE` halt,
  everything else stays in the S-CYC-02 world classes. P2 guard test
  `tests/g12-fencing.spec.ts` S-G12-07 (2): `diagnostic-sink.ts` joined the
  writer allow-list — it writes only to the pre-armed OS sink outside
  `STATE_DIR` and is never state authority.
- **2026-08-31 — P4 shell literals: canonical origin and alert SLA are
  expectations, not core constants.** §0 forbids hardcoding config symbols
  in core logic, but S-CYC-11 must judge the *configured* origin against
  the canonical paper origin and the timer sum against the 60-minute SLA.
  Both literals live in `src/shell/startup.ts`
  (`CANONICAL_PAPER_TRADING_ORIGIN`, `ALERT_SLA_MS`) and are passed to the
  pure validator as `StartupExpectations`. The origin rule is byte-exact on
  purpose: only the canonical literal passes, so no normalization surface
  exists for lookalikes.
- **2026-08-31 — P4 scope note: competition-profile certificate.** S-CYC-11
  requires the S-ARM-01 certificate before competition arming. P4 enforces
  presence (`CERTIFICATE_MISSING` when `ALPACA_PROFILE` is `competition`
  without `PRE_ARM_CERTIFICATE`); content, digest, and identity validation
  are owned by S-ARM-01 (P7) with WIN-7/WIN-10/WIN-17 rows kept open for
  those parts. The Windows-event-log implementation of the diagnostic sink
  is likewise deferred to pre-arming; the file-backed sink carries the
  contract under fakes.
- **2026-08-31 — P4 gate finding G1-F1 closed: the credential fence also
  fences the phase-4 re-check.** The first blind gate call on the
  startup/launch boundary (Codex job `task-mthi2xj7-ae4fpy`, **REJECTED**,
  16 executed variants) executed the case 401 first on the re-check fetch
  after a durable INTENT: the runner recorded only a generic
  `REVALIDATION_VOID`, set no halt, and the next cycle with restored
  credentials consulted the analyst and submitted an order. Closed
  red-first at `2aa30fc`: the re-check fetch classifies 401/403 through the
  same `haltForAuthFailure` path as the snapshot and phase-0 reads — one
  durable non-sticky `HALT AUTH_FAILURE`, the void still documents the
  violated claims, later plans of the cycle are blocked, the recovered
  cycle stays management-only until a human un-halts. Declared deviation
  from the gate's bounded change: no second primary `SKIP` line — the
  cycle's primary `CYCLE` already landed, and one primary line per cycle
  is the journal's invariant; the `HALT` carries the durable
  `AUTH_FAILURE` evidence. Two observations declared without fix (ledger):
  a phase-0 fence leaves `CYCLE` as the primary line like every other
  halted cycle, and a journal append failing after the store check falls
  back to the sink's `CONFIG_INVALID_UNJOURNALABLE` as designed. Every
  startup-refusal, launcher, and world-class claim held on executed
  evidence. Fix verification launched as Codex job `task-mthjmppo-yaet07`;
  verdict recorded in the store's `LEDGER.md` and `STATE.md` → Now.
- **2026-08-31 — P4 closing state: green, gate-confirmed on its riskiest
  mechanism, awaiting the owner's word for the merge.** Final code commit
  `2aa30fc` on `p4/fail-closed-startup` (`npm run verify` exit 0: 161
  tests, static and sandbox gates, partition check). The reduced depth
  delivered: 15/15 mutation probe (every mutant compiled before its run),
  one blind gate call **REJECTED** with a single class-A finding (G1-F1,
  the credential fence missing the phase-4 re-check seam), closed
  red-first, and one **CONFIRMED** (Codex job `task-mthjmppo-yaet07`,
  eight executed variants: both fence status codes on the re-check seam,
  the snapshot and phase-0 seams, 500/plain errors never fencing, a
  two-plan cycle leaving the second plan `NOT_SENT`, no stacked halts).
  Confirmed by executed evidence: every startup refusal path, the
  launcher's no-release-before-acceptance rule, the constructed child
  environment, the credential fence on all three seams. Not gate-verified
  beyond the repository gates and the 15/15 probe: the pure validator's
  individual bound checks and the manifest/lock schemas. This is the
  declared reduced depth, not a bis-0 termination. Record:
  `C:/Users/felix/verify-runs/fradzano/glass-box-trading/p4-fail-closed-startup/LEDGER.md`.
  Merge into local `main` only on Felix's word; P5 starts from the
  accepted P4 on its own branch.
- **2026-08-31 — owner acceptance and merge: P4 is on `main`.** Felix
  accepted the declared reduced depth for P4 and ordered the merge
  (session decision prompt, option "Ja, mergen"). `p4/fail-closed-startup`
  (`acb5be4`) merged as `43e7170`, `--no-ff`, conflict-free by
  construction (linear ancestry). `npm run verify` exit 0 on the merged
  `main` (161 tests, all gates). P5 starts from the merge on
  `p5/recovery-lifecycle`.
- **2026-08-31 — P5 additive changes to accepted phases.** Domain/journal
  closed sets widened: `CloseRoute`/`CloseRouteLabel` gained `residue` and
  `deadline`; `HaltReason` gained `WATCHDOG_TAKEOVER`,
  `DEADLINE_FLATTEN_FAILED`, `EXPIRY_EVICTION_STUCK`, and
  `CLOSE_LADDER_CAPPED`; `haltDraft` accepts the new reasons and marks
  `PROVENANCE_BROKEN` sticky alongside `KILL`; `TERMINAL` gained the
  optional `remainder` field (S-G11-04's explicit open remainder) and
  `DEADLINE_RECONCILIATION` the optional `reference` (S-G11-03).
  Execution core: `netMidTwice` is exported for the S-X-05 ladder;
  `cycleDraft` accepts `lifecycleVetoes` (EXPIRY/DEADLINE verdicts land in
  the CYCLE's candidate verdicts). Startup core: the closed §0 field set
  gained `COMPETITION_START` and `FLATTEN_DATE` with the
  `CALENDAR_UNORDERED` coupling (start before the qualifying checkpoint).
  P2 guard test S-G12-07 (2): `watchdog.ts` joined the closed broker-port
  user list — it constructs its own gateway like `gateway-cli.ts` and
  never calls the port directly.
- **2026-08-31 — P5 design: the G10 discrimination rule and the equity
  sentinel.** A leftover book piece is `RESIDUE` when its contract appears
  in a journaled structure's legs or is share stock of a journaled
  underlying (assignment mechanics can only touch what we held); a wholly
  foreign contract is `HUMAN_ACTION`. Any short piece is unbounded
  (S-X-06), any long piece bounded. Assigned share stock travels through
  the option-leg order shape as an equity sentinel leg (expiry
  `1970-01-01`, strike 0, right `call`, contract ID = share symbol,
  `equityLegExpirySentinel()`); the broker adapter maps a sentinel leg
  onto an equity order. A foreign contract without metadata gets no
  fabricated close: the halt stands for the human (S-G10-02's "developer
  must look"). The empty-journal FOREIGN_BOOK_GAP path classifies without
  firing the HUMAN_ACTION provenance latch — a lost journal is not proof
  of manual competition activity.
- **2026-08-31 — P5 design: gap threshold and the primary substitutes.**
  S-CYC-08's "first cycle after any gap" triggers when the last primary
  entry is older than 2 × CYCLE_INTERVAL. A GAP invocation is
  reconciliation-focused: classification and management closes run,
  entries resume with the next scheduled cycle (S-J-03: GAP is not a full
  cycle). A BOOTSTRAP invocation proceeds as a normal cycle per S-CYC-09;
  its decisions are journaled through their INTENT entries because the
  BOOTSTRAP schema carries no verdicts.
- **2026-08-31 — P5 design: S-CYC-10 composition with the G10 halt.** Our
  own intent-without-resolved-outcome (`CONFIRMATION_UNCLEAR`) blocks
  entries transiently through the phase-0 UNRESOLVED mechanism and is
  journaled in the classification each cycle, but does NOT set the durable
  halt — S-CYC-10's "only a successful classification unblocks" would
  otherwise demand a human un-halt for every transient broker outage.
  RESIDUE, UNKNOWN_ORDER, and HUMAN_ACTION set the durable
  `RESIDUE_UNRESOLVED` halt. A journaled `DECLARED_EXPIRY_HOLD` is a
  terminal residue state: excluded from the unresolved set and the
  session clock, never re-enqueued, still visibly not-flat.
- **2026-08-31 — P5 design: competition provenance failure over a
  seed-pending store.** A competition bootstrap whose provenance proof
  fails cannot journal: the virgin-seeded store accepts only the
  BOOTSTRAP entry (P2 seed rule), and appending one would adopt the
  unproven baseline. Parallel to the P4 virgin-install decision, the
  refusal is carried by the failure-only ping
  (`COMPETITION_PROVENANCE_FAILED`) and the seed stays pending — no order
  can ever follow, fail-closed by construction. Where the store IS
  journalable, reuse evidence (pre-start creation, non-empty history)
  halts sticky `PROVENANCE_BROKEN`; incomplete evidence (missing pages)
  halts retryably as `GAP`.
- **2026-08-31 — P5 design: watchdog quiet states, the runner's lifecycle
  seam, and the ladder floor.** The watchdog stays quiet on an empty
  journal (no hung writer exists; the external dead-man check owns that
  alarm) and outside sessions (S-G14-01). `CycleDependencies.lifecycle`
  is `LifecycleDeps | null`: the P3/P4 suites run the executor path with
  `null`, every production wiring supplies the full record — the seam is
  a typed, explicit test-scope marker, not a silent default. The S-X-05
  zero floor rests at one cent, the smallest legal credit at the floor
  (a zero-price limit order does not exist); with a zero bid such an
  order never fills, which is exactly the S-X-06 expiry-hold precondition.
- **2026-08-31 — P5 closing state: green, gate-confirmed on its riskiest
  mechanism at the first call, awaiting the owner's word for the merge.**
  Final code commit `c4d055c` on `p5/recovery-lifecycle` (`npm run verify`
  exit 0: 216 tests, static and sandbox gates, partition check). The
  reduced depth delivered: 15/15 mutation probe (two equivalent mutants
  declared and replaced by real ones at the same sites, both caught;
  every mutant compiled before its run), and one blind gate call
  **CONFIRMED** (Codex job `task-mtho7bkg-yg3zi8`, no filter abort, all
  five claims on executed evidence: the width cap holds under escalation
  with one non-stacked halt; a lost cancel acknowledgement never spawns a
  parallel close child; the watchdog fences before acting, dispatches
  three closes for three lifecycles without duplicates, and stays quiet
  against a live writer; bounded/unbounded residue discrimination end to
  end; the recovery layer reaches no entry and no analyst). Confirmed by
  executed evidence: the escalation ladder and its caps, the watchdog
  takeover, the residue discrimination, the recovery/entry separation.
  Not gate-verified beyond the repository gates and the 15/15 probe: the
  classification details, the provenance proof, the ping plan, and the
  deadline entries. This is the declared reduced depth, not a bis-0
  termination. Record:
  `C:/Users/felix/verify-runs/fradzano/glass-box-trading/p5-recovery-lifecycle/LEDGER.md`.
  Merge into local `main` only on Felix's word; P6 starts from the
  accepted P5 on its own branch.
- **2026-09-01 — owner acceptance and merge: P5 is on `main`.** Felix
  accepted the declared reduced depth for P5 and ordered the merge
  (session decision prompt, option "Ja, mergen"). `p5/recovery-lifecycle`
  (`2261b16`) merged as `4e20de8`, `--no-ff`, conflict-free by
  construction (linear ancestry). `npm run verify` exit 0 on the merged
  `main` (216 tests, all gates). P6 starts from the merge on
  `p6/public-evidence`.
- **2026-09-01 — P6 starts on `p6/public-evidence` from the P5 merge
  `4e20de8`.** Scope per `config/implementation-phases.json`: S-CYC-07,
  S-CYC-12, S-J-07..09 plus the SUB-02/SUB-11 delivery acceptance; external
  effect boundary: local candidate artifacts and fake promotion endpoints,
  no GitHub or Vercel mutation.
- **2026-09-01 — P6 design: the projection marks open exposure at the
  latest snapshot's own quote samples, and everything else is
  `UNATTRIBUTED`.** Realized P&L is the journaled entry fill joined to the
  journaled close fills of the same exposure lifecycle (credit received,
  debit paid, in integer cents); unrealized P&L is the open remainder marked
  at twice-mid of the quote samples carried by the same snapshot that
  supplies current equity — never an older sample, so a mark and the equity
  it explains share one instant. A leg without a sample in that snapshot
  makes the lifecycle's unrealized value null and the sleeve's total null;
  the equity delta minus realized minus computable unrealized is displayed
  as `UNATTRIBUTED` with a discrepancy line. Fees, assignment residue value,
  and any broker effect the journal cannot join therefore surface as a
  number the judge can see, never as a sleeve assignment by inference.
  The S-CYC-06 emergency close is folded from its `AUDIT_GAP_EMERGENCY_CLOSE`
  reconciliation item with `intentSeq: null` and links to that item only.
- **2026-09-01 — P6 design: the qualification window caps every entry, and
  the mode is a brief, not a gate parameter.** While the S-CYC-12 window is
  open (checkpoint reached, no ordinary competition fill, window end not
  reached), every approved entry plan must be one lot, at or below
  `QUALIFICATION_MAX_LOSS`, and the only live attempt (an entry lifecycle in
  `intent`/`fillable`/`confirmation_unclear` counts as live; a plan accepted
  earlier in the same cycle counts too). The vetoes run after the unchanged
  gate vector and the P5 lifecycle vetoes and are journaled as candidate
  verdicts in the CYCLE. The analyst receives `AnalystInput.qualification`
  (`active`, `maxLossCents`, `windowEndMs`) — a prioritisation hint whose
  record has no field the decision core reads, so the mode structurally
  cannot widen tolerance, whitelist, expiry, liquidity, sleeve, or
  concentration bounds. The state is projected at the start of the cycle
  from the journal, so the cycle that produces the first qualifying fill
  still carries `COMPETITIVENESS_AT_RISK`; the next one does not. Outside
  the window nothing changes: after the window end ordinary trading and
  G11 continue under the normal gates, with `WINNING_ACCEPTANCE_FAILED` in
  every CYCLE. Dev profile and a wiring without the competition calendar
  project `NOT_APPLICABLE`.
- **2026-09-01 — P6 design: the committed journal revision is the content
  hash until the git port exists.** `journalContentRevision` (sha256 of
  the complete journal text, 16 hex digits) is what the P6 fake git port
  returns and what every receipt and page names; the real git port (P8)
  returns the journal-branch commit and may carry the content hash beside
  it. The probe contract compares the page's `glass-box-journal-revision`,
  `-evidence-cutoff`, `-evidence-cutoff-kind`, `-last-updated`, and
  `-last-seq` meta tags against the publisher's expectation; a page must
  also answer HTTP 200 without authentication. Receipts (`deployments.json`)
  and the push state (`publish-state.json`) are sidecar files in STATE_DIR,
  outside the journal, epoch, and halt flag; acceptance never appends.
  The journal ref is a shell literal (`journal`) in the publisher
  dependencies, not a §0 symbol — exact byte equality is the S-J-08 rule,
  and the refusal is journaled as a `RECONCILIATION` item
  `journal_push_refused` through the gateway (the publisher's only append).
- **2026-09-01 — P6 design: immutable routes are carried forward by the
  atomic build and never overwritten.** `buildSiteAtomically` stages every
  page next to the output directory, copies the previous `revisions/`
  subtree into the staging directory first, skips any pinned route that
  already exists (`preservedImmutable`), and only then swaps directories;
  a render or write that throws removes the staging directory and leaves
  the previous output byte-identical (UNF-2). The advancing route is
  `index.html`; immutable routes are `revisions/<revision>/<kind>/`.
- **2026-09-01 — P6 additive changes to accepted phases.** P3 core:
  `LifecycleVeto.code` gained `QUALIFICATION_CAP`, `QUALIFICATION_ONE_LOT`,
  `QUALIFICATION_ONE_LIVE`. P3 shell: `AnalystInput.qualification`
  (required field; the analyst adapter of P7 must pass it into the prompt),
  `LifecycleDeps.qualification?` (optional; absent on a dev wiring), CYCLE
  `reasonCodes` now carry the qualification codes, `alarmConditions` carry
  `COMPETITIVENESS_AT_RISK` / `WINNING_ACCEPTANCE_FAILED` (the fail ping is
  the visible alarm). P2 guard S-G12-07 (2): `dashboard-build.ts` joined the
  reviewed writer list (site output only), `publisher.ts` the atomic-writer
  list (sidecar files only). Sandbox gate: the module loader caches the
  promise of a linked module so an import diamond (projection → execution
  and projection → lifecycle → execution) no longer hands an unlinked
  module to a second requester; the core has no import cycles, so the wait
  always resolves. `npm run verify` gained `npm run dashboard` after the
  fixture render.
- **2026-09-01 — P6 scope note: real ports are P8.** The git port
  (commit on the journal branch, push) and the deploy port (Vercel
  candidate deployment, anonymous probe over HTTP, `promote`, `rollback`)
  exist as interfaces with fakes in the tests; wiring them is part of the
  kickoff release (P8), where the first anonymous clean-browser run against
  the public alias is the SUB-02 acceptance. The "clean local browser can
  traverse the golden path" acceptance is met in P6 by the anchor-chain
  test over the recorded golden journal (`tests/j7-j9-golden-path.spec.ts`)
  plus `npm run dashboard`; no browser automation runs in the suite.
- **2026-09-01 — P6 closing state: green, gate-confirmed on its riskiest
  mechanism at the first call, awaiting the owner's word for the merge.**
  Final code commits `10a8e66` (implementation), `fbd0d13` (LF pin for the
  recorded golden journal), `802b335` (dashboard CSS) on
  `p6/public-evidence`; `npm run verify` exit 0 at `10a8e66` (250 tests,
  static and sandbox gates, golden render, partition check), the CSS commit
  re-checked by lint and the golden-path suite. The reduced depth delivered:
  a **17/17** mutation probe (projection, qualification, publication core;
  every mutant compiled before its run; one anchor mismatch caused by the
  CRLF worktree checkout, rerun and caught, no equivalent mutant declared)
  and one blind gate call **CONFIRMED** (Codex job `task-mthvvug0-w9rmn2`,
  no filter abort, every claim on executed evidence: only a matching
  anonymous probe moves the alias and every rejection class leaves a
  reasoned receipt; a stable-origin mismatch restores the previous
  accepted deployment and alarms; push failure never blocks journaling and
  is retried exactly once per revision; a non-journal ref is refused and
  journaled; an interrupted build leaves the previous page byte-identical
  and pinned routes are never overwritten; the projection reconciles to
  the cent with a hard cutoff boundary and the emergency close linked only
  to its reconciliation; the S-CYC-12 window vetoes hold at the exact cap
  and add nothing outside the window). Confirmed by executed evidence:
  publication acceptance, push retry/refusal, atomic build and immutable
  routes, projection reconciliation and cutoff, the qualification window
  under the runner. Not gate-verified beyond the repository gates and the
  17/17 probe: the renderer's prose and anchor chain (golden-path test
  only), freshness thresholds, sleeve attribution details, milestone rules.
  Declared reduced depth, not a bis-0 termination. Record:
  `C:/Users/felix/verify-runs/fradzano/glass-box-trading/p6-public-evidence/LEDGER.md`.
  Merge into local `main` only on Felix's word; P7 (dev live certificate)
  starts from the accepted P6 on its own branch.
- **2026-09-01 — P6 accepted and merged (`bce890a`); P7 starts on
  `p7/dev-live-certificate`.** Felix's word on the P6 merge and the P7 go
  came in the same session. The merge exposed an erratum in the P6 ledger:
  `npm run verify` could not have been exit 0 at `10a8e66` for the lint step
  (`tests/j7-j8-publication.spec.ts` bound an unused rest-omit variable,
  `no-unused-vars`); the file, the eslint config, and the lockfile were
  unchanged since that commit. Fixed on the P7 branch at `3c82d89` (the
  first commit after the merge, because `main` is not committed to without
  the owner's word); the P6 ledger line stays as written and this entry is
  the erratum. Two clean `verify` runs on the merge plus the fix (exit 0,
  250 tests) are the merged baseline.
- **2026-09-01 — P7 design: the configuration field classification has a
  third class, `deployment`, outside the policy digest.** S-ARM-01 named
  the identity fields and the credentials as the digest's only exclusions.
  `STATE_DIR` cannot be role-neutral policy: S-CYC-09's competition
  bootstrap requires an empty journal, so the competition deployment must
  use a different STATE_DIR than the dev run by construction, and a digest
  that included it would invalidate every dev certificate at the role
  switch — the exact failure scenario 69 describes. `STATE_DIR`,
  `BOOTSTRAP_DIAGNOSTIC_SINK`, and `PRE_ARM_CERTIFICATE` are therefore
  classified `deployment` (versioned classification, version 1, in
  `src/core/certificate.ts`); SPEC S-ARM-01 is amended in the same commit.
  Everything else in the closed field set is policy; unknown fields are
  rejected, never assigned.
- **2026-09-01 — P7 design: the dedicated MCP environment is a
  target-directory install run by the pinned runtime with `-S`, not a
  venv.** The tracked runtime lock names two interpreter digests: the
  install manager's launcher shim (`bin/python.exe`) and the CPython 3.14.1
  runtime (`python.exe`). A venv's `python.exe` is a third binary the lock
  does not name, so the environment is built as `uv pip install --target
  <root>/site` from the frozen `uv.lock` of the pinned upstream commit
  (clone at `<root>/src`, `core.autocrlf=false` — the immutable-file check
  compares installed bytes against the commit's git blobs, and a CRLF
  checkout fails it, as the first preflight showed), and the child is
  spawned as `<runtime> -S -c "from alpaca_mcp_server.cli import main;
  main()" --transport stdio` with `PYTHONPATH` naming the target directory
  and the pywin32 subdirectories its `.pth` would add (`-S` processes no
  `.pth`). `PYTHONPATH` is on the child's OS allowlist as an interpreter
  necessity; the base installation's site-packages are never importable.
  The dependency-lock check compares every installed distribution (PEP 503
  normalized) against the lock content read from git objects, never from
  the working tree. The launcher shim is verified but not exercised: the
  child runs the runtime directly, which is the more deterministic of the
  two.
- **2026-09-01 — P7 design: `runtimeDigest` and `policyDigest` are
  computed by a pure core with its own SHA-256.** The shell enumerates and
  hashes the bytes that run (`src/**/*.ts`, `config/*.json`, `package.json`,
  `package-lock.json`, `tsconfig*.json`, `tools/*`; LF-normalized so a
  checkout's line endings cannot change the identity) and gathers the
  analyst runtime identity (lock and manifest digests, upstream repository
  and commit, package name and version, both interpreter digests, a digest
  over the installed launch artifacts); the core canonicalizes (sorted
  keys, sorted paths) and hashes with `src/core/sha256.ts`, checked against
  `node:crypto` on multi-byte vectors in tests and in the sandbox gate. A
  certificate is validated for arming only against digests the same core
  computed for the deployment at hand; nothing is learned from the
  certificate.
- **2026-09-01 — P7 observation: a negative net `limit_price` is a credit
  on Alpaca mleg orders.** Probed on the disposable dev account before the
  session with two throwaway 1-lot credit verticals (`limit_price` -0.01
  and +0.01, both accepted, both canceled within seconds; they are dev
  history, not competition activity). `buildOrderRequest` therefore sends
  the negated net for a credit and the net for a debit; `mapOrder` reads
  the sign back into the limit kind. Money is exact cents from decimal
  strings; the only rounding is half away from zero on broker average fill
  prices; nanosecond broker timestamps are truncated to milliseconds,
  never rounded.
- **2026-09-01 — P7 design: the analyst is an Agent SDK session over an
  in-process proxy of the verified child.** The session gets `tools: []`
  (no file, shell, or web tool), one MCP server whose tools forward every
  call to the exact child the launcher accepted (so the model can never
  reach a second spawn), `settingSources: []`, a constructed environment
  (the subscription token and the OS necessities, no broker key), a
  scratch working directory under STATE_DIR, and a hard abort at
  `ANALYST_TIMEOUT` minus five seconds. Its answer is text; the core's
  `parseAnalystOutput` is the only validator. `AnalystInput` gains
  `market` — the very contracts, quotes, and spot the gates will judge —
  an additive change to the P3/P5/P6 runner: a candidate outside that set
  is vetoed for a missing quote (S-G5-03), so the analyst gains no gate
  influence by seeing it. The certificate run adds a prompt-level
  objective (one minimal, fillable SPY credit vertical) exactly like the
  S-CYC-12 brief: a letter to the analyst, never a gate parameter. The
  default model is `claude-sonnet-5` (a breadth role on a subscription
  budget; `ANALYST_MODEL` overrides). Verified off-hours at 02:53 CEST: the
  analyst returned a schema-valid SPY 766/764 put credit vertical, G1-G4
  passed, G5/G6 vetoed it (stale quotes, closed session) — no order.
- **2026-09-01 — P7 design: the observed market is a shell selection.** The
  runner's market observation covers the universe's nearest three expiries
  inside `[EXPIRY_MIN_SESSIONS, EXPIRY_MAX_SESSIONS]` and strikes within
  `min(MAX_STRIKE_DISTANCE, 300 bps)` of spot, quoted from the indicative
  options feed, plus the equity pseudo-contract per underlying (P5
  decision) quoted from IEX; contracts without a quote are dropped. A cycle
  currently records ~550 quote samples (~90 KB per entry); the window may
  narrow in P9 if the public journal grows too heavy.
- **2026-09-01 — P7 design: the certificate driver sequences four phases
  and the pure core judges them.** Entry cycles every three minutes until a
  defined-risk entry fills (S-G6-05 needs a prior sample, so the first
  possible entry is cycle two; a resting credit is harness-canceled after
  three cycles and recorded as such), one more cycle to reconcile the fill
  through the snapshot; a flatten pass through the S-G11 deadline regime
  with `FLATTEN_DATE` overridden to today for the supervised run (the same
  ladder Thursday will use, exercised live, one-minute cadence); the
  S-G12-06 fence drill (a read port with an invalid secret, the journaled
  `AUTH_FAILURE` halt, the working-order check and cancel through the
  gateway, the manual un-halt with the drill as reason); the final fully
  paginated snapshot. `buildCertificate` derives every clause from the
  journal plus the driver's broker observations (order records by client
  ID), and any broker rejection in the window FAILs. The certificate is
  written to `evidence/pre-arm/<endedAt>.json`. The CLI refuses without
  `--owner-go`, outside the dev profile, and outside the session;
  `--preflight` stops before the first order, `--smoke-cycle` runs one cycle
  only outside the session.
- **2026-09-01 — P7 scope notes.** The production entry is `agent-cli`
  (one cycle per invocation); the Windows Scheduled Task installer and the
  real git/Vercel ports belong to P8's release session. The composition
  root releases the holder record on a clean shutdown (a crash still ages
  out through `LOCK_TAKEOVER_BOUND`). The O5 values live in the tracked
  `config/policy.json` as a proposal (per-position cap 25% of the sleeve,
  underlying exposure $10,000, relative spread 20%, quote size 5, quote age
  90 s, staleness 300 s, kill at $90,000, qualification cap $500, strike
  distance 10%, quantity 5, tolerance and step 2 c, analyst timeout 180 s,
  walltime 300 s, takeover 400 s) — **the owner's freeze is still pending**;
  because `policyDigest` binds them, a later change invalidates the
  certificate and requires a new market-hours run.
- **2026-09-01 — P7 design: a filled record proves acceptance; the
  supervised run holds proposals while an entry rests.** The driver observes
  order records after each cycle; a fast fill can precede the first
  observation, so no `new`/`accepted` state would ever be seen for it. The
  certificate core therefore counts `filled` and `partially_filled` records
  as positive acceptance (the broker cannot fill what it did not accept;
  the `submitted_at` timestamp is the acceptance instant) — a rejection
  still FAILs, and an unrequested cancel still FAILs. Separately, while an
  entry lifecycle has no terminal OUTCOME, the certificate driver hands the
  analyst an empty batch (a harness decision for the supervised run, not a
  gate): the live test exercises exactly one structure at a time, and the
  runner's own vetoes stay untouched.
- **2026-09-01 — P7 verification: five blind gate calls, sixteen closed
  findings, one structural change, a declared residual.** Mutation probe
  16/16 caught at `9777c05` (certificate core, digests, Alpaca mapping,
  SHA-256). The blind gate on the certificate evaluation, the digests, the
  arming validation, and the Alpaca wire mapping ran five times (Codex jobs
  `task-mthyknel-obafmc`, `task-mthz2vfj-ryn88r`, `task-mthztizi-me994z`,
  `task-mti0hzjn-dgopi1`, `task-mti1bgu0-3edjmm`; every call executed its
  counter-examples). Every closure held at its own counter-example on the
  following call; each call then found adjacent cases, all of one
  generator: the certificate accepted values that were well-typed but
  semantically unchecked, and arming trusted the file's content beyond the
  two digests. Closed in order (`23a1921`, `2f2639a`, `2cf27c0`, `2742393`,
  `7423fe8`): per-leg liquidity coverage; acceptance before the terminal
  instant, compared as instants; `undefined`, non-finite numbers, boxed and
  keyless objects refused from digest material; every evidence instant
  inside the test window, quote instants equal to the broker's; the
  defined-risk shape (one underlying, one expiry, exact BigInt ratio sums,
  per-right cover, G1 passed) on the credit INTENT and on the fill's INTENT;
  OUTCOME after INTENT; signed reconciliation; broker timestamps required,
  observations must agree on them; blank or empty identities absent;
  `mapOrder`/`mapPosition` fail-closed on non-positive quantities, 60-minute
  offsets, `mleg` without legs, unknown sides; order pagination re-reads
  timestamp ties and reports a single-tie page unpageable; the runner hands
  the analyst copies of the market, the universe, and the brief. **The
  structural change:** the arming validator moved from ad-hoc checks to an
  exact typed schema with window-checked instants and semantic re-checks,
  and the certificate now carries `evidenceDigest` over its canonical body
  (except verdict and failures) which arming recomputes — any post-hoc edit
  of the file is refused independently of the enumerated rules. The
  documented threat model: the certificate proves the honesty of the run,
  not resistance to a forger who recomputes the digest. **Residual,
  declared:** the G5 closures (`7423fe8`) are verified by their red-first
  tests and the repository gates only — the fifth call was the last blind
  call of this phase's reduced depth, capped before it ran so the loop
  could not become the 32-round case; an offset (`+HH:MM`) broker quote
  timestamp is refused fail-closed (the broker sends `Z`); sparse arrays
  and circular objects are outside the JSON boundary of the digests.
  Record: `C:/Users/felix/verify-runs/fradzano/glass-box-trading/p7-dev-live-certificate/LEDGER.md`.
- **2026-09-01 — P7 closing state on the branch: built, verified off-hours,
  the market-hours run is the acceptance event.** Final code commit
  `7423fe8` on `p7/dev-live-certificate` (`npm run verify` exit 0, 278
  tests, sandbox gate executing the certificate core). Executed against the
  dev account: preflight (S-CYC-11 through the verified MCP child and both
  digests) and two off-hours cycles with a schema-valid analyst candidate
  vetoed by G5/G6. Not yet executed: the market-hours certificate run
  itself (`npm run certificate`, owner go given for 2026-09-01 from 15:30
  CEST; O5 freeze of `config/policy.json` still pending — it binds
  `policyDigest`). Merge into local `main` only on Felix's word, after the
  certificate exists; P8 (kickoff release: real git/Vercel ports, Scheduled
  Task, competition-arming wiring of `validateArmingCertificate` into
  `runStartup`) starts from the accepted P7.
- **2026-09-01 — P7 launch hardening after pre-live adversarial review.**
  The active broker account is now observed before authority and re-observed
  before every broker mutation; configured identity alone is never accepted as
  binding evidence. The certificate fence clears only the exact newly-created
  `AUTH_FAILURE` halt after every working order is observed canceled and a
  stable flat snapshot is reconciled; the human approval is compare-and-set on
  halt sequence and reason, so it cannot clear a pre-existing or replacement
  halt. Full broker snapshots require two consecutive identical complete reads,
  and all broker/health calls have finite timeouts. The certificate's
  `evidenceDigest` now covers verdict and failures as well as observations, and
  the MCP launch artifact digest binds every importable installed dependency
  byte. We retain the earlier trusted-local-operator decision: this digest
  detects file edits and supports deterministic semantic validation, but is not
  an external signature against an operator who modifies the verifier or
  deliberately regenerates synthetic evidence. Documentation must state that
  boundary and must not claim independent live-run attestation.
- **2026-09-01 — P7 R3 hardening after the launch Go/No-Go cold read.**
  A post-config, pre-runtime broker identity refusal uses a brokerless local
  gateway solely to persist `AUTH_FAILURE` or `ACCOUNT_BINDING_MISMATCH`, send
  the fail ping, and release its holder; it never gains an order port. The
  certificate now binds every acceptance observation to the INTENT's exact
  broker identity, leg sides/ratios, one-lot quantity, and limit kind/price,
  and the fill clause requires the later position quantities to equal that
  exact one-lot fill with no unrelated non-zero position. A sign-only match is
  not reconciliation. The cycle walltime is an aggregate shell deadline:
  phase-boundary heartbeats run in production, gateway appends and mutations
  inherit the absolute deadline, Alpaca requests cap themselves to the time
  remaining, and the transport timeout covers response-body consumption as
  well as headers. The caller regains control at the hard budget; no local
  effect begins past the propagated deadline. Because a remote broker effect
  begun before the boundary cannot be revoked, an answer settling afterward
  is reported as confirmation-unclear and reconciled, never as success. R3's
  red counterexamples and the complete
  repository gate pass with 296 tests; a first otherwise-green gate attempt
  hit a transient Windows `EPERM` during the unchanged atomic dashboard rename
  and the immediate complete rerun passed.
- **2026-09-01 — P7 R4 closes the suppressed-startup halt race.** A startup
  broker-identity/auth refusal is safety-relevant even when another process
  owns a fresh lease. The gateway therefore exposes one narrow monotonic
  interlock: under its existing mutex it may append only `AUTH_FAILURE` or
  `ACCOUNT_BINDING_MISMATCH`, using the current persisted epoch, without a
  broker port, authority acquisition, holder change, or un-halt capability.
  A final persisted-halt read at the broker boundary rejects a stale entry
  after such an interlock lands, while cancel and explicit-close mutations
  remain available for reconciliation. This is not a general third mutation
  class; it is a denial-only safety fuse for the two mandatory startup fences.
- **2026-09-01 — P7 R5 closes the adjacent cold-scan findings.** Certificate
  acceptance and fill are now one identity: the builder prefers a filled
  credit lifecycle, requires its exact client and broker order IDs for the
  one-lot fill, and reconciles signed quantities only on the bound account;
  arming validates the same cross-clause identity. Runtime authority is
  acquired before the first broker read. A fresh rival therefore produces one
  staleness-neutral `SUPPRESSED` witness and exit 0 in the scheduled CLI with
  no account/calendar/position/order call. Temporary `CONFIG_INVALID`
  authority is released in `finally`. Deadline cycles defer their ping plan
  until aggregate work wins the outer race; the concrete adapter refuses
  expired delivery and non-2xx HTTP. Finally, any exceptional certificate exit
  sends a failure signal and repeatedly invokes the ordinary S-G11 flatten
  cycle until broker truth is flat or recovery is explicitly unresolved.
- **2026-09-01 — P7 R6 makes the journal authoritative across halt-projection
  crashes.** `halt.json` remains the snapshot-friendly projection, but every
  gateway read and final risk-increasing broker boundary now folds the valid
  journal's latest `HALT`/human `UNHALT` transition under the gateway mutex and
  repairs a missing, stale, or unreadable projection before continuing. Thus a
  crash after the fsynced journal line can neither bypass a durable halt nor
  strand a durable human un-halt. If the journal contains no halt transition,
  an unreadable projection remains fail-closed.
- **2026-09-01 — P7 R8 closes live-lock theft and late-success reporting.**
  The filesystem mutex now records process and owner token. Age can trigger
  abandoned-lock cleanup only when that process is no longer alive, and final
  removal is token-checked; a long but live broker observation therefore
  cannot be overlapped by a safety halt. A broker result arriving at or after
  the aggregate deadline is classified as broker-side confirmation uncertainty
  rather than success, preserving the reservation and next-cycle reconciliation.
- **2026-09-01 — P7 R10 removes stale-lock recovery and restart identity
  classes.** The file mutex is replaced by a kernel-owned Windows named pipe
  (Linux abstract socket): exclusivity survives arbitrary operation duration,
  waiters do not time out, and the OS releases ownership on process death, so
  no path-level recovery unlink or CAS exists. Certificate attempts derive the
  next global cycle identity from the journal maximum rather than restarting at
  one. All post-launch runtime construction is failure-cleaned: exceptional
  digest or adapter construction stops the verified child and releases only
  the caller's holder.
- **2026-09-01 — P7 R11 closes recovery quiescence and state-path identity.**
  Exceptional certificate recovery crosses the live gateway mutex and proves
  continued writer authority before any flat snapshot can succeed; an order
  request admitted before an aggregate timeout must therefore settle before
  the recovery observes broker truth. `STATE_DIR` is canonicalized with the
  host filesystem before any durable child path or kernel mutex name is
  derived, so Windows extended-path aliases of the same directory cannot open
  independent serialization domains.
- **2026-09-01 — P7 R12 treats lost acknowledgement as a protocol state, not
  a timing delay.** A local mutex drain cannot prove that an aborted HTTP
  request will not appear later at the broker. Exceptional certificate recovery
  now ensures a durable halt (without replacing an existing stronger halt) and refuses `recovered: true` until
  every pre-abort entry identity has broker-terminal evidence; a not-found read
  or `confirmation_unclear` remains unresolved, while the journal's
  `partially_filled` OUTCOME is terminal by construction and its filled portion
  must still vanish from the flat snapshot. Atomic writer-epoch/heartbeat/
  journal checks bracket the stable flat snapshot, so a takeover or human
  halt change during the read also prevents a false proof.
- **2026-09-01 — P7 R13 closes ambient harness inputs and exact recovery
  bracketing.** The
  certificate attempt/recovery bounds are positive code constants covered by
  `runtimeDigest`; ambient `CERTIFICATE_*` variables can no longer disable the
  abort path. Recovery compares the exact terminal HALT journal sequence across
  its flat snapshot, not merely the projected boolean.
- **2026-09-01 — P7 R14 reconstructs the exact MCP child environment.** The pinned MCP SDK's
  implicit Windows environment is neutralized with explicit empty overrides,
  then a `-S` Python bootstrap reconstructs the exact validated environment
  before any verified package import. Secrets are captured in-process and never
  enter argv; exact non-secret literals undo interpreter rewrites such as a
  prefixed `PYTHONPATH`.
- **2026-09-01 — P7 R15 closes final certificate state, shutdown, lifecycle
  selection, and operative truth.** Fence evidence names the exact halt/un-halt journal
  sequences produced by the supervised run. Atomic writer reads bracket the
  final stable broker snapshot and require that exact human un-halt to remain
  the terminal halt transition with no active halt. Verified-child stop and
  holder release are attempted independently, so a transport close failure
  cannot retain writer ownership. Certificate lifecycle ranking and validation
  now share the latest broker-terminal OUTCOME, so a reconciled fill after a
  lost acknowledgement outranks an earlier harness-canceled attempt. README and
  STATE now name the real dev-paper reachability, the owner/O5/P8 boundaries,
  the current verification count, and the same R13–R15 decision sequence.
- **2026-09-01 — P7 R16 closes the certificate end instant and independently
  anchors MCP dependency bytes.** The certificate window ends immediately
  after the stable broker snapshot and before its final atomic writer/journal
  read; every halt through that historical end is therefore observed, while a
  later halt is outside the claim. `dependencySiteSha256` was derived by
  `tools/derive_mcp_dependency_digest.py` from a clean CPython 3.14 Windows
  install of the 69-package production graph read with `git show` from the
  exact official upstream commit, using only SHA-256-authenticated wheels named
  by that pinned `uv.lock`; the tool rejects origin/HEAD/worktree or installed-
  closure drift, independently verifies every downloaded wheel identity/hash,
  requires its signed compatibility tags to match the tracked `win_amd64`
  CPython target, evaluates the supported marker set fail-closed without an
  external marker library, and extracts importable payload itself rather than
  trusting installer output.
  The resulting 3,985 canonical importable files
  byte-matched the deployment site. The tracked digest is
  `05697dac3f1cdf3e3d96d0da6879c4b1ffef96d2b4f345de4278e65c58abc6e4` and
  is enforced before child spawn. Installer metadata is excluded because it is
  not executable content; the installer-created `site/bin` tree is excluded
  from this digest only because pre-spawn cleanup removes it recursively and
  verifies its absence before Python can resolve its scripts as modules. The
  canonical paper origin remains solely in `config/policy.json`; stale
  `ALPACA_*_BASE_URL` examples were removed. P7 auth is OAuth-only and
  fail-closed; the unimplemented API-key fallback decision is superseded.
- **2026-09-01 — P7 R17 uses one canonical terminal OUTCOME for both
  acceptance and fill.** `creditAcceptance.outcomeSeq` is now the sole fill
  source. The fill must be that exact `filled` OUTCOME and must retain the same
  intent, client-order, and broker-order identities. An earlier fill cannot be
  combined with a later fill or harness cancel, even when the client ID is
  reused in the journal. The builder therefore refuses the same contradictions
  that the arming validator checks instead of writing an internally invalid
  PASS artifact.
- **2026-09-01 — P7 R18 makes lifecycle finality part of every flat proof.**
  A successful credit lifecycle cannot hide a sibling risk-increasing INTENT
  whose broker result remains `NOT_AT_BROKER` or `confirmation_unclear`.
  Certificate construction now rejects every such lifecycle in the test
  window, and the supervised driver requires broker-authoritative terminal
  truth for all entries before the fence and final snapshots. Atomic writer
  reads also require the complete terminal journal sequence to remain
  unchanged across each stable broker snapshot, including exceptional
  recovery, so a late lifecycle transition cannot be certified against an
  earlier flat view.
- **2026-09-01 — P7 R19 applies lost-ack blocking inside a batch and bounds
  MCP lifecycle cleanup.** A `confirmation_unclear` submit immediately blocks
  every later risk-increasing plan in the same phase-4 batch; reconciliation
  by that exact client-order ID remains phase 0 work for a later cycle. MCP
  evidence, connect, inventory, tool-call, and stop operations use a fixed
  runtime-covered deadline. Runtime cleanup starts holder release independently
  of child stop and preserves timeout/cleanup errors, so a stalled stdio
  transport cannot retain writer authority indefinitely.
- **2026-09-01 — P7 R20 unifies lost-ack terminality and makes evidence
  deadlines real.** `NOT_AT_BROKER` after an ambiguous submit never maps to a
  released lifecycle: the fold retains `confirmation_unclear`, phase 0 blocks
  entries and re-queries the same client-order ID on every later cycle, and a
  broker order that appears late is adopted and terminally journaled. Only
  broker-terminal truth or a pre-submit `REVALIDATION_VOID` releases risk.
  MCP filesystem scans, hashing, cleanup, and Git reads now yield through
  asynchronous ports with cooperative aggregate deadlines; Git subprocesses
  carry their remaining timeout explicitly. The launcher starts timeout
  measurement before invoking a port and rejects even a synchronously
  misbehaving port that returns only after its bound.
- **2026-09-01 — P7 R21 requires terminal truth after a lost acknowledgement
  and aligns the normative acceptance states.** Matching the exact client-order
  ID proves identity but a still-working broker status does not terminate
  lost-ack uncertainty. `intent`/`confirmation_unclear` therefore remain
  entry-blocking through `MATCHED_WORKING` and are re-queried until a terminal
  fill, rejection, cancel, or expiry is journaled; normally acknowledged
  working orders retain the ordinary fillable-risk behavior. S-ARM-01 now names
  the fast-fill acceptance states already required by the certificate decision.
- **2026-09-01 — P7 R22 makes acknowledgement evidence state- and
  identity-monotonic.** `ACKNOWLEDGED_WORKING` may establish `fillable` only
  directly from a pristine `intent`, or repeat idempotently for the same broker
  order already `fillable`. It cannot follow `confirmation_unclear` or any
  terminal state, cannot name a terminal broker status, and cannot change an
  already bound broker-order ID; violations invalidate lifecycle reconstruction
  and therefore block all new entries.
- **2026-09-01 — P7 R23 closes the complete entry-lifecycle transition
  generator.** Duplicate entry INTENT IDs are invalid instead of resetting
  state. Working, absence, void, and outcome evidence each enforce their source
  state; broker-order identity never changes once known; terminal truth cannot
  be weakened or overwritten. Filled/canceled/rejected evidence also carries a
  status-consistent broker ID, quantity, and price shape. Runtime reconstruction
  rejects a violation, while certificate/recovery terminality independently
  keeps every malformed identity unresolved. Observed fill evidence is
  monotonic too: later working or terminal evidence cannot erase or reduce a
  partial fill, rewrite its price without a new fill, or imply a decreasing
  cumulative fill value. The broker's exact decimal average is retained beside
  its half-away rounded cent display, the pair must agree, and exact cumulative
  deltas classify each new fill increment against the submitted limit. Filled
  risk uses the conservative edge of the cent-rounding interval. Terminal
  remainder resolution must retain the filled quantity.
- **2026-09-02 — P7 R24 binds long certificate operations to writer
  authority.** A full snapshot has one absolute deadline, inherited by every
  stability read and order-history page, below the takeover bound. The human
  fence checkpoint refreshes the holder heartbeat and is aborted if authority
  is lost. Approval is followed by a new writer-bracketed stable-flat proof;
  manual UNHALT then atomically requires the same epoch, holder, AUTH_FAILURE
  HALT, and journal tail. A successor takeover or any intervening journal
  transition therefore preserves the halt instead of applying stale approval.
- **2026-09-02 — P7 R25 owns MCP cleanup before connect begins.** The MCP
  child port returns a spawn-attempt object synchronously: its connect result
  may settle later, but its stop operation is available immediately. The
  launcher therefore closes the attempt before propagating connect timeout or
  failure, so a late child handle cannot become an unowned process during
  runtime-construction failure.
- **2026-09-03 — P7 R26 rejects late cycle results after event-loop
  blocking.** The aggregate cycle wrapper checks its absolute deadline again
  after work resolves. A timer remains the preemptive path for asynchronous
  stalls; the post-check prevents synchronous blocking from returning a late
  success after the timer was unable to run.
- **2026-09-03 — P7 R27 preserves the first sticky halt cause.** Later HALT
  entries remain append-only audit evidence, but projection keeps the existing
  sticky reason. An authority-free startup safety interlock can therefore add
  its observation without rewriting `KILL`, `PROVENANCE_BROKEN`, or another
  terminal sticky cause.
- **2026-09-03 — P7 R28 applies the credential fence to every authenticated
  startup read.** A 401/403 from the exchange calendar now persists and signals
  `AUTH_FAILURE` exactly like rejection of the preceding account-identity read,
  then releases the startup holder. Startup stage names cannot bypass the
  broker-auth safety classification.
- **2026-09-02 — S-CYC-05 linearization point and the manual-mutation rule
  (owner ruling).** The interval between the final fresh broker read of the
  pre-submit revalidation and the broker's acceptance of the submit cannot be
  closed: Alpaca offers no conditional submit (no book revision, no if-match
  on orders; only client-order-ID idempotency). A fake-broker interleaving in
  R28 showed that a manual position landing in exactly that window does not
  void the submit. Options weighed: (A) declare the completion of the final
  fresh read as the linearization point and prohibit manual broker mutations
  during the supervised certificate run and competition operation, except
  under a durable `HALT` with no writer holding authority; (B) keep P7 blocked
  until the broker offers an atomic conditional submit. Ruling: A. Reasons: the
  prohibition already exists for the competition account (2026-08-25, SUB-08
  provenance latch); the window can only be hit by the owner's own action; a
  violation is detected by the next cycle's phase 0 (S-G10-02 `RESIDUE` /
  `HUMAN_ACTION`, halt) instead of passing silently; the agent's own position
  stays defined-risk, only the aggregate caps can be exceeded for one cycle by
  the human's quantity. The 2026-08-25 clause "risk-reducing cleanup remains
  allowed" is narrowed to the halted state so the close side (S-G7 over-close)
  does not carry the same window. The limitation is stated in the submission
  deck as a known broker-API limitation. Should Alpaca ship a conditional
  submit, the declaration becomes an implementation obligation. Regression:
  `tests/cyc-runner.spec.ts` "S-CYC-05 / linearization point".
- **2026-09-02 — P8 runtime wiring lands before the P7 certificate, not
  after.** The certificate's `runtimeDigest` binds every file under `src/`,
  `dist/`, `config/`, `tools/*.mjs|*.py`, and the package/tsconfig files
  (`src/shell/digests.ts`), and arming refuses any digest mismatch. A code
  change after the market-hours run would therefore void the certificate and
  could only be re-earned in a later session. The plan's "P7 then P8" ordering
  is corrected to: P8 code (competition provenance port wiring, the arming
  certificate gate, digest-neutral operator tooling) → owner O5 freeze →
  clean zero gate → P7 certificate → owner-only P8 steps (account, `.env`,
  GitHub, Vercel) → arm. The two wiring gaps were found by a cold P8 readiness
  review and confirmed in code: the composition root never supplied the
  `provenance` lifecycle dependency (a competition BOOTSTRAP would fail closed
  on its first cycle), and `validateArmingCertificate` had no shell caller
  (startup checked file presence only). Digest-neutral surfaces stay editable
  after the certificate: `*.md`, `.env.example`, `.gitignore`, `tools/*.ps1`,
  `submission/`.
- **2026-09-02 — Certificates stay local.** `evidence/` is gitignored: the
  pre-arm certificate carries the dev account identity and broker evidence
  that the public repository does not need; the public proof of the live test
  is the projection, not the raw certificate file.
- **2026-09-02 — The arming certificate gate (`src/shell/arming-gate.ts`).**
  A competition runtime arms only under a certificate whose `runtimeDigest`,
  `policyDigest`, canonical trading origin, typed clauses, evidence digest, and
  PASS verdict all validate through the pure `validateArmingCertificate`.
  Design choices: the profile guard lives inside the gate and the call in the
  composition root is unconditional, so a later edit at the call site cannot
  let a competition runtime skip it, and "the dev profile never reads the
  file" is asserted through an injectable read port; a refusal is journaled as
  `HALT CONFIG_INVALID` with the detail prefixed `ARMING_CERTIFICATE_INVALID`
  rather than as a new closed-set halt reason (the reason sets are consumed by
  the journal schema, the renderer, and the certificate core; the refusal is
  S-CYC-11's "invalid configuration" in substance), and the build stage
  `arming` is added for the caller; cleanup follows the post-launch pattern
  (halt first, then the MCP child and the holder). The gate reads
  `PRE_ARM_CERTIFICATE` from the raw §0 record because `ValidatedStartup`
  carries no certificate field; startup's presence-only check therefore stays,
  and the gate refuses non-string, empty, or whitespace values. Known and
  accepted: the gate is inside its own runtime digest, so every certificate
  produced before it lands refuses to arm — the market-hours run must follow
  this change; a dev-account certificate is by design what arms the
  competition account (account correctness is `verifyActiveAccount`'s job,
  `EXPECTED_ACCOUNT_ID` is identity-class and outside both digests);
  `ANALYST_MODEL` is the one policy-digest input sourced from the environment,
  so it must be identical on the certificate host and in competition
  operation (documented in `.env.example` and the README runbook, not moved
  into `config/policy.json` this close to the freeze). Calibration: six
  mutants of the gate, all caught.
- **2026-09-02 — A virgin paper account is not activity-empty.** A read-only
  probe of the dev paper account (`GET /v2/account/activities`) returned
  exactly one activity on a never-traded account: the opening funding journal
  (`JNLC`, executed, net `100000`). The competition provenance proof treated
  any activity as reset/reuse evidence, so every fresh competition account
  would have latched `PROVENANCE_BROKEN` on its first bootstrap — a class-A
  defect on the competition path that the fake bundle could not show because
  it encoded the spec's assumption rather than broker reality. Rule now: the
  activity ledger may hold nothing but opening funding journals whose
  exact-cent net sum equals `INITIAL_CAPITAL`; fills stay empty; anything else
  is reuse evidence. SPEC S-CYC-09 and CONCEPT §9 are corrected; the recorded
  document is a test fixture. Lesson recorded for the axiom "the artifact under
  test is not the standard": broker-facing proofs need one recorded document
  per endpoint before they gate anything.
- **2026-09-02 — Pre-freeze cleanup rulings.** `docs/cold-read-2026-08-24.md`
  stays: CONCEPT cites its finding numbers in four places, and a glass-box
  repository publishes the design's own failure modes. The broker port
  contracts move out of the fake into `src/shell/broker-ports.ts` so the real
  adapter no longer imports a fake module (pure extraction). The map generator
  skips `.claude` and `tmp`, and `.claude/worktrees/` is ignored, after one
  ephemeral agent worktree leaked into REPO_MAP.md. `dist/` is inside the
  certificate digest but gitignored, so the certificate binds bytes no clone
  reproduces; the operator builds right before the run and never rebuilds
  between the certificate and competition operation. The dev account
  identifier already appears in tracked text and is not treated as a secret;
  `evidence/` stays local for the raw certificate, not for the identifier.
- **2026-09-02 — The Friday deadline entries get a one-shot CLI now, not on
  Friday.** S-G11-03/04 (`DEADLINE_RECONCILIATION`, `TERMINAL`) existed only
  as functions without a runtime caller. Because the certificate digest binds
  `src/`, `deadline-runtime.ts` / `deadline-cli.ts` land before the
  market-hours run. The CLI takes `STATE_DIR` from the validated configuration
  only, acquires writer authority through the gateway like the agent, appends
  nothing when a live writer holds the epoch (no witness line either: a
  one-shot owner action is not a scheduled cycle whose absence needs
  explaining), and refuses a second `TERMINAL` by a pure admission rule over
  the journal. Exit codes: 0 appended, 2 usage, 3 live writer, 4 TERMINAL
  already standing, 1 otherwise.
- **2026-09-02 — The scheduled watchdog composes the real broker.**
  `watchdog-cli.ts` had always passed null broker and market ports, so the
  scheduled watchdog could fence, halt and ping but never flatten an open
  book. `watchdog-runtime.ts` composes the validated configuration, the
  account-bound Alpaca port, the ping port and a close-oriented market window
  (expiries from zero remaining sessions, the full configured strike band)
  from the existing factories, without acquiring writer authority up front
  and without launching the analyst; any configuration or credential problem
  degrades to the previous null-port behaviour with the reason logged, and a
  401/403 escaping the run records the `AUTH_FAILURE` fence. The watchdog
  submits closes only and is deliberately not gated on the arming
  certificate: gating recovery on a certificate would fail open on risk.
  Known residual: a 401/403 the gateway catches during a close submit is
  treated as a lost acknowledgement (reserved and reconciled), not
  classified as a credential fence — bounded, declared.
- **2026-09-02 — R29 blind gate at `4403758`: NO-GO (A=1, B=1, C=14), fixes
  before the certificate run.** A1: the management-close ladder (eviction,
  flatten, residue) planned and submitted against the phase-1 book snapshot,
  refreshing orders but never positions; a resting close that fills during
  the analyst step made the ladder submit a further close against a flat
  account, opening a reversed and partly unbounded exposure (reproduced with
  the fake broker on the routes `deadline` and `expiry`; the mutant
  "disable the eligibility refusal in ladderClose" survived all 388 tests
  while the analogous entry-side mutant is caught). Fix: one fresh book read
  at the head of the management actions, used by every close-planning input;
  no close submits when that read fails. B1: the watchdog composition
  carried `ping: null` into every degraded path, so a takeover under
  degraded composition raised no active alarm. Fix: the ping port is built
  before the first degrade branch. C-class: coverage gaps without a
  demonstrated defect (one-lot INTENT half, deadline inheritance beyond the
  first page, the UNHALT CAS epoch and journal-tail components, the
  recovery-loop flatness gate, presentation CSS untested), the deck naming
  only `HUMAN_ACTION`, the watchdog decision missing here, and the
  certificate CLI exiting 1 on a suppressed rival. Ruling on the last:
  S-G12-01's exit-0 rule is for the scheduled agent process; the certificate
  CLI is an owner-driven one-shot and exits non-zero on suppression so the
  owner learns the run did not happen — declared, not changed. The gate
  reviewer disclosed that a scratch write of its own briefly mutated
  `cycle-runner.ts` inside its isolated worktree and was reverted within a
  minute; its verify ran clean afterwards, the main worktree was never
  touched, and the A1/B1 fix diffs are reviewed hunk by hunk before commit.
- **2026-09-02 — R29 fix set: fresh book for management closes, close
  attempts reconciled in phase 0.** A1 is closed by one fresh book read at
  the head of the management actions that feeds every close-planning input;
  `ladderClose` takes the book as a parameter so the phase-1 snapshot is
  unreachable inside the ladder, a failed refresh submits nothing and raises
  `MANAGEMENT_BOOK_UNREADABLE`, a 401/403 goes through the credential fence.
  The adjacent gap the fix exposed — a resting close that fills, cancels or is
  rejected while the ladder no longer visits it never received an OUTCOME, so
  the journal/account bijection broke silently — is closed in the pure core
  (`closeAttemptsAwaitingOutcome`, `reconcileCloseAttempt`, reusing the entry
  side's terminal mapping) and in phase 0 of the runner, before any management
  or entry action, with S-CYC-04's lost-acknowledgement discipline: unknown,
  failed or unsettled lookups invent nothing, stay reserved, and block
  entries transiently as `CONFIRMATION_UNCLEAR`; `partially_filled` is not
  re-queued because its remainder is the next generation's business. Cost:
  one broker lookup per non-terminal close attempt per cycle. SPEC S-CYC-04
  carries the close-side rule.
- **2026-09-02 — Declared reduced depth after R29 (owner to countersign at
  the freeze).** Not fixed, stated: presentation CSS (`render-styles.ts`) has
  no test of its own beyond the byte-identical golden render (C1); a
  countable funding sum that differs from `INITIAL_CAPITAL` latches the
  provenance halt — ruled as intended, since a second funding is a reset and
  a different opening balance is not the prescribed account (C3, SPEC
  S-CYC-09 amended); the certificate CLI exits 1 and the deadline CLI exits 3
  on a suppressed rival while the scheduled agent exits 0 (C11, SPEC
  S-G12-01 amended); the MCP launch-artifact digest's walk of the full site
  tree is traced as wiring, not confirmed by a test that plants a file deep in
  the tree (C12). The R29 gate also named a structural lesson: the launch
  class taxonomy used for P7 gates had no class for the management/close
  path, where A1 lived; R30 and any later gate carry that class explicitly.
- **2026-09-02 — The competition account exists; an empty activity ledger is
  virgin evidence.** Felix created the dedicated paper account
  `PA376WIK2ATL` (login alias for the hackathon, created
  2026-09-02T09:54:41Z, options level 3, keys bound in `.env` as
  `ALPACA_COMP_*`). A read-only probe through the real adapter minutes later
  showed cash and equity at exactly $100,000 and an activity ledger with no
  entry at all — the opening `JNLC` funding journal the dev account carries is
  posted by the broker later than creation. The proof's "no funding journal
  → incomplete, retry" rule from earlier today would therefore have blocked
  arming until the broker's batch ran. Ruling: a complete, empty ledger with
  cash and equity equal to `INITIAL_CAPITAL` and empty, complete order and
  fill history is virgin evidence; present funding journals must still sum
  exactly. Second instance today of the same lesson: the fake encoded an
  assumption, the live read corrected it. The recorded competition account
  document is a fixture (account number and instants only).
- **2026-09-02 — R30 delta gate at `f2e214d`: A=0, B=2, C=5; the R29 fixes
  hold.** Every named mutant on A1, the close reconciliation, B1, the deadline
  entries, and the coverage closures is caught; the deadline CLI has no order
  path; a partial fill can never over-close (`EXCEEDS_HELD_QUANTITY`). New:
  B1 the runner's "success ping only after a durable append" wiring is
  unmeasured (the mutant `durableAppendLanded: true` survives; paths with no
  durable append and no alarm exist) — closed by tests; B2 the watchdog
  reports `halted: true` regardless of whether its HALT append landed, and
  the operator tooling reads that line as "halted" — closed by reporting the
  append's durability and alarming on an unjournaled halt; C4 the
  environment-unreadable branch of the watchdog composition left the takeover
  without even the local ping recorder the fence uses — closed. Declared:
  C1/C2 the freshness of the close-planning inputs is redundant with the
  eligibility gate on the fresh book and not measured separately, and the
  residue loop still iterates the phase-1 classification (every submission
  passes the fresh eligibility check); C3 after a partial fill of a resting
  close the remainder is deferred one cycle (under-close direction only,
  unreachable under the one-lot rule); C5 the pre-freeze port extraction is
  code motion inside the digest window, behaviour-preserving on reading and
  by the full suite.
- **2026-09-02 — R31 mini-gate on the provenance seam at `fb2772c`: GO,
  A=0, B=1, C=2.** Twenty-four independent probe cases (recorded fixtures,
  funding boundaries at the cent, uncountable classes, malformed amounts,
  three-page pagination, repeating and unpageable cursors with the 200-page
  bound, the empty ledger beside every imperfect clause, the dev profile's
  zero reads) all behaved as S-CYC-09 specifies; five of six mutants caught.
  B1: the suite measured "negative JNLC latches" and "sum must equal the
  capital" only separately, so a mutant classifying a cash-out as funding
  survived when the journals still netted to the capital — closed by one
  conjunction test. C2: the latch on a creation instant before
  `COMPETITION_START` was not licensed by the spec sentence — SPEC now says
  it is (an unfixable ineligibility fact). C1 declared: the MCP verifier test
  "bounds a stalled child connect before inventory can be released" is
  timing-sensitive and failed once in about seven full-suite runs in the
  reviewer's scratch copy; not seen in this session's six verify runs.
