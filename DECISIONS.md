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
- **2026-09-02 — Pre-freeze cleanup rulings.** `docs/COLD-READ-2026-08-24.md`
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
  the freeze).** Not fixed, stated: presentation CSS had no test of its own
  beyond the byte-identical golden render (C1 — superseded the same day by the
  `assets/` decoupling below, which carries its own tests); a
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
- **2026-09-02 — R32 narrow gate at `258d4c1`: GO, A=0, B=1, C=2; declared
  residual of the watchdog takeover.** All four named mutants (watchdog
  `halted` literal, null ping in the environment-unreadable branch,
  `durableAppendLanded: true`, cash-out classified as funding) are caught;
  `npm run verify` passed twice in the reviewer's worktree, the
  timing-sensitive MCP verifier test included. Declared, not patched: when a
  watchdog takeover's HALT append fails transiently, the epoch fence locks out
  only the fenced writer; the next scheduled agent cycle acquires its own
  epoch, finds no standing halt, and may enter until the operator reacts to
  the immediate `HALT_NOT_JOURNALED` fail ping (two to three cycles against
  the alert SLA). Under a persistent journal failure the runner is fail-closed
  by its own rule (no order whose INTENT append did not land). A second
  authority in `halt.json` would contradict the single-authority rule of the
  journal transition (2026-08-25) and be erased by the next projection
  reconciliation, so the remedy is this declaration plus the operator's
  response to the fail ping. Notes: the authority-refused branch of the
  watchdog pings nothing and relies on the passive dead-man SLA; every
  takeover path seeds `WATCHDOG_TAKEOVER`, so the watchdog's own ping
  precondition is fixed by construction rather than measured.
- **2026-09-02 — Presentation lives outside the runtime digest (`assets/`).**
  The S-ARM-01 runtime digest binds what Node executes and what a reviewer
  reads as behaviour: `src/**/*.ts`, `dist/**/*.js`, `config/**/*.json`, the
  tool scripts, the lock files, the tsconfigs. It no longer binds the
  stylesheet bytes: a colour, a grid or a font stack states nothing about
  trading behaviour, yet would void the certificate that authorizes
  competition operation. Presentation assets therefore live in a top-level
  `assets/` directory that the digest enumeration does not match by
  construction, so design work during operation cannot invalidate the
  certificate. Everything that could make the decoupling risky stays bound:
  the HTML structure, every string and anchor in the renderers, the asset
  resolution and inlining logic with its fail-closed rule
  (`dashboard-build.ts`), and the publication decision (`publisher.ts`). The
  renderers take the stylesheet text as a parameter and stay pure; the shell
  resolves `assets/` from `import.meta.url`, never from the working
  directory, normalizes CRLF so a checkout cannot change rendered bytes, and
  inlines the CSS exactly where the `<style>` block stood, so the published
  page remains one self-contained file. A missing or empty asset never
  renders an unstyled page: the render fails, publication reports
  `DASHBOARD_BUILD_FAILED`, and the previously published page stands
  ("publication never blocks trading" holds). Output verified byte-identical
  after normalizing only the two render-time timestamps.
- **2026-09-02 — The C-class residuals of R29–R32 are cleared, not
  declared (owner ruling: technical excellence is a judging criterion).**
  Management ladder: refusals are a report artifact (`managementRefusals`),
  residues are re-classified from the fresh book, the remainder after a
  ladder cancel is `min(fresh exposure, unfilled part)` from the pure
  `remainingCloseExposure`; the `emergencyCloseEligibility` refusal inside
  the ladder is thereby unreachable from tests and stands as
  defence-in-depth against a race between the management read and the
  submit. Watchdog: the authority-refused branch fail-pings on closed
  conditions; the retry after a failed HALT append is pinned (one watchdog
  interval); eligibility and adoption are measured; the `halted` flag needs
  no "already stood" distinction because no consumer parses it and
  `HALT_NOT_JOURNALED` carries the meaning for a human reader. CLIs: exit
  codes are pure tables tested exhaustively by stage. MCP: the
  launch-artifact digest walk is exported and tested to depth three with the
  exact skip set (`__pycache__`, `.pyc`). Tests: the stalled-connect verifier
  test runs on a virtual clock (30/30), the remaining 5 ms-budget siblings
  get an injectable timers port. Presentation: `assets/` outside the digest
  with its own tests. A newly appeared foreign contract is still journaled as
  `HUMAN_ACTION` only by the next phase 1 (the ladder skips it by design).
- **2026-09-02 — R33 freeze gate at `c36f6f1`: NO-GO (A=0, B=1, C=3); the
  stylesheet outside the digest gets a content-hiding audit.** The blind
  reviewer executed every named mutant (all ten caught), re-ran six
  regression counter-examples green, ran `npm run verify` twice (39/473,
  exit 0) and reviewed the digest-set diff `258d4c1..HEAD` file by file. B1:
  appending `.gate--veto,.stamp--veto,.discrepancies,.result--no_trade
  {display:none}` to `assets/dashboard.css` hid every veto, no-trade result
  and reconciliation discrepancy on the published page while `runtimeDigest`,
  the certificate, the arming gate and all tests stayed satisfied — the 12:40
  decoupling ("everything that could make the decoupling risky stays bound")
  had removed a safety property and replaced it with nothing; anchors:
  SUBMISSION-SPEC's anti-criterion "hides unfavorable decisions", SPEC S-J-07
  "content may not lie". Options weighed: (1) a pure textual audit of the
  stylesheet in both renderers; (2) a separate, non-voiding digest of
  `assets/**` reported by the publisher (detects, does not prevent); (3) put
  the stylesheet back into the runtime digest (reverts the 12:40 ruling:
  design work during operation would void the certificate again); (4)
  declare. Ruling (PM, reversible, on the branch): option 1, because it
  prevents rather than detects, keeps the 12:40 property, and is the only
  option that clears rather than declares — `src/shell/presentation-guard.ts`
  (`6df70a0`), run by `renderDashboard` and `renderDecisionView` before
  rendering; a refused stylesheet is a failed build (`DASHBOARD_BUILD_FAILED`)
  and the previous page stands. The rule set is enumerated in SPEC S-J-07
  and the module header; the audit works on value tokens (so `var()`
  fallbacks, `min()`/`clamp()`/`calc()` arguments, `!important`, case,
  whitespace and custom-property definitions cannot smuggle a refused value)
  and refuses any backslash, since a CSS escape can spell `none`.
  `assets/dashboard.css` drops the page-level `overflow-x:hidden` on `body`
  (the one declaration the rule refuses; tables keep `overflow-x:auto`); the
  decision view renders byte-identical, the dashboard differs by that one
  property. **Declared residual of the audit, stated as such:** text in the
  ground colour, near-zero sizes, off-canvas placement through positive
  spacing, a zero computed by `calc()` subtraction on a width, and glyph-less
  font stacks are not textually decidable; they remain the reviewer's eyes on
  the golden render, and option 2 stays available if that residual is ever
  judged too wide. The three C findings were cleared, not declared: both
  `DASHBOARD_BUILD_FAILED` branches are measured and the module-relative
  `assets/` test now fails under a cwd-based implementation (`04df95a`); the
  `HEALTHCHECK_PING_URL` wiring is measured against a local HTTP listener in
  the watchdog root, both deadline pings and two of the three agent-runtime
  sites (`50ba4d1`) — the third site, the live cycle's own ping, needs a
  real analyst child and stays covered by the P7 market-hours run itself.
  Delta gate R34 on the fix commits decides the freeze.
- **2026-09-02 — R34 delta gate at `f18a485`: NO-GO (A=0, B=3, C=4); the
  presentation assets go back into the runtime digest (owner ruling, option
  1).** The blind reviewer confirmed the three cleared C findings of R33 and
  refuted the B1 countermeasure: the textual stylesheet audit caught all 36
  named variants but not native CSS nesting, `@container`, the `font:0/0`
  shorthand, `00px`/`0e0` zeros, `0e0` alpha, or a `{` inside a selector
  string that desynchronizes the brace walker — the reviewer named the
  generator (a string-blind, nesting-blind text scanner over closed
  enumerations does not converge against a living standard). Two more B:
  the stylesheet was inlined unescaped, so `</style><script>` broke out of
  the style block and could delete or invent page content; and the new tests
  renamed the committed `assets/dashboard.css` in place while three parallel
  spec files read it, making `npm run verify` fail one run in ten and
  leaving a poisoned committed stylesheet if a run died mid-probe. Options
  put to the owner: (1) enumerate `assets/**` in the runtime digest — a
  change voids the certificate like a code change, complete by construction,
  costs the freedom to restyle during operation; (2) a separate non-voiding
  `assetsDigest` reported by the publisher — detects, does not prevent; (3)
  an audit over a parsed CSS tree — still a list over a living standard, and
  the most expensive with the qualification window closing. **Owner ruling
  16:20 CEST: option 1**, with the stated caveat that the owner had not yet
  seen the rendered dashboard and it is what the judges see. Consequence
  drawn immediately: the rendered dashboard and decision view from the
  freeze candidate were put in front of the owner before the freeze, and the
  README runbook now says "look before the certificate, never restyle
  after". `src/shell/digests.ts` enumerates every file under `assets/`;
  `tests/p9-presentation-assets.spec.ts` asserts the enumeration equals the
  directory listing and that one appended byte changes the digest material.
  The 12:40 "Presentation lives outside the runtime digest" entry is
  superseded on its digest clause; the `assets/` layout, the module-relative
  resolution, the CRLF normalization, the inlining, and the fail-closed
  reading all stand. The textual audit stays as defence in depth with its
  incompleteness declared (SPEC S-J-07); the `</style>` breakout is refused
  by the audit (`<` has no use in CSS) and asserted again in both renderers;
  the publish dependencies take an injectable `presentationAssetsDir` so no
  test touches the committed assets. The `runtimeDigest` of every commit
  before this one differs from the freeze candidate's; no certificate
  existed, so nothing is voided.
- **2026-09-02 — R35 delta gate at `d693077`: NO-GO (A=0, B=2, C=4); the
  digest binding holds, two measurement gaps closed, the dashboard gets a
  reading guide.** The blind reviewer confirmed the owner's option-1 gate
  end to end: one appended byte, an added file, a rename and a nested file
  under `assets/` each change `runtimeDigest`, and a certificate computed
  before such a change is refused at `evaluateArmingGate` with
  `runtimeDigest mismatch`; the rendered pages are byte-identical to
  `f18a485` except the render timestamps; every declared-uncaught audit
  construct was executed and each of them changes the digest. B1: the
  renderers' `</` assertion had no test of its own (both renderer tests
  matched a refusal the audit already produces), and that assertion is the
  only layer for a `</style>` breakout hidden inside a CSS comment or behind
  a comment opener inside a selector string — fixed by two tests that first
  prove the audit returns `[]` and then require the renderers' own
  `style-block breakout` refusal (mutant "drop both assertions" now fails
  2). B2: one test still wrote a probe file into the committed `assets/`,
  now digest material — the probe moved to a scratch directory through the
  injectable, and a test pins the directory listing to exactly the two
  stylesheets. C1: the walk's skip list (`node_modules`, `.git`, `.tmp`,
  `artifacts`) no longer applies under `assets/` (tested with all four
  names). C2: files under the digest are hashed LF-normalized only for text
  extensions and by raw bytes otherwise, so a binary asset is byte-bound
  (tested with two byte-different, UTF-8-equal files). C3: the golden
  journal is journal evidence outside the digest by design (its
  content-addressed revision is printed on every page); the revision
  `sha256:343a65ef13ad5f05` is now pinned in the golden-path test so an edit
  to the demo data is visible. C4: SPEC S-J-07's declared residual names the
  string-hidden comment opener and the comment-hidden breakout. Separately,
  the owner reviewed the rendered dashboard before the freeze (the caveat
  from the option-1 ruling): gate tooltips, a lifecycle identifier running
  off-screen, and "hard to understand what the page wants to show" —
  closed by `29cf8d6` (a `#how-to-read` section, one lead sentence per
  section, `title` tooltips for G1–G8 from a pure constant table,
  `overflow-wrap:anywhere` and `min-width:0` on the flex headers and table
  cells; the audit still returns `[]`). Narrow gate R36 covers the R35 fixes
  and the presentation commit together.
- **2026-09-02 — R36 delta gate at `b5a4eec`/`3453287`: NO-GO (A=0, B=2,
  C=4); the six R35 fixes hold, two sentences on the judge-facing page were
  untrue.** Part A: every R35 closure held at its counter-example, its
  adjacent variants and its named mutant (eleven breakout payloads against
  the renderers' `</` assertion, an fs-mutator preload proving no test
  writes under `assets/`, the skip-list and raw-byte digest claims on the
  real layout, the pinned golden revision). Part B, the owner-requested
  reading guide (`29cf8d6`): B-1 the how-to-read section said the freshness
  stamp is relative to the journal's last recorded entry, while
  `assessFreshness` is fed the newest entry at or before the page's evidence
  cutoff (the presentation page itself shows two entries rejected as newer
  than the cutoff); B-2 the history lead said "earlier journal revisions"
  while every pin carries the same revision at earlier cutoffs. Both
  sentences rewritten to say what the code does; C-1 the source lead said
  "links" where the page names code and links only the repository —
  rewritten; C-2 the `assets/` listing pin is now recursive; C-3
  `min-width:0` sits outside the audit's zero-length set and is used by the
  flex-header wrap fix — declared not exploitable, since `overflow` stays
  visible and `overflow:hidden` is refused; C-4 a lone `<` inside a CSS
  comment passes both layers and is inert, since only `</` closes the style
  element — SPEC S-J-07 now says so instead of reading as absolute. The
  gate tooltips were all found true against SPEC G1–G8, the renderer pure,
  the stylesheets audit-clean, escaping proven with a poisoned gate record.
  The follow-up `3453287` (rationale wrap) was reviewed as
  behaviour-preserving apart from the stylesheet bytes. A narrow R37 on the
  prose corrections decides the freeze.
