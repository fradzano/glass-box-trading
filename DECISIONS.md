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
  for `6677b24`) is the counter-verification of record; its verdict is
  recorded in the entry below.
