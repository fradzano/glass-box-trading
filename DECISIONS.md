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
  order ID; a never-confirmed order the broker does not know is released as
  `RECONCILIATION` `NOT_SUBMITTED`, a formerly working order that vanished
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
