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
