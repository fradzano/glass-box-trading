# Behavioral Axioms — distilled from the scenario catalog

Provenance: distilled 2026-08-25 from [`docs/SCENARIOS.md`](SCENARIOS.md) (the
external standard, derived cold on 2026-08-24) per the house build order
Szenario → Axiom → Spec → Code. Unlike the scenario catalog, this distillation
was done warm (full repo context) — the cold requirement protects the
*standard*, and the standard stays SCENARIOS.md: the spec will be measured
against the catalog, not against this file.

Status: **reviewed 2026-08-25** (owner-directed blind/gate pass — limited, not
a terminated bis-0 run). Findings folded in as dated edits: one A finding
(missing account binding → new A24) and several B findings (A23 exposure
counting, A11 leg-wise recovery, pre-submit revalidation in A13, working-order
ownership across halts in A16, the concrete "why" per fill in A5). The four
owner calls (A–D) were decided 2026-08-25 — see DECISIONS.md; the axioms below
cite the decisions where they bind parameters.

Each axiom cites the scenarios it distills. The coverage index at the bottom
maps all 71 scenarios back to axioms — an uncovered scenario is a defect of
this file.

---

## I. State truth

- **A1 — Broker truth over memory.** Every decision is made against account
  state (positions, open orders, cash) fetched from Alpaca within the same
  cycle. No decision ever rests on what a previous cycle believed, on in-memory
  caches, or on state that did not survive a restart. (#4 #5 #9 #43)

- **A2 — Unexplained state halts entries.** At cycle start, every broker
  position and working order is classified against the journal's known
  structures. Anything unclassified — assignment residue, a half-filled spread,
  a manual human trade, a lost-ack fill — is journaled as an event, driven
  toward a resolved state (closed as a whole structure at next opportunity),
  and blocks new entries until resolved. A human acting on the account is
  recorded as exactly that, never absorbed silently. (#8 #11 #15 #18)

- **A3 — Sufficiency before action.** Decisions are made only on data the
  system has positive reason to believe current and complete; snapshot age is
  a core input with a staleness bound. A half-answering broker (positions yes,
  orders no; stale quotes; empty chain), a halted underlying, or a fast market
  that invalidates the snapshot leads to abstention — never to confident wrong
  action. (#12 #20 #30)

## II. Journal

- **A4 — Every cycle leaves a record.** Traded, rejected-with-reason,
  did-nothing-because-X, skipped (LLM down, market closed), or
  could-not-reach-world (written as soon as connectivity allows). "Alive but
  chose not to trade" is distinguishable from "dead" at per-cycle granularity.
  (#2 #3 #11 #13 #24 #29)

- **A5 — Intent before order; bijection recoverable.** Every risk-increasing
  order and every ordinary close has a durable INTENT before submission and an
  outcome entry after. The
  intent carries the concrete rationale — sleeve, expected distribution, gate
  verdicts, the why — so every broker fill maps to a stated reason, not merely
  to a decision ID. Rejections carry the broker's reason. After any single-point crash, journal
  and broker account reconcile to one consistent story — every broker event
  maps to a journaled decision and back, discrepancies themselves explained in
  the journal. Sole safety exception: when the journal append alone is
  unavailable but writer authority remains valid, a mechanically
  risk-reducing emergency close may use an existing exposure identity and
  deterministic client order ID. It creates no new exposure and never pretends
  a prior rationale existed; the first successful append records the broker
  outcome and explicit audit gap. (#17 #22 #31 #53)

- **A6 — Append-only, crash-bounded.** Journal entries are never edited or
  regenerated; corrections are new entries. A hard power cut corrupts at most
  the single in-flight record, never recoverable history. (#22 #26)

- **A7 — Recording failure is trading failure.** If the journal cannot be
  appended locally, no new entries are opened. (Push/publish failure is
  freshness, not recording — see A9.) (#27)

- **A8 — No secrets in the public path.** Nothing secret can transit journal,
  dashboard, or any repo-bound output — including error and debug output, LLM
  prompt/response dumps, and git history. Public-forever is assumed at write
  time. (#29 #37 #48)

- **A9 — Publishing may lag, never lie.** The rendered dashboard diverges from
  the journal only in freshness, never in content; staleness is visible
  (last-updated stamp), and the worst credible momentary state is still
  coherent and self-describing. The developer's five-minute debrief (what
  happened, what's open, why) works from it without archaeology. (#21 #32 #39)

- **A10 — Claims match the paper ledger.** Write-up and dashboard assert only
  what the paper environment, as it actually behaved (its quirks included),
  will back on inspection. (#28 #31 #38)

## III. Orders and risk

- **A11 — Defined risk at construction, everywhere.** No code path — including
  safety mechanisms — may create or transit a position whose max loss is not
  fixed at order entry. Closes of *intact* multi-leg structures are whole
  structures (mleg), never leg-wise. Recovery from an *already-broken*
  structure (assignment residue, orphan fill of one leg) may act leg-wise
  where each step strictly reduces risk — the prohibition is on *creating* an
  uncovered short that did not already exist, not on risk-reducing repair.
  (#15 #18 #19)

- **A12 — The LLM has no path to an order.** Only schema-valid,
  whitelist-constrained candidates enter the core. Validation failure has two
  levels (sharpened 2026-08-25, spec-pass finding DOM-2, previously ambiguous
  "wholesale"): a *structural* failure (unparseable, schema-violating,
  truncated output) discards the entire analyst output — nothing in it is
  trustworthy; a *semantic* whitelist violation vetoes that candidate while
  well-formed siblings are still evaluated. Both are journaled, nothing is
  ever repaired silently. The analyst process receives a positive, versioned
  read-only MCP capability manifest, dev data-account credentials only, and no
  executor shell/CLI environment. Startup compares the actual offered tool
  inventory and the name/version of the distribution from the exact launch
  interpreter with that manifest. A separate tracked runtime lock anchors an
  immutable official upstream commit, frozen dependencies, interpreter bytes,
  and immutable package content independently of the installed environment;
  any source, package, dependency, interpreter, or capability drift blocks
  arming. Observed bytes never become their own expected hash. The verified
  launch identity and manifest enter the certificate-bound `runtimeDigest`. LLM
  unavailability, garbage, or truncation degrades
  the agent to position-managing (or inert-but-journaling) mode — never to a
  crash-loop, never to charitable execution. (#13 #14 #58)

- **A13 — Single-writer, idempotent execution.** At most one decision-making
  instance acts on the account at a time. Every authoritative mutation carries
  the current control epoch and revalidates it at the final gateway; an OS lock
  serializes local work but never authorizes it. A suppressed or skipped
  instance is a journaled fact. Entry IDs are deterministic, while every
  exposure has one route-independent close lifecycle with at most one
  non-terminal attempt, so replay or emergency routing cannot double-send or
  over-close. A manual/demo trigger is a normal cycle under the same gateway.
  Between core approval and submission, the executor
  revalidates that the decision's preconditions still hold against fresh
  broker state — a concurrent change (a manual human action, an order filled
  meanwhile) voids the action, journaled as such. The completion of that
  fresh read is the declared linearization point: a change landing between
  it and broker acceptance is unobservable without a broker-side conditional
  submit, so manual mutations are prohibited while the agent operates, and a
  violation surfaces as a halt in the next cycle's phase 0 rather than
  passing silently. The agent writes only the
  dedicated journal branch; humans never do — submission work and agent pushes
  cannot collide. (#8 #23 #40 #44)

- **A14 — Budgets reserve at submit; positions derive from fills.** Sleeve
  accounting = Alpaca fills + open-order reservations + journaled intents,
  never the journal alone and never order quantity as position quantity. A
  resting remainder is a tracked object, not a surprise. G1–G4, INTENT,
  reservation, revalidation, and submit share one `reservedMaxLoss` computed
  from the least favourable fill permitted by the exact final net entry limit.
  (#5 #16 #63)

- **A15 — Price is bounded by the decision.** Every order is a limit order
  priced from the quotes the decision was made on; a fill materially worse
  than the decision's assumptions is structurally prevented (limit) and any
  deviation is journaled, not silently absorbed. (#20)

- **A16 — The exchange calendar, not the clock.** Tradability comes from the
  exchange's actual calendar and observed market behavior; "clock says open"
  is never sufficient, and closed-market firing (weekends, holidays, after
  hours) is a defined, harmless, journaled behavior. Working orders are owned
  across untradable conditions: on a detected halt, every working order is
  either canceled or explicitly journaled as deliberately held — nothing
  rides a reopen unowned. (#25 #30 #41 #47)

- **A17 — No risk-bearing position meets its expiry.** Forced eviction begins
  no later than the session before expiry day; everything risk-bearing is flat
  by Thu Sep 3 market close and Friday Sep 4 accepts no new risk. Sole exception:
  S-X-06 may terminally classify a broker-visible `DECLARED_EXPIRY_HOLD` only
  after fresh evidence proves the residue long-only, unsellable, out of the
  money, protected from exercise, and incapable of additional liability. It
  remains visible as not-flat until expiry. Near-expiry risk is handled by
  unattended cycles, never deferred to a provably busy human. (#6 #7 #19 #44
  #45 #55)

- **A24 — Orders bind to the designated account.** The executor may place,
  modify, or cancel orders only against the one explicitly configured paper
  account for its role (competition account from arming; dev account only for
  pre-arm testing). Account selection is an explicit parameter
  (`ALPACA_PROFILE`), never a default or a fallback, and live-trading
  endpoints are structurally unreachable. Before startup and every mutation,
  the role is bound to the exact canonical Alpaca paper-trading origin and the
  independently configured expected account ID; redirects, aliases and a
  matching ID from a live origin still fail closed. Market-data origins are
  validated separately. *Requirement-derived* (CONCEPT §6
  and the repo invariants), not scenario-derived — added 2026-08-25 after the
  review's A finding: without it, all other axioms could be satisfied on the
  wrong account. (#61)

- **A25 — The judged account has a provable competition provenance.** The
  submitted Alpaca paper account is brand-new, dedicated to this hackathon,
  starts at $100,000, and contains no development or manual trading. Its
  literal account ID binds every order-related record. Before any competition
  order, `BOOTSTRAP` proves creation at or after kickoff, exact $100,000 opening
  cash/equity, no positions or orders, and fully paginated empty trading
  history. Missing evidence or later manual activity sets an irreversible
  provenance-broken latch: entries halt and SUB-08 cannot pass, although
  risk-reducing cleanup remains permitted. The recorded kickoff, first eligible
  cycle, flatten, and deadline snapshots expose the actual
  competition interval; a missed partial session is reported as a delay, not
  silently rewritten into a five-session event. (#49 #52 #54)

## IV. Silence, stopping, time

- **A18 — Silence is detectable.** The absence of cycles during market
  hours becomes actively knowable to the developer within a bounded time —
  via a channel that does not require the dead machine's cooperation. No
  failure mode is pure silence; a later reader sees an explicit gap.
  Decided (owner call C, 2026-08-25): 45–60 minutes as an *absolute* SLA, via
  an external dead-man check (healthchecks.io) whose schedule follows the
  actual `America/New_York` session slots; the ping fires only after a
  durable local journal append. Active failure pings are failure-only and do
  not require a successful append. If `STATE_DIR` cannot open, a separately
  pre-armed OS diagnostic sink records the redacted startup failure; it is
  never an alternate journal, epoch, or halt authority. The residual SaaS blindness is declared under
  A23 — two delivery paths of one service are not two detectors.
  (#1 #10 #24 #26 #56)

- **A19 — Stop is verifiable and scoped; the panic path is pre-designated.**
  A calm stop (halt flag) provably survives the next scheduled fire; what
  happens to open positions and working orders under stop is defined and
  known. For panic, one fastest-available action that certainly prevents the
  next order is designated in advance, works away from the machine, and its
  effect is verifiable. Decided (owner call D, 2026-08-25): the halt flag is
  the calm stop; broker-side key rotation is a credential *fence*, not an
  atomic stop — working orders survive it and their cancellation is a
  separate operation, so the fence is relied on only after a dev-account
  drill, and it is always followed by a working-order check/cancel in the
  broker dashboard. Re-arm happens only under halt, after full
  reconciliation. A drawdown kill likewise cancels and reconciles every
  risk-increasing non-terminal entry before it reloads and flattens the
  resulting book; cancel/fill uncertainty remains exposure, and flat is never
  declared while such an order exists. (#33 #34 #64)

- **A20 — Resume from reality.** The first cycle after any gap — stop, crash,
  reboot, sleep, overnight — re-derives state from the broker, journals the
  gap explicitly (paused/dark from–to, state then vs now), and behaves like
  exactly one cycle: no catch-up trading. Journal-vs-broker agreement is
  checkable as a single cheap operation, and disagreement is displayed, not
  discovered. (#9 #35 #36 #43)

- **A21 — One timezone discipline.** All market-hours logic and all journal
  timestamps rest on one explicit timezone convention, mappable 1:1 onto
  broker timestamps by a third party; every artifact tells one consistent
  calendar story. (#25 #38)

## V. Lifecycle

- **A22 — Artifacts stand alone.** Dashboard, journal repo, and account
  remain accessible and self-explanatory for weeks after submission with zero
  maintenance; the post-deadline trajectory of the account is chosen and
  documented in advance, and a journal-visible moment reconciles "what was
  submitted" with "what the account shows". Decided (owner call B,
  2026-08-25): Friday is journaling-only — Thursday close means zero
  risk-bearing positions and zero non-terminal orders. The sole permitted
  broker remainder is A17's visible, non-exercising `DECLARED_EXPIRY_HOLD`,
  which requires no mutation before expiry; at 17:00 CEST a dedicated
  `DEADLINE_RECONCILIATION`
  cycle records a full broker snapshot and references the submitted revision;
  at US close a final snapshot establishes the durable terminal state and
  scheduler plus dead-man expectation end in a controlled way. Immutable
  submitted uploads stay unchanged. The public journal/dashboard may append
  the labelled deadline and terminal snapshots and is frozen thereafter; all
  judge-facing surfaces stay available at least through judging.
  (#6 #37 #45 #46 #48)

- **A23 — The unattended worst case is bounded and pre-accepted.** The
  majority operating condition is: market open, developer unreachable for
  3–8 hours. Every failure mode's worst case within that window is bounded
  without human intervention, and the bound is accepted by the owner in
  advance. The structural backstop is construction: even with host, watchdog,
  and network all dead, loss is capped at the sum of max losses of all open
  *exposure* — filled positions AND fillable or confirmation-unclear entry
  orders — itself capped by the sleeve budgets. Decided (owner call A,
  2026-08-25): accepted bound is at most **$12,000 income + $8,000 convex
  max loss against the initial $100,000 paper capital**. Exposure is counted
  once per exposure-lifecycle identity: a filled position plus its fillable
  or confirmation-unclear entry remainder or INTENT is one identity; partial
  fills split into filled portion and remaining reservation; exit orders are
  not counted additionally. The $20,000 construction is bounded only because
  every reservation is computed from the least favourable
  fill permitted by the exact submitted entry limit; quote mid or hoped-for
  premium never reduces the reserved amount. Price improvement is released
  only after reconciliation. $20,000 is the *declared constructive paper worst
  case*, not a guarantee against broker, assignment, or liquidation
  mechanics. (#42, and every B-class scenario re-read under it)

- **A26 — Submission completeness is an acceptance gate.** Every required
  form field, file, public repository, demo URL, account ID, and one-page
  write-up has a named artifact and format constraint. Before submission, an
  unauthenticated clean-browser check proves that the exact URLs and revision
  a judge first receives are accessible and mutually consistent. Every
  post-submission journal/dashboard append is first deployed to an immutable
  candidate URL and anonymously probed there. Only an accepted candidate may
  atomically replace the stable submitted alias; failure leaves that alias on
  the prior accepted deployment and alarms. Local success is not evidence for
  a public surface. (#50 #51)

- **A27 — Every judging claim resolves to observable evidence.** The four
  event-specific criteria each have a short, stable judge path: broker-backed
  P&L; meaningful AI and Alpaca integration; the public veto/no-trade journal
  as the original mechanism; and a presentation that demonstrates one
  decision end-to-end without requiring a new live trade. All surfaces share
  account identity, provenance, and reconciliation rules. Immutable uploads use
  a labelled Sep 3 presentation cutoff; the public journal/dashboard may add
  the labelled Sep 4 deadline cutoff without rewriting those uploads. Numbers
  are compared only at equal cutoffs. (#31 #40 #50 #52)
  A broker fill from an ordinary core-approved competition options intent is a
  necessary, not sufficient, part of this project's P&L story. Its absence at
  Sep 1 US close becomes a visible competitiveness alarm and opens only a
  stricter-risk, one-lot, normal-gates-only window through Sep 2; it never
  authorizes a forced trade. Continued absence fails internal winning
  acceptance while external eligibility remains an organiser question. (#65)

- **A28 — Arming is an evidenced transition, never a timestamp assertion.**
  Mandatory policy bounds and the analyst's observed read-only capability
  inventory validate fail-closed. `successful_dev_live_test_at` is derived only
  from a machine-readable dev-account certificate tied to the deployed runtime
  `runtimeDigest` and role-neutral `policyDigest`. It proves exact one-lot
  credit-mleg acceptance (broker identity, legs, quantity, and limit all equal
  the INTENT), a quantitatively exact broker fill through OUTCOME/reconciliation,
  fresh quote-size/liquidity inputs, and a terminal dev
  account with zero positions and non-terminal orders. Missing, partial, stale,
  unstable, or mismatched evidence blocks competition arming. The certificate
  is integrity-checked under the trusted-local-operator threat model; it is not
  an independent signature against a malicious local forger. Only the closed
  profile/account/credential identity set and the closed host-local deployment
  locations change from dev proof to competition arm and are verified
  separately; the paper origin stays policy and unknown config fields fail
  closed. (#57 #58 #59 #62 #69 #71)

---

## Owner calls — all decided 2026-08-25

| Call | Axiom | Decision (summary — full wording in DECISIONS.md) |
|---|---|---|
| A | A23 | Worst case accepted: $12k income + $8k convex vs. initial $100k; counted once per exposure-lifecycle identity |
| B | A22 | Friday journaling-only; zero risk-bearing positions (narrow A17 expiry-hold exception); `DEADLINE_RECONCILIATION` at 17:00 CEST |
| C | A18 | 45–60 min absolute SLA; success ping after durable append, active failure ping may precede it |
| D | A19 | Halt flag = calm stop; key rotation = fence only (post-drill), always followed by working-order check |

## Coverage index (scenario → axioms)

| # | Axioms | # | Axioms | # | Axioms | # | Axioms |
|---|---|---|---|---|---|---|---|
| 1 | A2 A4 A18 | 13 | A4 A12 | 25 | A16 A21 | 37 | A8 A9 A22 |
| 2 | A4 | 14 | A12 | 26 | A6 A18 | 38 | A10 A21 |
| 3 | A4 A9 | 15 | A2 A11 | 27 | A7 | 39 | A9 |
| 4 | A1 | 16 | A14 | 28 | A10 | 40 | A13 |
| 5 | A1 A14 A16 | 17 | A5 | 29 | A4 A8 | 41 | A16 |
| 6 | A17 A22 | 18 | A2 | 30 | A3 A16 | 42 | A23 |
| 7 | A17 | 19 | A11 A17 | 31 | A5 A10 | 43 | A1 A20 |
| 8 | A2 A13 | 20 | A3 A15 | 32 | A9 | 44 | A13 A17 |
| 9 | A1 A20 | 21 | A9 | 33 | A19 | 45 | A17 A22 |
| 10 | A18 | 22 | A5 A6 | 34 | A19 | 46 | A22 |
| 11 | A2 A4 A5 | 23 | A13 | 35 | A20 | 47 | A16 |
| 12 | A3 | 24 | A4 A18 | 36 | A20 | 48 | A8 A22 |

| # | Axioms | # | Axioms | # | Axioms | # | Axioms |
|---|---|---|---|---|---|---|---|
| 49 | A21 A24 A25 | 50 | A9 A26 A27 | 51 | A26 | 52 | A5 A10 A25 A27 |

| # | Axioms | # | Axioms | # | Axioms | # | Axioms |
|---|---|---|---|---|---|---|---|
| 53 | A5 A7 | 54 | A24 A25 | 55 | A11 A17 A22 | 56 | A8 A18 |
| 57 | A12 A28 | 58 | A12 A13 A28 | 59 | A24 A28 | 60 | A11 A13 A18 |

| # | Axioms | # | Axioms | # | Axioms | # | Axioms | # | Axioms |
|---|---|---|---|---|---|---|---|---|---|
| 61 | A24 | 62 | A12 A28 | 63 | A14 A23 | 64 | A1 A13 A19 A23 | 65 | A27 |

| # | Axioms | # | Axioms |
|---|---|---|---|
| 66 | A26 | 67 | A26 A27 |

| # | Axioms | # | Axioms | # | Axioms | # | Axioms |
|---|---|---|---|---|---|---|---|
| 68 | A13 | 69 | A24 A28 | 70 | A5 A13 | 71 | A12 A28 |

A24 originally appeared in no row by design: it was requirement-derived
(account separation), not scenario-derived. Scenario #49 now supplies the
external event-account anchor that the original cold brief lacked.

The catalog's own spine (broker truth / detectable silence / journal-account
bijection) maps to A1–A2, A18, and A5 respectively — the spec review checks
those three families first.