- **2026-09-02 — R37 narrow gate at `c886776`: GO (A=0, B=0, C=4); the
  P7 freeze.** Every sentence added to the judge-facing dashboard since
  `d693077` was quoted and verified against the code and the executed
  golden render (the presentation route shows the freshness stamp at seq 8
  / 14:01 with two entries rejected as newer than its 14:01 cutoff, while
  the live route shows seq 10 / 14:31 — the corrected sentence says exactly
  that; the one history pin carries the page's own revision at the earlier
  cutoff); the eight gate tooltips are true against SPEC G1–G8; the
  renderer is pure and deterministic (byte-identical double render, only
  the two render timestamps move); both stylesheets audit `[]`, the one new
  colour was checked numerically for contrast (5.42:1); nothing under
  `src/core/`, the cycle runner, the gateway, the certificate driver, the
  arming gate, `config/` or `tools/` changed since `d693077`; the recursive
  `assets/` pin fails on a planted nested file; `npm run verify` exit 0
  twice (40/547). **Declared, not cleared, because the freeze must happen
  inside today's market session (owner go 15:40 CEST "once a gate returns
  A=0/B=0"):** C-1 the corrected sentences and the tooltip texts are pinned
  by no test (mutants restoring the untrue wording survive) — a test-only
  change outside the digest, to be added after the certificate without
  voiding it; C-2 the tooltip lookup indexes an object literal, so a
  prototype-key gate id throws instead of rendering without a tooltip —
  fail-closed into `DASHBOARD_BUILD_FAILED`, unreachable from the decision
  core's literal ids and the journal's INTENT validator, a one-line
  `Object.hasOwn` for the next digest-changing window; C-3 (pre-existing)
  the history pin's href is site-root-relative and resolves wrongly from a
  nested route, and the percent-encoded route directory depends on the
  host not decoding paths — both to be checked in the SUB-09 preflight on
  the real host, the golden path runs from the site root; C-4 three lead
  sentences are slightly wider or narrower than their sections ("and
  nothing else" mirrors S-J-07's own phrasing; "the broker reports" also
  covers journal-internal discrepancy codes; "earlier" holds against the
  live page). **Owner freeze and countersignature.** Felix ruled at 15:40
  CEST that his go for the supervised certificate run stands once a gate
  returns A=0/B=0; that go is read, and recorded here, as the O5 freeze of
  `config/policy.json` as committed (unchanged since `9777c05`) and as the
  countersignature of the declared reduced depth entries of this day. He
  reviewed the rendered dashboard three times before the freeze (16:25,
  16:35, 17:00) and accepted the stylesheet. Tags `p7-freeze` and
  `pre-kickoff-baseline` (README runbook step 3) mark the freeze commit;
  its `runtimeDigest` equals that of `c886776`, since documentation is
  outside the digest. The competition account `PA376WIK2ATL` was virgin at
  the 15:39 probe. The calendar: qualification window ends today 22:00
  CEST; the certificate run starts from the owner's terminal now.
