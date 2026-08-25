# Behavioral Axioms — distilled from the scenario catalog

Provenance: distilled 2026-08-25 from [`docs/SCENARIOS.md`](SCENARIOS.md) (the
external standard, derived cold on 2026-08-24) per the house build order
Szenario → Axiom → Spec → Code. Unlike the scenario catalog, this distillation
was done warm (full repo context) — the cold requirement protects the
*standard*, and the standard stays SCENARIOS.md: the spec will be measured
against the catalog, not against this file.

Status: **DRAFT — pending owner review.** Three axioms carry open owner calls
(marked ⚑); they are listed at the end and decided in DECISIONS.md, not here.

Each axiom cites the scenarios it distills. The coverage index at the bottom
maps all 48 scenarios back to axioms — an uncovered scenario is a defect of
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

- **A5 — Intent before order; bijection recoverable.** For every order, an
  INTENT entry is journaled before submission and an outcome entry after.
  Rejections carry the broker's reason. After any single-point crash, journal
  and broker account reconcile to one consistent story — every broker event
  maps to a journaled decision and back, discrepancies themselves explained in
  the journal. (#17 #22 #31)

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
  fixed at order entry. Closes are whole structures (mleg), never leg-wise; a
  watchdog or unwind must not create a transient naked short. (#15 #19)

- **A12 — The LLM has no path to an order.** Only schema-valid,
  whitelist-constrained candidates enter the core; output failing validation is
  vetoed wholesale and journaled, never repaired. LLM unavailability, garbage,
  or truncation degrades the agent to position-managing (or inert-but-
  journaling) mode — never to a crash-loop, never to charitable execution.
  (#13 #14)

- **A13 — Single-writer, idempotent execution.** At most one decision-making
  instance acts on the account at a time (lock); a suppressed or skipped
  instance is a journaled fact. Client order IDs are deterministic, so a
  re-run cycle cannot double-send. A manual/demo trigger is a normal cycle
  under the same lock. The agent writes only the dedicated journal branch;
  humans never do — submission work and agent pushes cannot collide. (#8 #23
  #40 #44)

- **A14 — Budgets reserve at submit; positions derive from fills.** Sleeve
  accounting = Alpaca fills + open-order reservations + journaled intents,
  never the journal alone and never order quantity as position quantity. A
  resting remainder is a tracked object, not a surprise. (#5 #16)

- **A15 — Price is bounded by the decision.** Every order is a limit order
  priced from the quotes the decision was made on; a fill materially worse
  than the decision's assumptions is structurally prevented (limit) and any
  deviation is journaled, not silently absorbed. (#20)

- **A16 — The exchange calendar, not the clock.** Tradability comes from the
  exchange's actual calendar and observed market behavior; "clock says open"
  is never sufficient, and closed-market firing (weekends, holidays, after
  hours) is a defined, harmless, journaled behavior. (#25 #30 #41 #47)

- **A17 — No position meets its expiry.** Forced eviction no later than the
  session before expiry day; everything flat by Thu Sep 3 market close; Friday
  Sep 4 holds no risk and requires no human attention. Near-expiry risk is
  handled by unattended cycles, never deferred to a provably busy human.
  (#6 #7 #19 #44 #45)

## IV. Silence, stopping, time

- **A18 ⚑ — Silence is detectable.** The absence of cycles during market
  hours becomes actively knowable to the developer within a bounded time —
  via a channel that does not require the dead machine's cooperation. No
  failure mode is pure silence; a later reader sees an explicit gap. Bound
  and channel: owner call C. (#1 #10 #24 #26)

- **A19 ⚑ — Stop is verifiable and scoped; the panic path is pre-designated.**
  A calm stop (halt flag) provably survives the next scheduled fire; what
  happens to open positions and working orders under stop is defined and
  known. For panic, one fastest-available action that certainly prevents the
  next order is designated in advance, works away from the machine, and its
  effect is verifiable. Choice of panic path: owner call D. (#33 #34)

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

- **A22 ⚑ — Artifacts stand alone.** Dashboard, journal repo, and account
  remain accessible and self-explanatory for weeks after submission with zero
  maintenance; the post-deadline trajectory of the account is chosen and
  documented in advance, and a journal-visible moment reconciles "what was
  submitted" with "what the account shows". Post-deadline regime: owner
  call B. (#6 #37 #45 #46 #48)

- **A23 ⚑ — The unattended worst case is bounded and pre-accepted.** The
  majority operating condition is: market open, developer unreachable for
  3–8 hours. Every failure mode's worst case within that window is bounded
  without human intervention, and the bound is accepted by the owner in
  advance. The structural backstop is construction: even with host, watchdog,
  and network all dead, loss is capped at the sum of open positions' max
  losses, itself capped by the sleeve budgets. Acceptance: owner call A.
  (#42, and every B-class scenario re-read under it)

---

## Open owner calls

| Call | Axiom | Question |
|---|---|---|
| A | A23 | Accept combined sleeve budget (~20 % / $20k paper) as the worst case for an N-hour unattended window? |
| B | A22 | Post-deadline regime: when does the agent stop, and what does Friday look like after 17:00? |
| C | A18 | Silence-detection bound (minutes) and channel (dead-man service / push / mail)? |
| D | A19 | Designated panic path (API-key revocation at Alpaca vs. remote halt flag)? |

Decisions land in DECISIONS.md; this file then loses the ⚑ marks (as a dated
edit — this file is not append-only, the journal is).

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

The catalog's own spine (broker truth / detectable silence / journal-account
bijection) maps to A1–A2, A18, and A5 respectively — the spec review checks
those three families first.