- **2026-09-02 — The first dev certificate run failed on the broker's
  128-character `client_order_id` limit; the structure identity becomes a
  digest.** Run one (17:36 CEST, epoch 7, freeze `673d217`) reached the
  broker with a defined-risk SPY credit vertical every three minutes and got
  the same synchronous rejection each time: `client_order_id must be <= 128
  characters`. The entry id hex-encoded every contract id (four characters
  per character, 177 in total) — a charset precaution that no fake, no
  gate and no SPEC line had bounded, and the third instance today of the
  lesson "the fake encoded an assumption, the live read corrected it".
  Ruling (PM, in the owner's "fix it, regenerate, restart" of 17:50):
  `entryClientOrderId` keeps the S-G7-01 inputs and the prefix
  `entry:<tradingDay>:<cycleIndex>:` and carries the order-independent
  structure identity as the first 24 hex digits of its SHA-256 (96 bits; the
  legs themselves are on the INTENT, nothing ever decoded the id). Every
  derived id — exposure lifecycle, close lifecycle, close attempt at any
  generation — stays below `MAX_CLIENT_ORDER_ID_LENGTH = 128` for a
  four-leg structure on a five-letter ticker at cycle 999 999. The fake
  broker refuses an over-long id synchronously with Alpaca's message, so the
  suite now sees what the live run saw: with the limit in the fake and the
  old scheme, 27 runner and ladder tests fail; with the new scheme all pass.
  The live run's journal (seq 3–24, epoch 7) records the rejections as
  OUTCOME entries with the broker reason; the dev account stayed flat
  because nothing was accepted. Consequence for the calendar: the fix
  changes `src/core/`, so a delta gate (R38) and a new freeze tag precede
  certificate run two in the same session.
  The golden journal (`fixtures/golden-journal.jsonl`) embeds entry and
  close ids, so it was re-recorded by its own deterministic test
  (`GBT_UPDATE_GOLDEN=1`); its content revision moves from
  `sha256:343a65ef13ad5f05` to `sha256:0deeb1f42e01e19b` and the R35 C3 pin
  follows it — the demo data changes only in the id strings, every figure
  and verdict stays.
- **2026-09-02 — R38 delta gate at `ce68abd`: GO (A=0, B=0, C=4); freeze
  two for certificate run two.** The blind reviewer showed the length bound
  to be structural: every derived id depends only on the trading day and
  the decimal widths of cycle index and generation, never on contract ids,
  leg count or ratios — eight legs with 64-character contract ids, a
  1000-character contract id, and both counters at `MAX_SAFE_INTEGER` top
  out at 91 characters. Both named mutants caught (hex encoding restored →
  47 tests across 12 files red; fake limit dropped → 1 red); four
  calibration mutants of the derivation caught, one survived (C1). The
  digest was cross-checked against `node:crypto`; the G7 duplicate veto
  still fires (the golden journal's declared condor is vetoed for sharing
  the vertical's id); S-G7-02 adoption is id-agnostic and the live message
  correctly fell through to the generic rejection rather than the duplicate
  branch. Old-format ids parse, validate, project and render byte-identically
  apart from their own bytes; a rejected old-format OUTCOME in the window is
  FAIL, an accepted-then-filled new-format lifecycle is PASS. The golden
  journal differs from its predecessor only in the substituted id string
  (proven byte-wise); every rendered figure and verdict is unchanged.
  Cleared before the freeze, digest-neutral: C1 the constant's value 128 is
  pinned by a test (a mutant to 256 had survived); C2 the pre-fix id length
  is the measured 177, not "~190", in SPEC, DECISIONS and the test comment
  (the module comment keeps the old figure until the next digest-changing
  window). Declared: C3 the raw contract id now sits next to the identity's
  own `.` and `|` delimiters, so a contract id containing those characters
  could collide with a different structure — unreachable, since G8 admits
  only contracts from the broker's own chain fetch and OCC symbology is
  alphanumeric, and fail-closed if reached (a G7 veto of the second
  candidate; the id is never decoded); C4 a close derived from an accepted
  old-format exposure id would exceed the limit — premise checked: the dev
  journal holds seven OUTCOME entries, all rejections, zero accepted or
  filled lifecycles (run one), and the competition account is virgin, so no
  such lifecycle exists. Correction of the record: run one made seven entry
  attempts (cycles 3–9), not eight. Tags `p7-freeze-2` and
  `pre-kickoff-baseline-2` mark this freeze; the owner's O5 freeze and go
  of 15:40/17:50 CEST stand unchanged.
- **2026-09-02 — P7 acceptance event: certificate run two PASSED on the dev
  account (freeze two, `f464a66`).** Window 16:16:51Z–16:20:48Z, epoch 8.
  The first entry (cycle 10, SPY 762/759 put credit vertical, one lot,
  credit limit 57 ¢, reserved max loss $243, id
  `entry:2026-09-02:10:e250e300e3a04c21bb604100`, 44 characters) was
  accepted and filled by the broker at 63 ¢ (`b01f5a42…`, OUTCOME seq 30),
  reconciled through the snapshot (seq 31); the flatten phase submitted the
  deadline close `…:g0` at a 65 ¢ debit (INTENT seq 33) and the broker
  filled it inside the flatten interval; the credential-fence drill against
  the real adapter with an invalid secret observed HTTP 401 on the close
  order lookup in phase 0, halted (`AUTH_FAILURE`, seq 34), skipped (seq
  35), found no working order, and the owner cleared the halt at the human
  checkpoint (UNHALT seq 36, operator felix); the final snapshot read the
  bound account `PA349COOGKZ1` stably flat twice: cash and equity
  $99,997.90 (the round trip cost $2.10), zero positions, zero non-terminal
  orders, one complete order page. Certificate
  `evidence/pre-arm/2026-09-02T16-20-48-944Z.json`: `verdict: PASS`, no
  failures, `runtimeDigest ac8a6e3e…`, `policyDigest f8fa85c7…`, MCP
  inventory accepted. Observation, not a defect of the certificate: the
  close lifecycle's OUTCOME is not yet journaled — the fence cycle's phase
  0 hit the 401 before it could observe the fill, and the driver ends with
  the final snapshot rather than a reconciliation cycle; S-J-09 A5 covers
  it (the next phase 0 on this STATE_DIR journals the filled close), and
  the certificate's evidence rests on the entry lifecycle and the two
  consistent flat reads. Backlog (C): let the driver run one reconciliation
  cycle after the un-halt before the final snapshot so the dev journal
  closes cleanly. Run one (FAIL on the id length) stands archived beside it
  in the verification store. Per the owner's 12:40 ruling the PASS is the
  acceptance event: P7 merges `--no-ff` into `main` next, then the owner's
  P8 steps from the README runbook with no `src/`, `assets/`, `config/` or
  `dist/` change.
- **2026-09-02 — The competition bootstrap needed an operator seed: the
  composition root cannot reach the virgin path on its own (live finding
  four; digest-neutral remedy).** The first hand-run competition cycle on a
  fresh, empty `STATE_DIR` did not bootstrap: `buildRuntime` acquires
  authority with virginity `unknown` ("virginity cannot be learned before
  authority without violating S-G12-01"), and `planEpochAcquisition` seeds
  an absent store silently only for `virgin` AND an empty journal — every
  other absence is a reset, so the run journaled `GAP` + `HALT
  EPOCH_STORE_RESET` and the following cycle vetoed entries under the halt
  flag; no BOOTSTRAP, no provenance proof, and a journal that is no longer
  empty. Every test that exercises the bootstrap passes `"virgin"` to the
  gateway directly; the composition root's path through a fresh directory
  was measured by nobody — the README's step 10 described a path that did
  not exist. Remedy without touching the digest (the certificate stands):
  the P2 seed obligation. A one-time script outside the repository
  (`seed-virgin-epoch.mjs`, archived in the verification store) refuses any
  non-empty directory, acquires epoch 1 on a fresh `STATE_DIR` with the
  owner's attestation `virgin`, releases the holder, and leaves
  `epoch.json` with `seedPending: true` and no journal — the gateway
  refuses every broker mutation until a `BOOTSTRAP` with `epochSeeded`
  lands (`SEED_NOT_JOURNALED`). The agent then takes over that epoch
  (`INCREMENT` inheriting `seedPending`, the G2-F1 rule), the runner sees an
  empty journal and a virgin book, runs the S-CYC-09 provenance proof
  against the real account, and appends the BOOTSTRAP as seq 1. Executed
  18:42 CEST on `competition-2`: epoch 2, `epochSeeded: true`,
  `PA376WIK2ATL` at exactly $100,000, zero positions, seed cleared. The
  owner's attestation adds nothing the runner does not re-prove; it only
  unlocks the path. The abandoned first directory (`competition`, GAP/HALT/
  one CYCLE, no order) stays as evidence. Backlog (B for the next
  digest-changing window): let the composition root plan `SEED_BOOTSTRAP`
  for an absent store with an empty journal and virginity `unknown`, since
  the runner's foreign-book gap and provenance proof already fail closed
  before any BOOTSTRAP, and add the missing test through `buildRuntime`.
- **2026-09-02 — Live finding five: the analyst was never told the one-lot
  bound of the qualification window.** Competition cycle 2 (18:47 CEST):
  the analyst proposed a QQQ long call that passed all eight gates with a
  reserved max loss of $85 and was then vetoed `QUALIFICATION_ONE_LOT`
  ("quantity 5 exceeds the one-lot bound"). The brief the prompt carries
  (`qualificationBrief`) stated `active`, `maxLossCents` and `windowEndMs`
  only, while the policy line in the same prompt said "max quantity 5"; a
  one-lot proposal could only happen by chance, and the qualification
  window ends 22:00 CEST today with `FLATTEN_DATE` tomorrow — today is the
  competition account's only entry day. Fix: the brief gains
  `quantityBound: 1` while active (`null` otherwise) and the prompt line
  spells the rule out (one live lifecycle, exactly one lot, at or below the
  cap, anything else vetoed after the gates). Core and prompt only; gates,
  vetoes and the executor are untouched — the analyst still proposes, the
  core still decides. Consequence: `src/core/` and `src/shell/` change, the
  P7 certificate of freeze two is void for this build; the scheduled tasks
  keep running the frozen build meanwhile (a one-lot proposal may still
  land by chance), a narrow gate (R39) and a third dev certificate run
  decide whether the fixed build replaces it before the window closes.
  Observed on the side: `tests/p7-launch-hardening.spec.ts` "does not
  return a late snapshot when synchronous broker work blocks the real wall
  clock" failed once under CPU contention (scheduled cycles running) and
  passed three times alone and in the repeated full verify — a
  timing-sensitive test for the backlog, same class as the MCP stall tests
  ported to a timers port this morning.
- **2026-09-02 — Live finding six: every journaled close fill made the
  certificate driver refuse its fence drill; the entry-lifecycle resolver
  now ignores close attempts.** Certificate run three (19:43 CEST, on the
  branch head with the one-lot fix but — a PM sequencing slip — a `dist/`
  still built from freeze two) entered and filled a SPY 765/764 put credit
  vertical, closed it inside the flatten interval, and then aborted:
  "refusing fence drill: unresolved entry lifecycle(s):
  close:exposure:entry:2026-09-02:10:…:g0" — run two's close, whose OUTCOME
  the 19:30 scheduled dev cycle had journaled in the meantime. Root cause in
  `unresolvedEntryLifecycleIds` (`src/core/execution.ts`): the resolver seeds
  states from entry INTENTs only, then treats every OUTCOME or reconciliation
  item for an id it has not seen as an unknown, invalid entry — and a close
  attempt's OUTCOME is exactly such an id. Run two passed only because its
  close fill was journaled after its certificate. The same resolver runs
  inside `buildCertificate` over the window journal, so a run whose close
  fill lands inside its window would have failed the certificate. The cycle
  runner does not use it: competition trading was never affected. Fix: close
  attempt ids (INTENT `action: "close"`) are collected first and their
  OUTCOME and reconciliation lines are skipped — they belong to the S-G7
  close fold; an OUTCOME whose id no INTENT owns stays invalid (foreign
  evidence is never adopted). Red-first on the golden journal, which carries
  the exact shape: the pre-fix build returns the close id, the fix returns
  `[]`; two adjacent cases pinned. The abort left the dev journal under a
  `MANUAL` halt with the account flat ($99,997.80, two round trips today);
  the driver's recovery loop kept cycling because the same resolver kept
  reporting the two closes, and ran to its 20-attempt bound. Operational
  consequences the same evening: the competition account was re-armed on
  the freeze-two build (sources restored to `f464a66` on the working tree,
  `dist/` untouched, the 19:15 `CONFIG_INVALID` halt — caused by the PM's
  cherry-pick of the one-lot fix before the scheduled tasks were disabled —
  cleared by manual un-halt, seq 5), while the one-lot fix and this fix
  await a gate and certificate run four.
- **2026-09-02 — First competition fill on the freeze-two build; no swap
  tonight.** After the competition account was re-armed on the freeze-two
  build (20:03 CEST, epoch 6, a GAP cycle re-deriving state after 62
  minutes without a primary entry), cycle 5 at 20:05 (epoch 7) proposed a
  SPY 762/757 put credit vertical expiring 2026-09-08 at quantity one — by
  the analyst's own choice, the brief still lacked the one-lot rule — which
  passed all eight gates with a reserved max loss of $395 under the $500
  qualification cap, was submitted at a 105 ¢ credit limit and filled by the
  broker at 106 ¢ (order `28f7a3b9…`, `entry:2026-09-02:5:90daa0a3…`,
  INTENT seq 8, OUTCOME seq 9); a QQQ long call in the same batch was
  vetoed `QUALIFICATION_ONE_LIVE`. The qualification window's purpose is
  met from inside the gated build. Ruling (PM, with the owner's standing
  "fix, regenerate, restart" now moot): the two gated fixes on the branch
  (`c7c7174` one-lot brief, `9b2e155` resolver, R39 GO and R40 pending) are
  NOT swapped in tonight — a rebuild would void the certificate while a
  position is open, and neither fix touches the cycle runner that manages
  the position (kill predicate, tomorrow's `FLATTEN_DATE` regime). The
  running build is freeze two: `dist/` built from `f464a66`, and the two
  source files of the one-lot fix restored to their `f464a66` content on the
  working tree (staged, uncommitted), so `runtimeDigest` equals the
  certificate's; the branch head is ahead of the running build and says so
  here. The scheduled tasks are enabled again (15-minute cycles until 22:00
  CEST, watchdog every 5 minutes). Certificate run three's abort left the
  dev journal under a `MANUAL` halt with the account flat; it stays until
  the next dev certificate run, after the resolver fix, clears it by manual
  un-halt.
- **2026-09-02 — R40 narrow gate at `9b2e155` (worktree `gbt-fix`): GO
  (A=0, B=0, C=2); the resolver fix and the one-lot brief are gated and
  parked.** The reviewer reproduced the live abort at HEAD~1 on the golden
  journal and on `buildCertificate` (failure text "risk-increasing entry
  lifecycle(s) lack broker-authoritative terminal truth: close:…:g0"), both
  green at HEAD; foreign OUTCOMEs stay refused, a close INTENT without an
  OUTCOME never enters the entry states, an id shared by an entry and a
  close INTENT fails closed; three named mutants caught, the
  reconciliation-item skip is unreachable defensive code (C-1); the fold
  functions are byte-identical; the five driver call sites read the full
  journal and now terminate, the cycle runner, watchdog and deadline
  runtimes do not import the resolver; `npm run verify` twice 42/555. C-2
  worth remembering for certificate run four: `buildCertificate` slices the
  journal to the window, so a close INTENT before the window with its
  OUTCOME inside still FAILs (fail-closed) — disable the scheduled dev
  tasks for the duration of a certificate run. Status: `9b2e155` sits in
  the worktree on top of `8aec1fc`; the branch head carries only the
  one-lot fix (`c7c7174`); both are applied after the competition, with
  certificate run four, since a rebuild tonight would void the certificate
  under an open position.
- **2026-09-02 — Digest-neutral publication path for the judge-facing
  dashboard over the live competition journal (SUB-02, SUB-09, SUB-11; R35
  C4, R37 C-3).** The frozen build (freeze two, `f464a66`) has no production
  caller for `runPublish` and no git or Vercel port, and every byte under
  `src/`, `dist/`, `config/`, `assets/` and `tools/*.mjs|*.py` is bound by
  the running certificate, so the gap had to be closed from outside the
  digest while the agent operates. Landed on the branch, all outside
  `enumerateRuntimeFiles` (measured: the digest lists 138 files, none under
  `submission/`, `tools/*.ps1` or `tests/`): `submission/publish/render-site.mjs`
  loads the BUILT modules under `dist/` (never `src/`), reads a COPY of the
  journal (a journal beside a live `STATE_DIR` marker is refused), takes the
  projection expectations from `config/policy.json` and the submitted
  account id from the caller, and renders the page set through the frozen
  `sitePagesFor` + `buildSiteAtomically`; `tools/publish-dashboard.ps1` is
  the owner wrapper (never builds, never reads `.env`, refuses an output
  directory inside the checkout); `tools/probe-dashboard.ps1` is the SUB-11
  anonymous probe by hand — the `verifyProbe` meta contract of
  `src/core/publish.ts` re-stated in PowerShell over the manifest the render
  writes, with a receipt file beside it; deployment and promotion stay
  manual (`vercel deploy --prod --skip-domain`, probe, `vercel promote`,
  probe again; README "Publish the judge-facing dashboard"). **R37 C-3
  ruling:** the renderer's history pin is site-root-relative (wrong from a
  nested route) and its route directory is percent-encoded
  (`sha256%3A<hex>`, a literal `%` on disk because `:` is not a legal
  Windows file name), and whether a host decodes request paths before
  matching files could not be settled from the Vercel documentation. Rather
  than depend on host semantics (a `vercel.json` rewrite would mask a
  broken href and remain unverifiable locally), the render writes two
  trees: `site/` is the renderer's output byte-for-byte with the
  immutable-route carry-forward intact, and `deploy/` is derived from it on
  every run — each segment under `revisions/` percent-decoded and re-spelled
  in `[A-Za-z0-9._-]` (`sha256-<hex>`), the pin `href` on every page
  rewritten to the root-absolute form of that route, everything else
  identical (`tests/publish-dashboard.spec.ts` pins the equality, the
  byte-stability of a pinned route across re-renders, the meta contract per
  route, and the refusals). The probe checks the nested route's pin and
  that the percent-encoded spelling is NOT served; exercised against a
  decoding static host on the competition journal copy (29 checks PASS on
  `deploy/`, the expected FAILs on the raw `site/`). Declared: the
  published page differs from the renderer's page in that one `href`; the
  route name a video or one-pager cites is the safe spelling; no journal
  branch is pushed by this path (the page's revision is the journal copy's
  content hash, the value the fake git port would have produced); the
  Vercel project, Deployment Protection off, and every promotion are owner
  steps. `eslint.config.mjs` (outside the digest) ignores `**/*.d.mts` so the
  hand-written type surface of the JavaScript module can sit beside it.
- **2026-09-02 — The judge dashboard is live at
  `https://glass-box-trading.vercel.app` (SUB-02 first working version, on
  the real competition journal).** Owner steps 21:05–21:20 CEST: Vercel
  team `glass-box-trading`, project `glass-box-trading`, CLI-linked from the
  deploy directory (no Git integration, so nothing builds on push), first
  candidate `glass-box-trading-fo9aanlix-glass-box-trading.vercel.app`
  probed anonymously (15 checks PASS: HTTP 200 on every route, exact
  `glass-box-*` meta, no relative `revisions/` href), promoted, the stable
  alias probed again (PASS). Measured on the real host afterwards: the
  candidate URL answered without an auth wall (Deployment Protection is
  not blocking it), `.env.local`, `.vercel/project.json` and `vercel.json`
  are not served (404), the renderer's percent-encoded route spelling
  returns 404 — which confirms that the host decodes request paths and the
  R37 C-3 host-safe spelling was necessary, not cautious — and a directory
  route without trailing slash redirects 308 to the slash form. Journal
  revision on the page `sha256:c1c8e14ea4035034` (25 entries, last seq 25,
  latest cutoff 19:00:51Z); no presentation pin yet, so the nested-route
  pin check of the probe has not executed on the real host — it runs with
  the first `-PresentationCutoff` publish after Thursday's close. Note for
  the re-publish: `vercel link` wrote a `VERCEL_OIDC_TOKEN` into
  `.env.local` beside the deploy tree; the render drops that file on the
  next run (only `.vercel/` is carried forward) and the CLI never uploads
  it.
- **2026-09-02 — Competition day one closed: six filled structures, equity
  $100,092.15, every order through the gates.** Between 20:05 and 22:00 CEST
  the freeze-two build ran twelve scheduled cycles on `PA376WIK2ATL`. Filled
  (all one structure per INTENT, all defined-risk, all after the eight gates
  and the pre-submit revalidation): SPY 762/757 put credit vertical ×1 (exp
  2026-09-08, 106 ¢), SPY iron condor 768/769C + 762/761P ×3 (exp 09-04,
  63 ¢), SPY 760/755 put credit vertical ×2 (exp 09-08, 89 ¢), QQQ 712 long
  call ×4 (exp 09-08, debit 3.39), SPY 762/761 put credit vertical ×3 (exp
  09-04, 24 ¢), SPY 762/760 put credit vertical ×3 (exp 09-04, 47 ¢, filled
  in the 22:00 phase 0); one resting duplicate of the 762/761 spread expired
  as a day order (OUTCOME `expired`, cycle 9). Refused by the core: every
  QQQ candidate but one (`REVALIDATION_VOID` five times, G5 twice), one
  SPY spread on G5, one analyst batch as `SCHEMA_VETO` (truncated JSON).
  Book at close, read through the real adapter: cash $99,329.15, equity
  $100,092.15, no open orders; reserved max loss about $3,420 across the
  six structures. The book is concentrated in short SPY 762 puts expiring
  2026-09-04 (nine contracts across three structures) — G4's per-underlying
  cap admitted it and every leg is covered, but the concentration is worth
  a look when the O5 thresholds are next revisited (the same structure was
  proposed and approved in three different cycles; G7 keys on the cycle, by
  design). Tomorrow is `FLATTEN_DATE`: entries vetoed, the deadline regime
  closes the book in the session; the scheduled tasks stay enabled. Both
  journals of the day are archived in the verification store. Not swapped,
  as ruled: the one-lot brief and the resolver fix wait for after the
  competition.
- **2026-09-02 — The submission video is a separate npm package under
  `video/`, rendered only from the frozen presentation-cutoff dataset
  (SUB-04; scaffold landed 22:30 CEST).** Remotion and React cannot enter
  the root `package.json` without voiding the running certificate, so
  `video/` carries its own lock, its own `tsconfig.json`, and the root
  `eslint .` ignores `video/**`. Every figure and URL a scene shows is read
  from `video/public/dataset/{meta,projection}.json` — the pinned
  presentation route's `projection.json` plus a meta file with the URLs —
  through pure selectors; nothing is typed into a scene. Two gates enforce
  the SUBMISSION-SPEC rule that uploaded artifacts cite one frozen dataset:
  `scripts/check-dataset.mjs` before the bundler and `validateDataset` in
  the composition refuse a `{{` placeholder, a non-presentation cutoff, a
  cutoff or account that differs between meta and projection, and a route
  URL that does not name the pinned revision; the deliverable render
  (`npm run render`, `--frozen`) additionally refuses `frozen: false`, a
  projection that is not risk-flat, and an empty capture slot, while the
  studio and `render:dev` accept those with a DEV watermark burned in. The
  dev dataset committed today is the competition journal at 19:00:51Z
  pinned as a presentation cutoff for scaffold work only, rendered into a
  scratch directory so the owner's publish tree carries no premature pin.
  Screen recordings are the owner's step against the pinned route after
  Thursday's close; until then the scenes render data-driven stand-ins
  behind a red "capture pending" border. Observed while wiring the
  selectors: the journal's `candidateVerdicts` carry two shapes — the gate
  verdict with rationale and G1–G8 vector, and the qualification window's
  post-gate veto with only a code and a reason — so the featured veto is
  always one with a vector.
- **2026-09-03 — FLATTEN_DATE: the runner could not price the closes of the
  structures expiring next session; the owner stood the writer down and the
  certified watchdog flattened the book.** The deadline regime closed the
  three structures expiring 2026-09-08 in the 15:30 CEST cycle (INTENT seq
  43–45, all filled, OUTCOME seq 46–48). The three structures expiring
  2026-09-04 — the iron condor 768/769C + 762/761P ×3, the 762/761 put
  vertical ×3 and the 762/760 put vertical ×3 — were planned as intact
  flatten targets in every later cycle (`planBookClosure` consumes the
  shared 762 put leg correctly) and never submitted: `ladderClose` refused
  each with `PRICE_UNAVAILABLE: QUOTE_MISSING`, because the runner's
  `MarketWindow` (`src/shell/agent-runtime.ts`) takes its expiries from
  `EXPIRY_MIN_SESSIONS` (2) upward, so on `FLATTEN_DATE` the next-session
  expiry drops out of the quote universe and the phase-1 snapshot carries no
  quote for any held 09-04 contract (every snapshot before today quoted all
  five; every snapshot today quoted none). The refusal lives only in
  `managementRefusals` of the printed cycle report, which the scheduled task
  discards, so the journal shows seven silent cycles with five positions and
  no intent (seq 49–58). Reproduced outside the checkout by a pure simulation
  over the built `dist/core` modules on the real journal. The watchdog's and
  the deadline runtime's windows start at zero remaining sessions on purpose
  (their comments say why); the runner's management step uses the entry
  window. Second finding, fixed digest-neutrally (`e1576fb`):
  `tools/watchdog-run.ps1` ran the CLI under `$ErrorActionPreference =
  'Stop'` with `2>&1`, so the composition line the CLI writes to stderr
  killed the child before the staleness assessment — 54 scheduled firings
  since arming logged `run:` and nothing else; the dead-man had never been
  able to act. **Ruling (owner, 18:00 CEST, on the PM's recommendation):**
  invoke the safety net deliberately rather than do nothing (halt
  `DEADLINE_FLATTEN_FAILED` at 21:45 and Friday expiry mechanics on the
  competition account), close by hand (a manual mutation on the competition
  account), or write a one-off composition script at the money boundary
  without a gate. The owner disabled the AgentCycle task at 18:00 (the 18:00
  cycle, seq 58 at 16:01:12Z, was already running and completed); the
  journal crossed `DEAD_MAN_BOUND_MS` at 16:51:12Z; the 16:55:02Z watchdog
  firing fenced the writer at epoch 27, journaled `HALT WATCHDOG_TAKEOVER`
  (seq 59) and submitted the three whole-structure closes (seq 60–62) at
  debit limits of 100 ¢ (the condor, at its width cap: the call side was
  fully in the money), 7 ¢ and 7 ¢; the broker filled all three within one
  second at 92 ¢, 4 ¢ and 6 ¢. Read through the real adapter at 18:55: zero
  positions, cash equal to equity at $100,583.59 (day one closed at
  $100,092.15). Re-enabling the task needs an elevated shell (owner step);
  the next agent cycle journals the three OUTCOMEs through phase 0 and the
  session's final cycle runs the S-G11-01 flatten assertion. Declared: the
  `WATCHDOG_TAKEOVER` halt records an owner-invoked stand-down, not a hung
  writer; Friday is journaling-only either way, and a manual un-halt with
  that reason is the owner's choice. Backlog for the next digest-changing
  window (A): the runner's management step must observe the market through
  the closing window the watchdog and the deadline runtime already use, from
  one shared window builder; management refusals must reach the journal or
  at least a log the scheduled task keeps; the cycle task should capture the
  printed report.
- **2026-09-04 — Submission material is rendered from one frozen dataset;
  the rendered video and its screen captures are not committed.** The
  presentation dataset under `video/public/dataset/` is the byte-identical
  copy of the pinned route's `projection.json` (revision
  `sha256:7b82959a344a7c7e`, cutoff `2026-09-03T20:00:14.787Z`, seq 76),
  fetched from the host and compared with the owner's publish tree; every
  figure in the one-pager, the deck, the form copy and the preflight is
  derived from it by `submission/render/inject.mjs` (an unknown or
  unresolved token fails the run), and `submission/render/render.mjs`
  renders the one-pager PDF (one A4 page, 11 pt), the deck PDF (ten slides,
  a small Marp style block spliced into the injected copy so slide nine
  fits) and the 1920×1080 cover from `submission/render/cover.html`. The
  texts state the result with the unattributed −$2.41 residual next to
  realized and unrealized (otherwise the figures do not reconcile), and name
  both competition-week defects and the watchdog takeover in the one-pager
  limitations, deck slide nine and the long description — the wrapper fix
  (`e1576fb`, 17:41 CEST) landed an hour before the 18:55 takeover, so the
  texts say "an hour before the takeover" rather than "the same afternoon".
  Dropped from the one-pager: the sentence on absent qualifying activity,
  moot with six qualifying fills. The form has a dedicated paper-account-ID
  field (`HACKATHON-FACTS.md`), so `COPY.md` carries `PA376WIK2ATL` as its
  own section. Tracked: the one-pager, deck and cover (small, cited by the
  form); ignored: `submission/render/out/`, `submission/*.mp4` and
  `video/public/captures/` — the video deliverable and the five recordings
  go to the form upload and the verification store's `evidence/`, not into a
  public git history (`.gitignore` explains; the owner can force-add later).
  Recorded, not resolved: GitHub's default branch `main` is still at the P6
  merge `bce890a`; the plain repository URL therefore shows Monday's state,
  and the owner decides between merging `p7/dev-live-certificate` `--no-ff`
  into `main` from a separate worktree before the form (recommended; the
  operating checkout stays untouched so the running digest holds), submitting
  the branch URL, or switching the default branch.
- **2026-09-04 — Owner review of the submission material: voice-over,
  ordered gate sequence, honest P&L decomposition; three cold-read lenses
  before the second cut.** The owner's review (11:05 CEST) found the four
  assets clean but hard to follow: nothing explained the architecture and
  the order of the checks, the video scrolled the dashboard for two minutes
  in silence, and Alpaca's role read like any broker API. Three cold-read
  lenses ran on the gate tier before anything was rewritten. The judge lens
  found "one week of paper trading" against a two-session journal (every
  entry opened 2026-09-02, every close 2026-09-03) and no artifact naming
  G1–G8 in order. The quant lens decomposed the +$583.59: one four-contract
  QQQ long call on an overnight gap made $356.00, 61% of the result; six
  structures were open at once against $3,421.00 of reserved worst case,
  carried overnight; the $33.15 max drawdown is measured on cycle-spaced
  samples and never sampled the overnight move, so pairing it with the
  overall peak overstated the point. The Alpaca lens showed from the code
  that the executor uses the REST API (multi-leg limit orders, client order
  id), not the CLI the texts named, that analyst tool calls are not
  journaled (candidates, verdicts and broker order ids are), and that the
  analyst child process holds read-only market-data credentials and 32
  allowed MCP tools with no account, position or order access. **Rulings:**
  every text says "two sessions"; the injector derives the peak reserved
  worst case, the best lifecycle's share and the convex fill ratio (1 of 4)
  from the dataset and the one-pager, deck slide seven and the long
  description state them; deck slide six and the one-pager give the cycle
  and G1–G8 in order plus G9–G14; "CLI" is gone from the order path; both
  PDFs carry a hackathon footer. The video gets a voice-over: a 650-word
  script (`video/public/narration/script.json`, per-scene cues also drawn as
  a caption strip) synthesized per scene through ElevenLabs
  (`video/scripts/tts-elevenlabs.mjs`, voice "Matilda", key in the root
  `.env`, credit line on the closing card), with `check-narration.mjs`
  refusing an mp3 longer than its slot minus one second; the narrator speaks
  about 122 words per minute, so two scenes were trimmed to fit. The prior
  attempts the owner wanted named (TradeScan-AI, Vigil) were asked from
  their own sessions rather than invented: Vigil was a C# market-making bot
  on OKX perpetual swaps killed by the retail fee floor (2 bp per side
  against a 1.3 bp inside spread).
- **2026-09-04 — Submitted; the form differed from the register in three
  places and the register was corrected, not argued with.** The lablab form
  (three steps, team leader only) caps the long description at 2000
  characters, has no one-pager upload, and offers predefined lists for
  categories (`Finance`, `Investment` chosen), tracks (`Options Alpha
  Agents`) and technologies (`Alpaca`, `Anthropic Claude`, `Claude Code`,
  `Vercel`; no TypeScript, Node, React, Remotion or generic MCP entry). The
  long description was cut to 1,980 characters keeping the architectural
  claim, the gate order, the barbell, the result with its concentration and
  worst case, both defects and the no-alpha line; the one-pager went as a
  link to `main` in the optional Additional Information field together with
  the pinned route, the deck, the account evidence and the decision log;
  `main` was merged `--no-ff` from the branch in a separate worktree
  (`1951a44`, then `32313eb`, `b660987`, `fe9953b`) so the plain repository
  URL shows the submitted state. Verified after submission by anonymous
  fetch: the video and the deck served by the platform are byte-identical to
  the repository files; the cover is re-encoded to JPG at 1920×1080. Project
  page: https://lablab.ai/ai-hackathons/alpaca-ai-trading-agents-hackathon/glass-box-trading/glass-box-trading. One agent-caused form edit is on record: while reading the
  dropdown options the agent's click selected `Options Alpha Agents` in the
  track field; the owner kept it.
- **2026-09-04 — The competition tasks stop tonight; a three-month paper
  run is a new deployment (P9), not a tail of this one.** The owner asked
  whether the scheduled tasks could simply keep running for three months to
  learn whether the strategy is viable. They cannot answer that question:
  `config/policy.json` binds this deployment to `COMPETITION_START` and
  `FLATTEN_DATE`, from which G11 vetoes every entry (S-G11-01), and the
  standing halt blocks entries too, so the tasks would journal no-trade
  cycles into a journal the spec freezes after `TERMINAL` (S-G11-04), while
  the watchdog stands down after `TERMINAL` by design (G14). Ruling: both
  tasks are disabled after tonight's `TERMINAL`; the long run becomes P9 in
  the release plan with its own window regime (spec decision first), the
  three parked fixes landed, certificate run four, a chosen account, fresh
  task installation, a weekly publish routine and a cost model in the
  projection, because paper fills at the limit and near-zero fees measure
  the gross path only. Recorded in the release ahoy note as item 8.
- **2026-09-04 — Competition closed: the `TERMINAL` entry stands and the
  dashboard carries the deadline pin.** The event's last scheduled cycle ran
  at 22:00 CEST (seq 104, ping `success` at 20:00:09.625Z); both task
  triggers end their 6h30m repetition window at 22:00 local, so nothing
  could fire again before Monday and the one-shot could not meet a live
  writer. `node dist/shell/deadline-cli.js terminal` from the operating
  checkout: exit 0, epoch 68 `WON`, `appended: true`, `remainder: null`,
  `holdVisible: false`, ping `success`; the entry is seq 105 at
  `2026-09-04T20:11:48.122Z` and the journal closes at 105 entries.
  Published per `docs/PUBLISH-RUNBOOK.md` from the `gbt-publish` worktree
  with `-PresentationCutoff 2026-09-03T20:00:14.787Z` unchanged and
  `-DeadlineCutoff` at the `TERMINAL` instant: revision
  `sha256:78af85c1c238a49d`, four routes (`/`, `latest`, `presentation`,
  `deadline`), one discrepancy (`UNATTRIBUTED: -313 cents`), equity
  $100,582.87 with zero positions, qualification `QUALIFIED` on six fills.
  Candidate `https://glass-box-trading-oluchhl8s-glass-box-trading.vercel.app`,
  promoted as `dpl_CzQg2ZSVJ4qD59KS2drZx7AmUSwV`. The route the submission
  cites, `/revisions/sha256-7b82959a344a7c7e/presentation/`, is byte-stable
  across both the render and the promotion: SHA-256 prefix
  `c8745e3f5dc00401` over 157,652 bytes, measured on the live alias before
  the render, on the candidate, and on the alias after promotion, equal to
  the local deploy file; its `projection.json` still names
  `sha256:7b82959a344a7c7e` at cutoff `2026-09-03T20:00:14.787Z`, last seq
  76. Journal, `pings.log`, `watchdog-run.log` and both probe receipts are
  archived in the verification store's `evidence/`. The owner disabled both scheduled
  tasks from an elevated shell at 22:37 CEST and each reads back
  `Disabled`; they could not have fired before Monday 2026-09-07 15:30
  either way.
- **2026-09-04 — The dashboard probe asserts the wrong revision for
  carried-forward JSON routes; the candidate was promoted against a red
  probe on measured grounds (B, backlog).** `submission/publish/render-site.mjs`
  builds the manifest's `jsonRoutes` from every `.json` in the deploy tree,
  and `tools/probe-dashboard.ps1` expects each of them to name the
  manifest's current `journalRevision`. An immutable carried-forward route
  must name its own, older revision, so that expectation is false by
  construction: both runs reported 47 of 48 with the single `[FAIL]` on
  `/revisions/sha256-7b82959a344a7c7e/presentation/projection.json`
  (`journalRevision sha256:7b82959a344a7c7e expected
  sha256:78af85c1c238a49d`). It stayed green until today because no earlier
  carried-forward route carried a `projection.json` — the first revision's
  `latest` route predates the per-route JSON. What the failing check exists
  to protect was measured by hand instead, on the candidate before the
  promotion and on the alias after it: the served bytes and the pinned
  `projection.json` identity recorded in the entry above. Ruling (PM,
  22:15 CEST): promote. The deployment is correct and the instrument is
  not, the submission-cited route is proven unchanged, and `vercel
  rollback` keeps the step reversible; the owner was told in the same push
  that carried the task hand-off. Fix in the release session: the manifest
  states an expected revision per JSON route (for a carried-forward route,
  the one spelled in its own path) and `tests/publish-dashboard.spec.ts`
  pins that; until then the runbook's "a failed probe means the candidate
  is not promoted" requires the operator to read *which* check failed.
- **2026-09-05 — The A-class backlog of 2026-09-03 is fixed: one window
  builder, held contracts quoted by identity, refusals journaled, the printed
  report kept.** The competition is over and both scheduled tasks are
  disabled, so the digest may change again; this is the first change set of
  the post-competition branch and it invalidates certificate two by design.
  Built in the house order — four new scenarios (#72–#75), one new axiom
  (A29, "the observation covers the book"), two new SPEC cases (S-X-07,
  S-X-08, phase P8 in `config/implementation-phases.json`), then tests, then
  code. `npm run verify` exit 0 at 44 files / 574 tests.

  **S-X-07 — the window.** All three window sites now build through one pure
  module, `src/shell/market-window.ts`: `entryWindow` (nearest three eligible
  expiries, 300 bps — unchanged discovery for the runner), `closingWindow`
  (from zero remaining sessions, full `MAX_STRIKE_DISTANCE_BPS` — the
  watchdog's and the deadline runtime's behaviour, unchanged, now defined in
  one place) and `cycleWindow` (the entry window plus the identities the book
  holds). **Deviation from the backlog as written, deliberate:** the recorded
  item said the runner's management step should adopt the close-oriented
  window from zero sessions. It does not, and should not. That window walks
  every expiry in `[0, EXPIRY_MAX_SESSIONS]` at ten percent of spot — roughly
  25 chain requests and several thousand quoted symbols per cycle against the
  current three-expiry, three-percent walk — which a fifteen-minute cycle
  would pay for every firing, and every quoted contract also enters the
  journaled `quoteSamples` (the dev journal is already 50 KB per entry). It
  would also still miss a contract whose strike had drifted past the wider
  band, so it buys cost without buying the invariant. `MarketWindow` therefore
  gained `heldContractIds`: the adapter resolves each held identity through
  `/v2/options/contracts/{symbol}` when the chain walk did not already produce
  it, quotes it with the rest, and keeps it in the observation even unquoted,
  so the management step reports a missing price for a contract it holds
  rather than one it has never heard of. Cost: at most one extra request per
  held leg. It covers both the observed defect (expiry nearer than
  `EXPIRY_MIN_SESSIONS`, #72) and its unobserved sibling (spot drifts out of
  the entry band, #73). Consequence in the runner: phase 1 reads the book
  *before* the market instead of beside it, because the window is now built
  from the book; either read failing is still the same S-CYC-02 abstention.
  The deadline entry serializes the same way.

  **S-X-08 — the refusal.** A refused management close appends a
  `MANAGEMENT_REFUSAL` entry — exposure lifecycle, close route, the generation
  the attempt would have carried (`null` when the close plan itself was
  vetoed), the reason. It is an entry of its own rather than a field on
  `CYCLE` because the order forbids the field: the primary entry is written
  before any order exists (A5, A7) and management runs after phase 4, so at
  `CYCLE` time no refusal has happened. It is not a primary type — one primary
  per invocation still holds (S-J-03) — and it is appended at the instant of
  the refusal, so a process that dies mid-management keeps what it had already
  reached. A refused append is the ordinary A7 case. The 105 archived
  competition entries are unaffected: they simply contain no such entry.

  **#75 — the printed report.** The cycle task ran `node
  dist\shell\agent-cli.js` directly and discarded standard output, which is
  why the seven refused cycles of 2026-09-03 left nothing outside the journal.
  It now runs `tools\cycle-run.ps1`, which appends the whole report to
  `cycle-run.log` in `STATE_DIR` beside the journal and the watchdog log, with
  one rotation generation at 16 MiB. It deliberately mirrors
  `watchdog-run.ps1` including the trap that cost a day: the native call runs
  under `$ErrorActionPreference = 'Continue'`, because PowerShell 5.1 wraps
  every stderr line of a redirected native command in an ErrorRecord and
  `agent-cli.js` writes its composition line to stderr. `tools/*.ps1` is not
  digest material, so the wrapper alone is digest-neutral; the installer
  refuses to register if either runner is missing. Measured end to end against
  a scratch `STATE_DIR` on the dev profile: exit 0, three lines of composition
  output and the full JSON report in `cycle-run.log`, the real dev and
  competition journals untouched at 70 and 105 entries.
- **2026-09-05 — The publish manifest states an expected journal revision per
  JSON route, and a failed probe now names its failed checks.** The B-class
  backlog of the close session (DECISIONS 2026-09-04). `jsonRoutes` was a flat
  list of URLs and `tools/probe-dashboard.ps1` expected every one of them to
  name the manifest's current `journalRevision`, which is false for a
  carried-forward immutable route by construction — the 2026-09-04 probe
  reported 47 of 48 against a deployment that was correct. It is now a list of
  `{ url, expectedJournalRevision }`: the current revision for a route this
  render wrote, the route's own older revision for a carried-forward immutable
  one, and `null` for an immutable spelling this project cannot produce, which
  the probe fails loudly rather than passing on a guess. `render-site.d.mts`
  carries the type. The summary line also lists the failing checks instead of
  only counting them — the count alone sent the operator scrolling back through
  48 lines to find the single red one, which is exactly the friction the
  runbook's "a failed probe means the candidate is not promoted" cannot afford.
  `tests/publish-dashboard.spec.ts` pins both halves: a unit case over
  `expectedRevisionForJsonRoute` (current route, matching immutable route, the
  2026-09-04 carried-forward route, and three spellings it must refuse) and an
  end-to-end case that renders a shortened golden journal, renders the grown
  one into the same deploy tree, and asserts every stated expectation against
  the bytes on disk. Mutation-probed: forcing the function to return the
  current revision reddens exactly those two cases and nothing else.
  **Measured against the live site, read-only:** the archived competition
  journal (105 entries) re-rendered at the same two cutoffs into a copy of the
  owner's publish tree reproduces revision `sha256:78af85c1c238a49d` and its
  four JSON routes; `probe-dashboard.ps1` against
  `https://glass-box-trading.vercel.app` with that manifest returns **48 of 48**
  — the route that was red on 2026-09-04,
  `/revisions/sha256-7b82959a344a7c7e/presentation/projection.json`, passes
  against its own revision. A tampered manifest with that expectation removed
  fails the route, exits 1, and prints the failed check by name. The owner's
  publish tree and the promoted deployment were not touched.
- **2026-09-05 — R41 blind delta gate at `c27179c`: NO-GO (A=0, B=3, C=2); all
  five closed, fix-counter-probe 17 of 17.** The gate ran through the Codex
  companion in the isolated worktree `gbt-r33`, prompt
  `prompts/R41-post-competition-fix-gate.md` (rev 2), job
  `task-mto0x6fs-tie7ks`; the report is archived under
  `responses/R41-task-mto0x6fs-tie7ks/`. Two earlier launches produced nothing
  and are recorded as harness failures, not as findings: the first could not
  write in the worktree (`--write` binds the launch directory, so a gate must
  be launched *from* the worktree it reviews), the second stopped to ask for a
  Python interpreter its sandbox could not reach. The third was told to skip
  the phase check and not to stop for questions. It confirmed the archive
  comparisons (15 of 15 byte-identical, both journals), reproduced both verify
  runs at 44 files / 584 tests, caught all six mutants the prompt demanded,
  and ran its own independent set of seventeen.

  - **B1 (the one that mattered) — the credential fence was swallowed.** The
    held-identity lookup added by S-X-07 is an authenticated read against the
    trading origin, and its `catch { continue; }` discarded a real 401/403:
    the observation returned looking healthy while the account's credentials
    were being refused, and the runner fenced only on a failed *book* read.
    S-G12-06 requires an authenticated 401/403 to become a durable
    `AUTH_FAILURE` halt that blocks orders. Fixed on both sides: the adapter
    rethrows exactly the credential class (an ordinary 404, 500 or timeout
    still degrades to a missing price), and the runner fences on a refused
    observation as it does on a refused book. Four tests, including both
    directions of the classification.
  - **B2 — a refused close was invisible on the public page.** S-X-08's
    journal duty was met, but `projection.ts` ignored the new entry type, so
    the dashboard could not tell an intended hold from a refused close — which
    is exactly the pair scenario #74 is about, and `CONCEPT.md` §22–25 and
    `SUBMISSION-SPEC.md` require trade/no-trade *and why* on the page. This was
    a known gap at the time of writing and the intention had been to declare
    it; the gate is right that a declaration is not enough when the normative
    text is that explicit. `CycleView` now carries `managementRefusals` and a
    fourth result value `refused`; the cycles table has a refused-closes
    column and the detail block lists each refusal with route, generation and
    reason.
  - **B3 — a noncanonical revision route could vouch for itself.**
    `expectedRevisionForJsonRoute` accepted any `sha256-<hex>` length, so a
    foreign `sha256-abcdef` directory declared its own revision and passed a
    local probe 20 of 20. The publisher emits exactly sixteen lowercase hex
    characters (`journalContentRevision`), so that is now the only accepted
    spelling, in the route and in the current revision alike; anything else
    yields `null`, which the probe fails loudly. The second half of the finding
    is the lossy host-safe conversion: distinct source spellings can land on
    one deployed directory, after which the immutable path no longer identifies
    its content. `collidingDeployPaths` detects that before the deploy tree is
    derived and the render throws instead of publishing.
  - **C1** — S-J-03's closed entry-type list in the spec had not been extended
    with `MANAGEMENT_REFUSAL`. Fixed.
  - **C2 (and a lesson about the probe itself)** — four composition-root
    forwardings of the held identities passed the entire 584-test suite when
    replaced by an empty list. The session's own 17-mutant probe had reported
    17 of 17 an hour earlier and was not wrong; it simply never mutated those
    four lines, which is the axiom "Prüfling ≠ Maßstab" applied to a mutation
    probe: the mutant list has the same blind spot as the code that inspired
    it. Closed by naming the runner's forwarding (`cycleMarketPort`, exported
    and directly tested) and by asserting the forwarded identities in the two
    existing composition tests — the deadline one against a book deliberately
    made non-empty, because the previous assertion compared an empty list to an
    empty list and would have passed forever.

  Fix-counter-verification: a second probe of seventeen mutants over the fixes
  themselves (`r41-fix-mutation-probe.py` in the store) reports **17 of 17
  caught by tests** on a green baseline, two of them only after replacing
  mutants the typechecker had rejected — a non-compiling mutant measures
  nothing and must never be counted as a catch. `npm run verify` exit 0 at 44
  files / 594 tests. Not claimed: a bis-0 termination. This is one gate round
  and its fix round; a further delta gate on the fix set is the next step, and
  the four seams C2 found are a reminder that the store's earlier probes were
  narrower than their numbers suggested.
- **2026-09-05 — R42 fix counter-gate at `4eb900e`: NO-GO (A=0, B=4, C=1);
  three closed, one declared and put to the owner.** The gate ran blind in
  `gbt-r33`, prompt `prompts/R42-fix-counter-gate.md`, job
  `task-mto2k4l6-257q8u`, report archived under
  `responses/R42-task-mto2k4l6-257q8u/`. It confirmed what held: ordinary
  401/403 escape and 404/429/500, timeouts, network errors, a malformed 200
  and a refused redirect all still degrade to a missing price; sixteen
  book/market failure combinations keep their `WORLD_PARTIAL` /
  `WORLD_UNREACHABLE` classes with auth taking precedence and halting once;
  only `CYCLE` is ever labelled `refused`; an INTENT beside a refusal stays
  `proposal` and shows the refusal as well; injection through `reason` and
  `exposureLifecycleId` is escaped. This is the second gate round on this fix
  set, and its findings are what the axiom "fixes carry defects" predicts.

  - **B1 (closed) — the status was lost when the response body was not.** In
    `request`, a body read that rejects or stalls escaped before the
    status-carrying error was built, so a 401 with an aborted body became a
    statusless error that every caller degraded into ordinary world trouble.
    Reproduced at the parent too: a pre-existing gap that the new
    held-identity lookup made reachable. The status is now attached at the
    point it is known, for non-2xx responses only — a 200 whose body breaks
    keeps its own transport error and gains no fabricated status.
  - **B3 (closed, and mine) — a witness entry stole the following refusal.**
    `SUPPRESSED` and `FENCED_OUT` are primary types, so a witness landing
    between a cycle and its own `MANAGEMENT_REFUSAL` took the refusal into its
    window: the projection labelled the real cycle `no_trade` and hung the
    refusal on an instance that never ran a management step. That is precisely
    the misattribution scenario #74 exists to prevent, introduced by the R41-B2
    closure. Refusals are now attributed to the nearest preceding non-witness
    primary, and a witness owns none.
  - **B4 (closed) — the new exception reached an unfenced deadline abort.**
    The held-identity lookup is authenticated, so a 401/403 can now abort a
    `deadline-cli` one-shot; the CLI's generic catch fail-pinged and exited 1
    without journalling anything, leaving `halted: false`. An abort satisfies
    the deadline handover (S-G11-04) but not the shared fence duty of
    S-G12-06. `composeDeadline` now exposes `recordCredentialFence`, shaped
    like the watchdog's and using the same `recordStartupBrokerFence`, and the
    CLI calls it before releasing authority.
  - **B2 (NOT fixed — declared, and the owner's next decision) — a journal
    write failure lets the credential fence disappear.** With the journal
    unwritable, `haltForAuthFailure` appends nothing and `halted` stays false;
    once the journal is writable again the next cycle opens a position without
    any human un-halt. The gate reproduced it end to end through the real
    gateway. **This is pre-existing** — the competition ran on it — and it is
    not caused by the S-X-07 work, which only routes one more failure into the
    same hole. It is not patched here on purpose: the obvious quick fix, write
    the halt projection directly when the append fails, does not hold, because
    `reconcileHaltProjection` lets the journal win whenever the journal
    contains any halt transition at all, so an earlier HALT/UNHALT pair would
    silently clear the flag again. The shape that does hold is a durable
    marker in the epoch store beside `resetPending` and `seedPending` — call
    it `fencePending` — set when a fence could not be journaled and blocking
    every authoritative mutation until the HALT lands. That is a change to the
    authority core with its own spec case, tests and gate round, and it should
    not be bolted onto the end of a long session. **Consequence until it is
    built: a credential rejection that coincides with an unwritable journal
    can be followed by an armed cycle.** It belongs before P12's first armed
    cycle, and it is listed there.
  - **C (declared residual) — two composition-root bindings stay unmeasured.**
    The two `cycleMarketPort` call sites in `buildRuntime`
    (`src/shell/agent-runtime.ts`) pass all 600 tests when mutated to forward
    an empty list, and so does the one-line `recordCredentialFence` call in
    `deadline-cli.ts`. The functions themselves are directly tested; what is
    untested is that the composition root wires them, and `buildRuntime` has
    never been unit-tested because it spawns the pinned analyst MCP child,
    composes a real broker and acquires an epoch. Declared rather than
    smoothed: these are one-line bindings to tested functions, and the honest
    statement is that a reviewer's eye is their only check today.

  Fix-counter-probe over the three closures: **8 of 8 caught by tests** on a
  green baseline, the last only after sharpening an assertion that had passed
  for the wrong reason. `npm run verify` exit 0 at 44 files / 600 tests. Not
  claimed: a bis-0 termination — two rounds, two fix rounds, and one B
  deliberately open.
- **2026-09-05 — P12 commissioned and prepared: a three-month paper run on a
  fresh account, with the fence fixed and the alerting connected first.** The
  owner's brief: measure operational reliability and economic plausibility over
  a quarter; R42-B2 fixed before the unattended start and external notification
  as well, explicitly *not* "notification instead of the fence fix"; a fresh,
  agent-only paper account under the competition profile's protections with the
  dev account kept for the certificate and tests; three calendar months from the
  first regular cycle. The competition journal, the submitted revisions and the
  competition account stay a closed archive, and the long run gets its own
  `STATE_DIR`.

  **The fence (S-G12-08, A30, scenarios #76/#77).** The mark lives in the epoch
  store, is written *before* the HALT append is attempted, and is cleared by
  exactly one thing: the human un-halt, which is refused if it cannot clear it.
  The owner's demand was that "a second file" is not a proof, so the boundary is
  stated as a table and each row is a test: journal unwritable (mark stands,
  next cycle fenced although nothing was journaled); an earlier HALT/UNHALT pair
  in the journal (cannot clear it — this is precisely why the mark is not in the
  halt projection, where `reconcileHaltProjection` lets the journal win);
  restart (acquisition *inherits* it); process death between the two steps
  (fail-closed by ordering); epoch store also unwritable (no mark — **and no
  authority**: `acquireAuthority` writes the store and a failed durable write is
  `REFUSED`, so nothing can act and nothing needs recording). Found while
  building it and worth recording because it would have made the whole fix
  worthless: `acquireUnderLock` rewrote the store without the mark, so **every
  restart cleared the fence**; it is now carried through the pure
  `planEpochAcquisition` plan beside `seedPending` and `resetPending`.
  Deliberately no stricter than a journaled halt — a risk-reducing close stays
  possible, so a fenced book can still be flattened.

  **The alerting (S-G14-05/06, A31, #78/#79/#80).** Two claims, two endpoints.
  Liveness is the wrapper's: it reports on every scheduled firing, including
  the ones it skips outside the session, and reports a non-zero agent exit as a
  failure so a crash-loop shows immediately. Readiness is the runtime's, and
  `planPing` now lets a standing halt or unreleased fence outrank a landed
  append — before this a cycle that correctly halted on `AUTH_FAILURE` reported
  *success*, and the S-X-06 expiry-hold test encoded exactly that defect
  (a standing `RESIDUE_UNRESOLVED` halt with a green check) and now asserts the
  opposite. Measuring the path end to end against a real HTTP endpoint rather
  than trusting it found a second defect: the composition root delivered
  `alarmConditions` instead of the ping plan's conditions, so a fenced cycle
  POSTed an **empty** alert body; the report now carries `pingConditions` and a
  regression test pins it. `HEALTHCHECK_PING_URL` was **absent** from the
  environment for the whole competition — seventy pings into a local file on the
  machine most likely to have died — so `tools/check-alert-path.ps1` exercises
  all four signals and prints the timings derived from `config/policy.json`.
  Delivery is proven; receipt stays an owner step, as does the silence test.

  **The scheduler.** Measured, not assumed: `tools/check-schedule-coverage.mjs`
  walks every weekday of a deployment and reports the worst-case margin. For
  2026-09-08..2026-12-08 from `Europe/Berlin` the local session start moves to
  14:30 on **2026-10-26** and back to 15:30 on **2026-11-02** — the week between
  the European and American clock changes, in which a trigger pinned to
  installation-day local time would have missed the first hour of every session.
  The window is padded 90 minutes on both sides (worst margin 30 min either
  direction) and `cycle-run.ps1` asks the exchange clock on every firing, so the
  padding costs wrapper invocations rather than agent cycles. The installer now
  **refuses to register** without that proof. `tools/verify-scheduled-tasks.ps1`
  asserts what a registered task will actually do, and earned its keep on the
  first run: the currently registered cycle task still invokes `node` directly,
  from before the wrapper existed, so as registered it would discard the report
  and send no liveness ping — while reading `Ready` either way.

  **Scale.** `tools/measure-longrun-scale.mjs` replays real entries at length.
  At 2,000 entries (about a quarter): journal 173 MB, parse 890 ms,
  fold+project 20–34 ms, render 23 ms — and a **5.2 MiB page**, growing at
  ~2.6 KiB per cycle. Runtime was never the problem; the page was. Detail
  blocks are bounded to the most recent 200 while the summary table stays
  complete (every cycle keeps its row, result and reason codes, which is what
  CONCEPT and SUBMISSION-SPEC require), with a note naming what was omitted and
  where the complete record is. Re-measured: 1.2 MiB.

  **The qualification decoupling.** The owner is right that it is not a display
  state: while open it issues an analyst brief and applies three entry vetoes.
  Everything it does hangs off `windowOpen`, which is true only between the
  checkpoint and the window end, so the smallest clean decoupling is
  **configuration only** — put both instants beyond the deployment's own flatten
  date and the window never opens. No code path is weakened, nothing is
  special-cased for "long run", and the competition profile keeps the arming
  certificate gate and the S-J-06 account binding (a dev profile would have
  switched both off: `arming-gate.ts` returns armed without reading the
  certificate for any non-competition profile). Pinned at the first cycle,
  mid-run and on the flatten day.

  **Config,** four values, nothing else — strategy and risk limits stay constant
  for the measurement period as the owner required: `FLATTEN_DATE` 2026-12-08,
  `COMPETITION_START` 2026-09-06T00:00:00Z (the fresh account must be created at
  or after it or the provenance proof refuses — fail-closed), and the two
  qualification instants moved past the end. Validated against the real
  `ALERT_SLA_MS` and canonical origin. A slipped start changes the flatten date,
  which changes the policy digest, which **voids the certificate**: the runbook
  says so and orders the steps accordingly.

  **The evaluation is fixed before the run** (`docs/P12-EVALUATION.md`): result
  per sleeve, open-at-end kept separate, unattributed as its own line,
  cycle-sampled drawdown declared as a lower bound, risk deployed, completed
  trades with counts rather than a bare win rate, no-trade reasons, and — as the
  reliability figure that matters most — time not able to trade as a share of
  session time. Paper gross stays separate from three explicit cost scenarios
  whose per-contract fees are to be cited from a published schedule at
  evaluation time, never invented, and no scenario is ever labelled "real net".
  Two benchmarks (buy-and-hold SPY, and zero); no Sharpe-style ratio, because
  sixty sessions and a few dozen trades cannot support one. What the run cannot
  answer is written down in the same file.

  Not claimed: that this is verified beyond the tests and the gate round on it.
  `npm run verify` exit 0 at 46 files / 619 tests.
- **2026-09-05 — R43 readiness gate at `ab70440`: NO-GO (A=0, B=12, C=6), plus
  an owner-reported A-class blocker; all closed except three declared limits.**
  The gate ran blind in the worktree `gbt-r43`, prompt
  `prompts/R43-p12-readiness-gate.md`, job `task-mtohipn2-msyhfy`, report
  archived under `responses/R43-task-mtohipn2-msyhfy/`. Separately the owner and
  an independent checker executed the un-halt ordering defect and filed it as
  class A with a reproduction (`.tmp/codex-review-80ea1ea/probe.mjs`). Twelve
  findings on one change set is the honest measure of how much of this was
  assumed rather than executed.

  **The fence had four ways out, and they shared one cause.** The mark was
  written in one place and read in one place, but *preserved* nowhere: three
  call sites rewrote the epoch store for their own reasons and any of them
  omitting the field freed a fenced deployment. Rather than patch the sites,
  `writeEpochStore` now inherits an omitted `fencePending` from the store on
  disk, so no caller can forget it and none will need to remember. The other
  three: `dispatchManualUnhalt` cleared the mark *before* the halt CAS check and
  the UNHALT append, so a refused or undurable release still freed the
  deployment (A1/B4 — the UNHALT is now appended first and the mark cleared only
  after it lands); `dispatchSafetyHalt` halted without marking, so a 401 on the
  startup account or calendar read left nothing behind (B3 — it marks on
  `AUTH_FAILURE`, and still does not on `ACCOUNT_BINDING_MISMATCH`, which is not
  a credential rejection); and with *both* stores unwritable an
  already-acquired writer kept its authority and traded after recovery (B1).
  B1's answer is not a fourth place to write but a **pre-flight durability
  probe**: before any broker read, a cycle checks that the journal, the epoch
  store and the halt projection are writable, and blocks entries with an active
  `STATE_NOT_DURABLE` signal when they are not. Its first draft blocked the
  whole cycle and broke S-CYC-06's emergency close — a journal we cannot write
  is never a reason to stop reducing risk — so it blocks entries only. The
  spec's boundary table claimed more than the code could deliver and now states
  the residual plainly: with no writable surface at the instant of rejection and
  full later recovery, no mark survives, and the alarm is the handover.

  **Readiness was healable by three other processes.** The deadline one-shots
  sent a success over a standing halt in all four combinations of {journaled
  halt, marker-only fence} × {reconciliation, terminal} (B5); a startup refusal
  sent nothing at all, so a missing analyst manifest journaled its halt and the
  endpoint saw zero requests (B6); the watchdog's fail body named only the
  takeover and omitted the halt reason (C2). The standing impediment is now read
  in one place, `standingImpediment`, by all three runtimes, and `agent-cli`
  fail-pings `STARTUP_REFUSED:<stage>` and `CYCLE_ABORTED`.

  **The qualification window reopened before the deployment ended.** With the
  checkpoint one day after the flatten date, the window opened at
  2026-12-09T20:00Z — on the journaling-only day — and the real runner issued an
  active one-lot brief and fail-pinged `COMPETITIVENESS_AT_RISK` (B9). The
  checkpoint moved to 2027-06-01, months clear of any slip. The test that missed
  it copied the constants and stopped sampling at the flatten date; it now loads
  `config/policy.json` and scans every minute to three days past shutdown. A
  test that copies the values it is meant to check cannot see them change.

  **The operator package promised things it did not have.** `manual-unhalt.js`
  has no entry point: running it exits 0 and changes nothing, so a fenced
  deployment stayed fenced while the operator believed they had released it
  (B10). `src/shell/unhalt-cli.ts` is the missing command — it prints the
  standing state and the fence procedure, requires `--operator`, `--reason` and
  `--confirm`, and was exercised end to end (a refusal keeps the fence, a
  release clears it). The activation gate accepted a supervised cycle and a
  checker that itself declares reboot and signed-out operation unproven (B11);
  it now lists all six conditions, three separate silence drills among them, and
  marks which are proven by test and which only on the host.

  **The scheduler checks certified the wrong things.** The task verifier
  compared substrings, so cmd.exe, a 01:00 trigger, a weekends-only schedule and
  a watchdog interval exactly at the dead-man bound all passed 26 checks (B7);
  every expectation is now exact and it reports 30. The documented alert
  schedule produced alarms in ordinary operation, because readiness was reported
  only on firings that ran a cycle — a set whose local times move an hour in the
  DST-mismatch week — while the cron also expected a liveness ping at 23:45 that
  the trigger never produced (B8). Readiness now reports on **every** firing
  through `readiness-cli.ts`, the trigger window is snapped to whole quarter
  hours so its firings map to an exact cron, and the installer prints the
  expression, timezone and grace for each check rather than the runbook guessing.
  Coverage ignored the scheduler's local weekday, so `Pacific/Kiritimati` passed
  66 weekdays whose sessions land on the local Saturday (B12).

  **Two things the owner asked for beyond the gate.** The watchdog now has its
  own heartbeat endpoint: both other checks stayed green while it alone was dead,
  because liveness comes from the cycle wrapper and readiness from the state
  files — the safety net whose failure was least visible. And the installer
  registers **disabled** unless `-Activate` is passed, so installing is no
  longer the same act as going live.

  **Executed on the dev-profile scratch state, not claimed:** a watchdog
  takeover — a journal stale by 60 minutes against a 50-minute bound produced
  `assessment: stale`, `acquired: WON` at epoch 4, a journaled
  `HALT WATCHDOG_TAKEOVER`, and a fail ping; the readiness CLI then reported
  `HALT_STANDING:WATCHDOG_TAKEOVER`, so the check stays red until a human
  clears it. Also executed: all six alert signals against a real HTTP endpoint,
  and Codex's own reproduction probe, unchanged, now returning
  `fencePending: true` and `halted: true` on both of its paths.

  **Declared, not closed.** Three host-level proofs cannot be produced from
  here and are owner steps in the runbook: a clean reboot, S4U execution with
  the session signed out, and a powered-off machine. The task verifier says so
  itself rather than implying otherwise. Also still declared: the fence mark's
  write-before-append ordering is unobservable in-process, since both orderings
  set it before returning; it is enforced by structure and by the S-G12-08 text.

  `npm run verify` exit 0 at 46 files / 632 tests. Not claimed: a bis-0
  termination.
- **2026-09-05 — R44 counter-gate on the R43 fix set: NO-GO (A=2, B=15, C=1);
  all closed, none declared away.** The gate ran blind against `cf956e2` in a
  clean clone pinned to that commit, job `task-mtojqk4l-jhcozr`. Its own summary
  is the honest one: several R43 closures hold, and the changes opened new
  paths. That is the "fixes carry defects" axiom arriving on schedule — the
  second round on the same seams found two blockers, and neither was in the
  code R43 had left alone.

  **The fence's last exit was an argument about naming.** `dispatchSafetyHalt`
  marked on `AUTH_FAILURE` only, on the reasoning that a foreign account
  answering is not a credential rejection. The gate executed what that costs:
  with the journal read-only the `ACCOUNT_BINDING_MISMATCH` halt never landed,
  and once the journal recovered the same epoch submitted a risk-increasing
  order with no human release (R44-A1). The taxonomy was correct and beside the
  point — both reasons this entry point accepts are a refusal to trade until a
  human looks, which is exactly what the mark records. It marks for both now,
  and when neither the mark nor the append lands the failure names both rather
  than only the append. Two further fence holes had the same shape at other
  seams: the deadline one-shot built its credential recorder *after* the
  calendar read, so a 401 on the first authenticated read of the invocation
  ended it with no fence, no halt and no ping (B4); and the watchdog folded a
  401 on its own close into `acknowledgement_lost`, leaving `WATCHDOG_TAKEOVER`
  standing with no fence mark and the operator never handed the S-G12-06
  procedure (B5). Both now escape to the same recorder the recovery read
  already used.

  **The durability probe asked the wrong question.** It ran `accessSync` and
  opened files `"r+"` on purpose, to stay outside the S-G12-07 write boundary —
  and so it measured permissions, not room. On a full volume both succeed and
  the first real append throws `ENOSPC`; the gate produced exactly that and the
  probe returned `ok` (B3). The byte-level probe now lives in `epoch-store.ts`,
  one of the declared writers, and writes, fsyncs and removes a sidecar file;
  `state-dir.ts` calls it and still writes nothing itself, so the boundary test
  is untouched rather than weakened.

  **Three signals lied in three different ways.** An unreadable `epoch.json`
  and a corrupt journal both reported readiness *success* while every
  acquisition and every writer would have refused (B6) — `standingImpediment`
  now reads both, with a journaled halt outranking them so the operator is told
  the cause and not a symptom, and an unset endpoint exits non-zero instead of
  printing an all-clear nobody receives. A startup refusal sent **two** POSTs
  under two names for one incident, because the validator and the CLI both had
  a sender (B7); `StartupOutcome.failurePinged` makes it one. And the cycle
  wrapper threw on a missing `STATE_DIR` before `Send-Liveness` was even
  defined, so the scheduler fired and nothing was reported at all (B8) — the
  reader, the sender and the liveness URL are resolved first now, and every
  precondition goes through `Stop-WithLiveness`. Executed, not argued: a refusal
  against a real local endpoint produced exactly one
  `POST /liveness/fail :: wrapper refused: …`.

  **The scheduler tools certified and printed the wrong things.** The verifier
  read `Actions[0]` and `Triggers[0]` and ignored everything after them, so a
  definition with a second `cmd.exe` action or a second weekend trigger passed
  all 30 checks — a task runs every action and honours every trigger (B10). It
  now asserts exactly one of each and the exact cycle cadence, and reports 35.
  The installer printed `*/7` for an interval that does not divide 60, which no
  cron states exactly (Windows fires 14:56, 15:03; the cron expects 14:56,
  15:00) — such an interval is refused rather than approximated (B11). Its
  `-WhatIf` preview died with "access denied" in the normal shell the runbook
  prescribes, because `New-ScheduledTaskPrincipal` needs elevation and stood
  ahead of the output the owner is told to copy (B12): the schedule block moved
  in front of everything that needs elevation, and `-WhatIf` no longer builds
  the principal at all. And the timezone it printed was the Windows id
  `W. Europe Standard Time`, which healthchecks.io does not accept; the host's
  own node now answers with the IANA name (B13).

  **The owner package had an ordering problem and a circular one.** Owner step
  2 demanded ping URLs and a certificate path that steps 3 and 4 produce, and
  told the owner to abort on `<MISSING>` — every value read `<MISSING>` in a
  fresh environment (B14). The activation gate was worse than untidy: drill 5a
  enabled the **cycle** task during a session on Tuesday, which lets a
  competition cycle trade a day before the anchor and silently starts the
  measurement period on the wrong date (R44-A2); and drills (b) and (c) left
  both tasks disabled and the machine off, while the restart and signed-out
  proofs need them enabled — with the only enable command standing after all six
  conditions were already met (B15). Both are answered by one observation: the
  drills need the tasks *running*, not the agent *trading*. The trigger window
  is wider than the session and `cycle-run.ps1` skips outside it while still
  firing and reporting, so the tasks are enabled at 22:10 CEST — after the US
  close — and every drill runs against real firings that cannot trade. The rule
  that replaces the old ordering is absolute and written as such: no firing may
  run a cycle before the anchor, and an unfinished drill at 15:05 CEST on
  Wednesday disables both tasks and moves the anchor. Also from this group: the
  documented release omitted `--expect-halt-seq`, and the gate showed a second
  halt landing between preview and confirmation being released unseen (B9) —
  the CLI now **requires** it whenever a halt is journaled, which was verified
  by execution; and `npm` is `npm.cmd` throughout, because `npm.ps1` is blocked
  by this host's execution policy (B16).

  **A new test ratified sixty dead links.** The scale test asserted a table link
  for every cycle while only the last 200 get a detail section, so it confirmed
  260 links against 200 targets and called it green (B17). The row keeps its
  number, the link appears only when its target does, the golden path picks its
  examples from the rendered slice, and the test now asserts the converse: no
  anchor on the page points at a section that is not on it.

  **The date correction (finding 18).** This log still said `FLATTEN_DATE`
  2026-12-08 while `config/policy.json` and the runbook say **2026-12-09**. The
  executable configuration is right and this entry is the correction: three
  calendar months from the first regular cycle on Wed 2026-09-09 is Wed
  2026-12-09, journaling-only Thu 2026-12-10, `TERMINAL` after that close. A
  glass-box decision log that contradicts the configuration it explains is a
  defect in the log, not a rounding difference.

  **Verification.** `npm run verify` exit 0 at **47 files / 642 tests**. New
  tests: `tests/r44-signal-integrity.spec.ts` (durability probe, standing
  impediment, one-signal-per-invocation), plus the fence, calendar-401,
  watchdog-401 and dashboard-anchor cases in their existing files. Executed on
  this host rather than asserted: the wrapper refusal ping against a real
  endpoint, the un-halt CLI refusing a release without `--expect-halt-seq` and
  naming the number to use, the installer preview printing IANA
  `Europe/Berlin` and three exact crons from an **unelevated** shell, and the
  installer refusing a 7-minute watchdog interval. Not claimed: a bis-0
  termination, and nothing on this branch is live on the host.
- **2026-09-05 — R44 fix-set mutation probe: 9 of 10 mutants caught; the one
  survivor is declared.** The probe broke each R44 fix on purpose and asked
  whether the suite noticed, with a baseline typecheck so a mutant that does
  not compile is reported as NOT-COMPILED rather than counted as a survivor.
  Its first run caught six of ten and was worth more than the fixes it tested:
  neutering the byte-level durability call left every assertion green, because
  the surrounding checks are permission checks that a write-refusing volume
  passes — so `probeStateDurability` now has a test whose directory occupies
  the probe file's own name, the same shape as ENOSPC and reproducible on this
  platform. Two mutants did not compile, which measures nothing, and the cause
  was the same in both: the `--expect-halt-seq` guard was inline in a CLI entry
  point with top-level await, i.e. a **decision living in the shell**, so
  nothing could import it. It is `manualReleasePrecondition` in
  `src/core/lifecycle.ts` now — pure, and the thing the test measures. Second
  run: 9 of 10. The survivor is `fsyncSync` inside `probeDurableWrite`.
  Declared, not fixed: on a healthy disk the write succeeds with or without the
  flush, and the case where the difference shows — a write that is accepted and
  lost at flush — is not producible from a test on this platform. The call
  stays, because it is what makes the probe answer the question it claims to.
  `npm run verify` exit 0 at 47 files / 645 tests.
- **2026-09-05 — the cost of reading the journal in `standingImpediment`,
  measured rather than assumed.** R44-B6 made every readiness report answer
  “would a writer refuse this state?”, which for a corrupt journal means
  parsing it. That is a new read on four paths (cycle runner, deadline
  one-shots, watchdog, readiness CLI), each once per invocation, and the
  readiness CLI fires every 15 minutes for three months. Measured at the size a
  three-month run reaches — 2,000 entries, **152.7 MiB** — a full read and
  per-line parse takes **162 ms** and peaks around **500 MiB** of RSS. The time
  is irrelevant against a 15-minute cadence; the memory is the real number, and
  it is transient in a process that exits immediately afterwards. Kept as is:
  the cheaper alternatives either answer a different question (a tail-only scan
  cannot see corruption further back) or add a cache that can disagree with the
  file. What is *not* kept is silence about it — the figure belongs beside the
  173 MB disk budget in the runbook, so a slower machine has something to
  compare against.
- **2026-09-05 — R45 aborted mid-run, and its two interim findings are closed;
  no verdict was issued.** The counter-gate on the R44 fix set (job
  `task-mtolstwm-23ntld`) died after sixteen minutes with its findings
  half-written. It left two things behind, both reproducible, and both were
  real.

  **The fence's third entry point (A).** R44-A1 made `dispatchSafetyHalt` mark
  for both of its reasons. It did not touch `haltForBindingMismatch` — the halt
  the account-bound broker port raises from *inside* a dispatch when the broker
  answers with a foreign account. The gate drove it: journal read-only, binding
  rejected, no HALT appended, `fencePending` still false; after recovery and a
  restart the same deployment submitted a risk-increasing order with no human
  release. Instance three of one cause. Rather than mark in a third place, the
  rule now has a single implementation, `markFenceBeforeHalt`, which both paths
  call — the same move that closed the preservation problem in R43 by putting
  inheritance inside `writeEpochStore`. The gate's own probe is kept as a
  regression test, red without the fix.

  **“Exactly” was rounded into existence (B).** The cadence check added for
  R44-B10 compared `[math]::Round($interval.TotalMinutes)`, so a registered
  repetition of `PT14M31S` read as “cadence is exactly … 15 min” and the
  verifier passed 35 of 35 while every firing drifted away from the cron the
  external readiness check expects. The comparison is on total minutes with no
  rounding, and both interval details now print the real value
  (`every 00:14:31 (= 14.5166666666667 min; policy … = 15 min)`). Verified by
  re-running the gate's own probe against the fix: 1 of 35 fails, on that line.

  A round that dies without a verdict is not a passing round, and this entry
  does not claim one. `npm run verify` exit 0 at 47 files / 646 tests; the
  counter-gate is relaunched on the new head.
- **2026-09-05 — a fourth fence instance was suspected, built, and refuted; the
  code came back out.** After R45-A1 the obvious question was whether the rule
  is missing anywhere else, so every construction of a `HALT` entry in `src/`
  was walked against it. One looked open: `recordStartupBrokerFence` calls
  `dispatchSafetyHalt`, which returns `EPOCH_ABSENT` **before** it can mark —
  there is no store to mark in — and then falls back to acquiring authority,
  which creates that store, and appends the halt directly. On a virgin
  deployment with an unwritable journal that reads like a seeded store, no
  halt and no mark.

  A marking call was added there and a red-first probe was run against it. The
  probe **refuted** the finding: acquisition on an unwritable journal does not
  reach `WON`, so the fallback takes its retry branch instead, which calls
  `dispatchSafetyHalt` a second time against the store that now exists — and
  that marks. The added line was dead. It was removed again rather than kept as
  harmless insurance: a marking call whose comment describes a defect that does
  not exist is worse than no call, because the next reader will believe it.
  What stays is the test, reframed as what it actually measures — the virgin
  boundary ends fenced, through the retry.

  Recorded because the negative result is the useful part: three consecutive
  rounds found this rule missing somewhere, and the fourth candidate held. That
  is the first evidence that the single implementation has actually closed the
  generator rather than moved it.
- **2026-09-05 — cold read of the operator documents: the activation drill was
  arithmetically impossible, and eleven other things an operator could not have
  executed.** An agent with no project context was given exactly
  `docs/P12-RUNBOOK.md` and `docs/P12-INCIDENT-PATHS.md` and asked where it
  would have to guess, where the clock does not work, where it could strand the
  system, what the two documents contradict, and what it would still not know at
  23:00 with a red alert. The findings were about the documents, and the worst
  of them was mine from the same afternoon.

  **Drill (c) could not do what it claimed.** “Shut the machine down for 25
  minutes … expect: all three DOWN” — with graces of 30 and 50 minutes, liveness
  and readiness cannot fall inside 25. Worse, the drill and the signed-out proof
  both claimed the **same 15:00 firing**, one with the machine off and one with
  it on, and both were conditions of the same gate. And the chain from 14:16 to
  the 15:05 gate had no slack at all. The fix moves the signed-out proof into
  Tuesday's window, where firings are plentiful and none can trade, and leaves
  Wednesday to the machine-off drill alone: off at 14:05 for 45 minutes, which
  fells the watchdog at ~14:20 and liveness at ~14:45 while the machine is
  demonstrably dead. **Readiness is explicitly not waited for**, with the reason
  written down — its 50-minute grace lands at 15:20, after the anchor, and
  Tuesday's drill already showed that it falls. A drill that cannot finish
  before the thing it gates is not a drill.

  **“The anchor moves” was a sentence, not a procedure** — and the sentence was
  wrong: it said *next trading day*, but the certificate needs US market hours
  and the new anchor fires at 15:15 the same afternoon, which is exactly the
  collision the dates section forbids elsewhere. It is **two** trading days now,
  with the seven steps written out in order, including which key in
  `config/policy.json` changes and that the drills do not carry over.

  **Three sentences carrying the weight in an emergency pointed nowhere.**
  “tell me”, “report” and “run the fence procedure” appear at the three most
  serious abort paths; there is no recipient for the first two — Felix is alone
  with this run — and the third existed only as CLI output, so a broken CLI
  took the procedure with it. The fence procedure is written out in five steps
  now, “report” means a dated line in `STATE.md`, and the provenance refusal
  says what to do instead of whom to tell.

  **The rest, briefly:** step 2's check ran the compiled loader while `npm run
  build` was in step 5; the three checks had no names, so a push notification
  could not be mapped to a row in the incident document; step 3 left all three
  checks alarming for a day before activation, with hourly reminders, and never
  said to pause them; there was no uninstall command anywhere;
  `-CoverageThroughDate` stopped at the flatten date although firings are needed
  on the journaling-only day after it; the readiness action list omitted
  `STARTUP_REFUSED`, `CYCLE_ABORTED` and `DEADLINE_FLATTEN_FAILED` — the last
  being the only alert that cannot wait; the prohibition on manual trading and
  the incident document's instruction to close in the broker UI contradicted
  each other with no rule for when the prohibition lifts; “200 MB” for the
  journal sat next to a measured 152.7 MiB; and every time was written CEST for
  a run that crosses two clock changes.

  What the read did **not** find is worth recording too: the dates table is
  internally consistent, three calendar months from 2026-09-09 is 2026-12-09,
  and owner step 5 was executable as written, start to finish. `npm run verify`
  exit 0 at 47 files / 647 tests.
- **2026-09-05 — R46 counter-gate: NO-GO (A=3, B=9, C=0); all twelve closed.**
  The gate ran blind against `fa2ebad` in a byte-identical HEAD snapshot, job
  `task-mtommbrm-ewf8le`, and executed every failure moment against the real
  code with fake brokers, HTTP stubs and simulated task definitions rather
  than reading for them. It also wrote its findings down as it confirmed them,
  which is why this round survived where R45 did not.

  **The rule was narrower than the problem, and that was the generator.**
  “A safety halt marks the credential fence before it appends” had been closed
  at four entry points across three rounds. R46 showed the framing itself was
  the defect: the rule spoke of *credential* rejections, and every other halt
  — `KILL` above all — reaches the journal through the ordinary authoritative
  append, which marked nothing. The gate drove it: equity below the kill
  threshold, journal read-only, epoch store writable; `haltDurable` false,
  nothing durable anywhere, and after recovery and a new epoch the next cycle
  opened a position with no human release (A2). The append path now marks for
  **every** halt, and the mark carries a `fenceReason`, so a kill-switch is
  reported as `KILL` instead of handing the operator the credential-fence
  procedure. One consequence had to be fixed with it: the effective halt state
  (journal OR mark) is the right thing to gate mutations on and the wrong
  thing to decide “do I still owe an entry” with — reading it in the watchdog
  would have let a marked-but-unjournaled takeover skip its own entry forever.
  The journal decides that question now.

  **The journal is the authority; the projection is a cache of it (A3).** A
  real `HALT KILL` landed, its projection write failed, and the readiness CLI
  sent **success** and exited 0 — and repeated success pings suppress the
  external silence alarm as well, so the single signal that should have
  carried the stop was the one saying everything was fine.
  `standingImpediment` reads the journal first now.

  **And one ordinary miss (A1):** every broker read in the cycle runner
  classifies its own failure except the emergency-close probe, which treated a
  403 as “no such order” and moved on. One rejected probe, and the same cycle
  submitted a new position and reported success, with no halt and no fence.

  **The nine B findings, by kind.** *The scheduler verifier certified three
  more wrong things:* an action reading `-Command "…" -File "<the expected
  wrapper>"` passed all 35 checks, because PowerShell honours `-Command` and
  treats `-File` as one of its arguments — so the wrapper never ran; a
  MonthlyDOW trigger with the right weekday set and cadence passed although it
  fires in one week of the month; and `ExecutionTimeLimit=PT1M` passed,
  although the scheduler then kills recovery inside its own five-minute
  budget and a killed wrapper posts nothing at all. It asserts the argument
  form, the trigger's CIM class and the time limit now, and reports **43**
  checks. *The installer still rounded:* `CYCLE_INTERVAL_MS = 870001` was
  registered as a 15-minute repetition and printed as “15 min”, and the
  verifier compared against the same rounded expectation — an interval that is
  not a whole number of minutes is refused rather than approximated. *Two
  wrappers stayed silent where they owed a signal:* the watchdog wrapper had
  never been given the treatment `cycle-run.ps1` got in R44-B8, so a missing
  node, an unbuilt `dist` or an absent `STATE_DIR` cost the full 20-minute
  period on the one component nothing else observes; and in `cycle-run.ps1` a
  throwing `.env` read still escaped the sender that already existed. Both go
  through their `Stop-With…` helper now, and both were verified by execution
  against a real endpoint. *Two signals were still wrong at the edges:* the
  readiness CLI exited 2 with **zero requests** on an unusable `STATE_DIR`,
  and a calendar 401 after a successful account read produced **two** failure
  POSTs for one invocation, because the R44-B7 flag covered only the startup
  validator and not the credential fence raised inside the runtime. *And the
  machine-off drill* was flagged for the same arithmetic the cold read found
  independently an hour earlier; it was already fixed.

  **What the gate reports as holding:** the existing auth and account-binding
  fence paths, the marker inheritance, the journal-before-release ordering,
  and `PT14M31S` now correctly refused. 48 parallel durability probes left no
  errors and no residue, and no mutex re-entrancy was found. The installer
  preview confirms the 20/45/65-minute budget arithmetic with the ten-minute
  delivery budget stated separately. Real alert delivery and a real machine
  restart remain unproven, as they must be from here.

  `npm run verify` exit 0 at **48 files / 651 tests**.
- **2026-09-05 — R46 fix-set mutation probe: 10 of 10, after the probe caught a
  test that measured nothing.** Ten mutants across the fixes of R44, R45 and
  R46, each with a baseline typecheck so a non-compiling mutant is reported as
  NOT-COMPILED rather than counted as a survivor. First run: nine caught, one
  survivor — and the survivor was the interesting one. Breaking the R46-A3 fix
  (readiness reading the journal instead of the halt projection) changed
  nothing, because the test meant to measure it left the **durable mark** set:
  the halt reached `standingImpediment` through the mark, not through the
  journal, so the assertion held for the wrong reason. Clearing the mark
  isolates the journal, and the mutant then dies. A test that passes for the
  wrong reason is worse than no test, and nothing but a probe finds those.
  `npm run verify` exit 0 at 48 files / 651 tests.
- **2026-09-06 — owner-relayed review of `88a6a54` (operator documents only):
  six findings, all six confirmed, none refuted.** The diff `fa2ebad..88a6a54`
  touches no `src`, `tools`, `config` or package file, so R46's code findings
  stand against this head unchanged; what needed re-checking was the prose that
  changed twice in one evening. It needed it. **One of the six is a closure
  that did not hold**: R46-B8 flagged the machine-off drill as unfittable, the
  cold read found the same thing independently, and the fix I wrote for both
  had arithmetic of its own that was wrong. That is the honest headline of this
  entry, and it is why the answer this time is a shared model rather than
  another set of corrected times.

  **The shared model, now one section of the runbook ("Reading the clock"),
  which everything else refers to.** Four rounds of time findings had one
  cause: times were written where they were needed and each place did its own
  arithmetic. The section states the detection formula once — *down at =
  (first expected ping after the last observed ping) + grace* — with the three
  checks' periods and graces, delivery kept separate as its own ten-minute
  budget, the rule that **every drill is measured from an observed ping and
  never from the wall clock**, the rule that the log is UTC and the
  instructions are local, and the table that **derives** every date from the
  anchor and the trading calendar instead of shifting it.

  Per finding:

  1. **Options cannot be sold at 23:00 on a Friday — confirmed.** The document
     told the operator to close structures at an hour when the option market
     has been shut for an hour, and this broker has no extended-hours session
     for options. An instruction that cannot be carried out is worse than none:
     it costs the half hour spent discovering that. **Fixed** by splitting the
     question in two wherever it appears — *permission* (three named
     situations, listed once) and *executability* (the regular US session,
     15:30–22:00 local, 14:30–21:00 in the mismatch week) — and by writing the
     after-hours branch out: record what is open, alarm for 15:20 on the next
     trading day, note the earliest expiry, and rely on the defined-risk cap,
     which is precisely the hour that choice was made for. “The one time” is
     gone; two further “close in the broker UI” claims are bounded the same way.
  2. **The Wednesday drill — confirmed, including both numbers.** With a last
     observed ping at 14:00, readiness falls after the missed 14:15 expectation
     plus 50 minutes of grace, i.e. **15:05** and not 15:20; and 15:00 to 15:05
     is **five** minutes of reserve, not ten. The start condition was unsound
     as well: enabling at 14:00 and expecting the 14:00 firing loses the
     trigger if the enable lands a second late. **Fixed** by moving *all three*
     drills into Tuesday's window — which has the room, because the checks keep
     waiting long after the last firing of the day — and leaving Wednesday to a
     cold-start proof and a gate at **14:45**, thirty minutes before the anchor.
     The machine-off drill now also subsumes the separate “both tasks
     disabled” drill: with the host switched off no ping can be produced by any
     means, which is the stronger claim.
  3. **The log is UTC — confirmed** (`tools/cycle-run.ps1:202` and
     `tools/watchdog-run.ps1`, both `UtcNow.ToString('o')`). A healthy
     signed-out drill writes `2026-09-08T21:15:…Z` for the firing the runbook
     called “the 23:15 line”, so a working task reads as a failed drill.
     **Fixed structurally** rather than by adding UTC examples that two clock
     changes would rot: `tools/show-run-log.ps1` prints every line as
     `local (UTC hh:mm:ss) message`, takes `-Since` in local time, and is what
     all ten log reads in the runbook now use. It only reads, and `tools/*.ps1`
     is not runtime-digest material, so it cannot affect the certificate. The
     calendar's two clock-change checks were wrong for a second reason and are
     corrected: the 20-minute lead-in means the first *running* cycle is at
     14:15 on 26.10. and at **15:15** on 02.11., so “only skipped invocations
     until 15:30” was false.
  4. **The provenance failure state — confirmed against the test verbatim.**
     `tests/p8-competition-provenance.spec.ts` case (b'') proves that a
     first-ever arming with a rejected account journals **nothing**: zero
     entries, no `HALT`, `primary: null`, `entriesBlocked` containing
     `PROVENANCE`, `alarmConditions` containing `COMPETITION_PROVENANCE_FAILED`,
     ping fail — the unspent epoch seed is what blocks every order, so there is
     no halt to release and no fence to clear. The runbook told the operator to
     look for a journaled `HALT PROVENANCE_BROKEN` that cannot exist. **Fixed:**
     step 7 describes the real state and where to read it, and the account swap
     is written out in full — all three `ALPACA_COMP_*` values (changing two of
     them and leaving the account id produces an `ACCOUNT_BINDING_MISMATCH`
     halt instead), and the two state-directory cases kept apart: an empty
     first run has nothing persisted and may reuse the directory after
     *verifying* that, while a persisted provenance halt is permanent and needs
     a new one.
  5. **Shifting across weekends — confirmed.** The runbook said two trading
     days, calendar block 9 said the same number of calendar days; a Monday
     anchor put the certificate run on a Sunday. And a Friday anchor gives a
     Friday flatten date whose “day after” is a Saturday with no close and no
     firings. **Fixed** by derivation: the certificate day is the trading day
     before the anchor, `FLATTEN_DATE` is three calendar months after it rolled
     forward to a trading day, the journaling-only day is the trading day after
     that, and the coverage date is the journaling-only day. Block 9 now asks
     the owner to compute the four dates and hand Gemini finished ones, with
     the stale event title corrected.
  6. **The recurring reminder — confirmed.** Step 3 said “note it and
     continue”, step 6 made it a hard gate condition. **One decision now:** it
     is required, and the only alternative is an explicit owner ruling taken
     *before* activation and recorded in `STATE.md`, which then satisfies
     condition 4 in its place. The drill's order was impossible as written —
     `-ResolveOnly` had already turned everything green — so the reminder is
     waited out first and resolved afterwards.

  `npm run verify` exit 0 at 48 files / 651 tests. Nothing is activated.
- **2026-09-06 — R47 died again, but wrote as it went: 2 A, 8 B confirmed, 2 of
  its own findings refuted by its own counter-checks; plus a second cold read
  that found the rebuilt clock still off by one drill.** The gate ran blind
  against `ae85249` and was killed at 48 minutes. This time the prompt told it
  to write findings into a file as it confirmed them, and that is the only
  reason the round exists: `.r47-findings.md` holds everything, including two
  entries it retracted after refuting them (a claimed fill sequence at the
  anchor, which G6 forbids before 15:30, and a `-WhatIf` failure that turned
  out to be an artefact of its own sandbox). A round that refutes itself is
  worth more than one that only accumulates.

  **A1 is the fifth place the stop-marking rule was missing, and the first
  where the journal was unREADABLE rather than unwritable.** The mark was set
  after `loadJournal()`, so a Windows handle with `FileShare.None` on the
  journal alone made the read throw `EBUSY` and every line after it — the
  marking included — never ran; once the handle was released the same writer
  accepted a risk-increasing order with no human release. The mark is a claim
  about the **epoch store** and may not be conditional on a second file being
  available, so it now happens before the journal is touched at all.

  **A2 is a defect R46's own fix created.** Letting a `KILL` set the mark was
  right; mapping a marker-only state to `AUTH_FAILURE, sticky: false` was
  already there, and together they downgraded the strongest stop in the system:
  after a sticky KILL whose append failed, a softer halt could land on top and
  an ordinary manual release cleared both. Stickiness now follows the mark's
  own reason, by the same rule the pure `haltDraft` uses.

  **Eight B findings, all confirmed and closed.** The scheduler verifier
  certified a task whose trigger starts in 2099 (correct hours, first firing
  seventy-three years away), foreign `-RepoRoot`/`-NodePath` values pointing at
  another checkout, `State=Unknown` under `-ExpectEnabled`, and — the sharpest
  — `-Co "…" -File "<the wrapper>"`, because PowerShell resolves parameter
  **prefixes** and R46's exact-spelling list caught none of them. It also
  rounded `CYCLE_INTERVAL_MS=870001` to fifteen minutes where the installer now
  refuses it, so the two tools disagreed about what the policy says. The
  installer removed both tasks before registering either, so a failure on the
  second left the cycle running with no watchdog behind it; registration is one
  transaction now, and a failure rolls back to nothing rather than to half.
  Both wrappers lost their signal on a node binary that exists but is not a
  runnable image: the failure is non-terminating under the `Continue`
  preference the stderr trap requires, so try/catch never fired — the image is
  probed with `node --version` before it matters instead, and the refusal ping
  was verified against a real endpoint.

  **B10 was already closed and both instruments found it independently.** R47
  mutated `haltStateFrom` in `halt-state.ts` and all 651 tests still passed —
  against `ae85249`, which predates the isolation commit `adca01a` that my own
  mutation probe had forced for exactly the same reason. Two different
  instruments finding the same unmeasured test is the strongest evidence so far
  that the probe is calibrated.

  **The second cold read — the rebuilt clock, checked by a stranger with a
  calendar.** Most of it holds: the detection formula, the three derivations,
  all five numbers of drill (c), the UTC conversions, the 15:15 lead-in
  arithmetic, every weekday/date pair in both documents, and the derivation
  rules including the Sunday-to-Monday roll. What did not:

  * **Drill (a) needed 35 minutes and was given 30.** Detection at T+20, push
    by T+30, then “wait until it is green again” — which is 23:05, while drill
    (b) was scheduled for 23:00. The document's own rule forbids exactly that,
    so this was the same class of error one layer down. Re-spaced, with each
    drill's earliest start stated rather than a uniform grid.
  * **The cron window ends at 23:45 and nothing said so.** Past that the next
    expected ping is 14:00 the next weekday, so a T of 23:45 moves detection to
    the following afternoon and drill (c) cannot complete at all. Stated now,
    with a hard “23:30 or stop”.
  * **One T for two ping sources.** Drill (c) read the cycle log and applied
    that T to the watchdog too, which is pinged on a different schedule up to
    five minutes later. Two T values now.
  * **“15:20 local, five minutes into the session” is ten minutes before the
    open.** The alarm that the after-hours branch depends on rang while nothing
    could be done — in the paragraph that exists to prevent precisely that.
    15:35, and 14:35 in the clock-change week.
  * **The anchor could be moved into days where the gate cannot work:** the
    clock-change week (where the first trading firing is 14:15, half an hour
    *before* the 14:45 gate), a day after a US early close (19:00, not 22:00),
    and a run crossing the American spring change while Europe has not changed
    (session at 13:30, trigger window from 14:00). Three forbidden kinds, named.
  * **The anchor procedure never returned to the healthchecks.** A different
    coverage date can produce different cron expressions, and the three checks
    would have kept the old ones — the same class as swapping two ping URLs,
    which the document itself calls the mistake nothing later catches.
  * **The 30-minute “reserve” was real time and dead time**, because the gate
    is binary and nothing before it can borrow from after it. The reserve is
    the 25 minutes from 14:20 to 14:45, and it says so.
  * Smaller: the certificate block started at 15:15, before the open; it
    demanded that tasks be disabled on a day when they are not yet registered;
    `Get-Content journal.jsonl` was unguarded on the one path where the file
    does not exist; the process-environment-over-`.env` precedence that owner
    step 4 silently depends on is now stated **and verified by a command**; the
    `finally`-restores-on-Ctrl-C claim is softened to what it is; and the
    hard-coded check count, wrong three times in a row (35, 43, 49, and it
    differs again under `-ExpectEnabled`), is gone — the verifier prints the
    number and the operator's job is that it passed and did not change.

  `npm run verify` exit 0 at 48 files / 651 tests.
- **2026-09-06 — the runtime figure for `standingImpediment` was measured
  against a fixture that avoided the work; the real one is ten times larger.**
  The 162 ms / 500 MiB published on 2026-09-05 came from a synthetic journal of
  entries that fail validation, so `parseJournalText` stopped at the first line
  and the measurement described almost nothing. R47 measured it on 150 MiB of
  **valid** entries: **1.5 s and 1.2 GiB** of transient RSS — and found the
  reason it was that large, which is that the halt state and the corruption
  check each opened and parsed the file. They are one read now, so expect
  roughly half. Recorded rather than quietly replaced: “Grün ≠ korrekt” applies
  to measurements as much as to tests, and a fixture that skips the expensive
  path produces a number that is worse than no number, because it gets believed.

- **2026-09-06 — R47 fix-set mutation probe: 12 of 12.** Two new mutants for
  this round's blockers — marking after the journal read instead of before it,
  and a marker-only KILL mapped as non-sticky — both caught, alongside the ten
  from R44 through R46. `npm run verify` exit 0 at 48 files / **654 tests**.
- **2026-09-06 — owner-relayed review of `7041a8e`: five executed
  counter-examples and three inconsistencies, all confirmed, all closed with a
  regression test or an executable probe first.** None was refuted. Two of the
  five are defects that *this evening's own fixes* created, which is the useful
  part of the round.

  **1. The strongest stop did not survive the order the reasons arrived in.**
  An `AUTH_FAILURE` halt is journaled and marked; a `KILL` is then requested
  and its append fails. `markFenceBeforeHalt` returned early because a mark was
  already there, so the mark kept the weaker reason; `effectiveHaltState` read
  the journal first and found the softer halt; an ordinary `manualUnhalt`
  cleared both. The strongest stop in the system was erased by chronology. The
  merge is now by **strength, not by source order**: `strongerHalt` in the pure
  core, sticky outranking non-sticky, used by the gateway and by
  `standingImpediment` alike, and the mark records the strongest reason it has
  seen and is never downgraded. Three tests cover both arrival orders and the
  case that must still release. `haltIsSticky` replaces the rule that had been
  restated in three places.

  **2. The provenance guidance contradicted the new fence code and told the
  operator to delete a real stop.** Since every refused halt marks before it
  appends, a first-ever arming against a rejected account now leaves
  `fencePending: true, fenceReason: PROVENANCE_BROKEN` in `epoch.json` — with
  an empty journal and a clean `halt.json`, which is exactly where the runbook
  told the operator to look. “No fence to clear” was true when it was written
  and false by the time it was read, and the instruction that followed — empty
  `longrun-1` and continue — would have deleted a durable, sticky stop by hand.
  That is the one act the whole fence mechanism exists to make impossible. The
  guidance now names all three files, keeps the failed attempt, and requires a
  **new** state directory in both shapes of the failure. The existing
  first-start test asserts the marker, so the documentation cannot drift away
  from the code again without a test going red.

  **3. The scheduler verifier still took a foreign checkout, through a
  prefix.** PowerShell binds `-R` to `-RepoRoot`; the check read only the full
  spelling. This was the third round of the same shape — R46 forbade
  `-Command`, R47 found `-Co`, R47-B4 checked `-RepoRoot` by name and this
  found `-R` — so the fix is not a fourth forbidden spelling. The argument
  string is **parsed once, as a whole**, resolving every token by PowerShell's
  own prefix rule against the parameters that are legal in that position, and
  **anything that does not resolve to exactly one known parameter is itself a
  finding**. An executable probe covers a clean definition (must pass), the
  `-R`, `-Co` and `-N` prefixes, and an unknown parameter; the clean case
  passes and all four attacks fail on exactly the right check.

  **4. The watchdog cron expected two pings the task never produced.** The
  expression enumerates every five-minute step of every hour in range, so it
  expected 23:50 and 23:55, while the repetition duration ended at 23:45 for
  both tasks — a nightly silence alarm on a healthy deployment, due around
  00:05. Each task's window now ends at the last step of **its own** interval
  within the closing hour: 23:45 for the cycle, 23:55 for the watchdog. The
  probe reads the installer's own functions rather than re-implementing them,
  and compares produced firings against expected pings; both are now exact.
  (The asymmetry is deliberate: an unexpected extra ping only resets a timer,
  an expected missing one alarms.)

  **5. The after-hours path promised a cap the spec does not give.** “The
  maximum loss cannot grow overnight” holds for an **intact** structure and not
  for a residue: S-X-06 is the assignment exception to A23's constructive worst
  case, and the runner raises `UNBOUNDED_RESIDUE_RECOVERY` and closes such a
  residue with no price cap precisely because the realised cost may exceed the
  original maximum loss. Both documents now split the two cases, and the
  correct observation “no option can be sold at this hour” no longer implies
  “nothing can be done”: a share residue is an equity position, equities have
  extended-hours sessions, and the instruction is to look rather than assume.

  **The three inconsistencies.** The dates table still said the gate ran to
  15:05 while step 6 said 14:45. The anchor procedure re-read the external
  check schedules *after* repeating the drills, which would have measured the
  old schedules — it comes first now, with the reason. And the claim that the
  American spring change opens the session at 13:30 Berlin was **wrong**: 09:30
  New York on 2027-03-15 is 13:30 UTC and therefore 14:30 Berlin, exactly like
  the October mismatch. Verified against the zone tables. The forbidden-anchor
  rule survives for the right reason instead of the invented one — at a 14:30
  open the first trading firing is 14:15, before the gate — and the coverage
  claim is withdrawn.

  **The probe found one more thing than the review did.** With all five closed,
  the mutation probe was extended and reported a survivor: reverting
  `standingImpediment` to “journal first, mark only if clear” changed no test.
  The gateway's merge was covered and readiness's was not, so the operator
  could still have been told a releasable `AUTH_FAILURE` stands while the
  deployment carried an irreversible `KILL`. Test added; **15 of 15**.

  `npm run verify` exit 0 at 48 files / **658 tests**.
- **2026-09-05 — `COMPETITION_START` moved from 2026-09-06T00:00:00Z to
  2026-09-05T00:00:00Z, so the long run's account could be created the same
  evening.** The floor exists to prove an account was created **for this
  deployment** rather than carried over from an earlier one. Its old value was
  the hackathon's kickoff instant, which had nothing to say about a run
  starting three days later — and at 22:58 on Friday it sat two hours in the
  future, so the account the owner had just created (`PA3LPKKUDU97`,
  2026-09-05T20:58:48Z) failed the very clause it was created to satisfy.

  The new floor is the day the long run was prepared. It still excludes both
  earlier accounts by a wide margin — the dev account from 2026-08-24 and the
  hackathon account from 2026-09-02 — so the clause loses none of its force;
  it is the same rule with a date that belongs to this run instead of the
  previous one.

  **The second violation was a consequence, not a second problem**, and it is
  worth writing down because it looks alarming on its own: “activity ledger
  carries no opening funding journal”. An empty *complete* ledger is accepted
  as virgin evidence — the funding journal posts asynchronously and requiring
  it would block arming for as long as the broker takes — but only on an
  otherwise perfect snapshot (`violations.length === 0` at that line in
  `validateCompetitionProvenance`). With the creation-date violation present,
  the balance could not stand in for the funding record. Removing the first
  violation removes the second; no waiting for the broker was needed.

  `npm run verify` exit 0 at 48 files / 658 tests. The policy digest changed,
  which is exactly what voids a certificate — and none has been issued yet, so
  nothing was invalidated. Certificate run four runs against this value.
