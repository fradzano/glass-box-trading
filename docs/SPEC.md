# Spec — cases per gate (the red-first test oracle)

Provenance: concretized 2026-08-25 from [`docs/AXIOMS.md`](AXIOMS.md) (24
axioms, owner-reviewed) per the build order Szenario → Axiom → Spec → Code.
This spec is *measured against* [`docs/SCENARIOS.md`](SCENARIOS.md) — the
catalog is never edited to fit this file. Every case cites the axioms it
concretizes. Case IDs are stable: tests reference them (`S-G2-06`), and the
first implementation step is writing them red.

Status: draft for the capped adversarial pass (2–3 rounds, owner-agreed
deviation from the full bis-0 end condition — DECISIONS.md 2026-08-24).

## 0. Configuration symbols

Frozen values are owner decisions; symbols marked *O5* are frozen before
go-live Mon Aug 31 and journaled as config. The core receives config as a
parameter — no constant below may be hardcoded in core logic.

| Symbol | Value | Basis |
|---|---|---|
| `INCOME_BUDGET` | $12,000 | max-loss basis (owner call A) |
| `CONVEX_BUDGET` | $8,000 | premium-paid basis (owner call A) |
| `INITIAL_CAPITAL` | $100,000 | competition start |
| `FLATTEN_DATE` | 2026-09-03 (Thu) | gate G11 |
| `SUBMISSION_DEADLINE` | 2026-09-04 17:00 CEST | decision B |
| `MAX_LOSS_PER_POSITION_FRAC` | *O5* | fraction of sleeve budget |
| `MAX_UNDERLYING_EXPOSURE` | *O5* | per-underlying cap, $ |
| `MAX_REL_SPREAD` | *O5* | liquidity gate, per leg |
| `MIN_QUOTE_SIZE` | *O5* | liquidity gate, per leg |
| `QUOTE_MAX_AGE` | *O5* | seconds |
| `SNAPSHOT_STALENESS_BOUND` | *O5* | seconds; actions void beyond it |
| `KILL_EQUITY_THRESHOLD` | *O5* | must price in planned convex decay |
| `DEAD_MAN_BOUND` | ≤ 45 min effective | decision C: 45–60 min SLA incl. grace |
| `CYCLE_INTERVAL` | *O5* | 15–30 min during US session |
| `UNDERLYING_UNIVERSE` | *O5* | liquid ETF class (SPY/QQQ …) |
| `STRUCTURE_WHITELIST` | *O5* | vertical debit/credit, iron condor, long option |

## 1. Core contract

`decide(snapshot, candidates, config, now) → { verdicts, actions }` — pure:
no I/O, no clock, no randomness, no environment. Same inputs produce
identical outputs. (A1, A3; house FCIS rule)

**Snapshot** (assembled by the shell, one fetch per cycle): account id +
profile role, cash, equity, positions, ALL open orders, halt flag, exchange
calendar segment for today, quotes for candidate and position legs (each
quote carrying its own timestamp), `snapshotAt`.

- **S-CORE-01** Given identical (snapshot, candidates, config, now), when
  `decide` runs twice, then outputs are deeply equal. (FCIS)
- **S-CORE-02** Given `now − snapshotAt > SNAPSHOT_STALENESS_BOUND`, when
  `decide` runs, then it returns zero order actions and a verdict
  `STALE_SNAPSHOT` — regardless of candidate quality. (A3)
- **S-CORE-03** All entry gates are evaluated for every candidate and every
  verdict is recorded (no short-circuit hiding later gates); one failing gate
  vetoes the action, but the journal shows the full verdict vector. (A4, A5)

## 2. Cycle phases (shell behavior, tested against fakes)

Phases per CONCEPT §3: 0 reconcile → 1 snapshot → 2 analyst → 3 core →
4 executor → 5 journal/publish.

- **S-CYC-01** Analyst error / timeout / 429, when the cycle runs, then
  phases 0–1 and 3–5 still run with `candidates = []` (management-only), a
  `SKIP` reason is journaled, and the process exits cleanly — no crash-loop,
  no retry storm. (A4, A12)
- **S-CYC-02** Broker API half-answer (positions OK, orders endpoint fails —
  or vice versa), then the snapshot is marked incomplete, the core receives
  no candidates and emits no order actions, and the cycle journals
  `WORLD_UNREACHABLE`/`WORLD_PARTIAL`. Abstention, not confident action. (A3)
- **S-CYC-03** Total connectivity loss, then the cycle journals
  `WORLD_UNREACHABLE` locally as soon as the append is possible; the entry is
  written even though no broker data exists. (A4)
- **S-CYC-04** Order submitted, acknowledgment lost (timeout after send),
  then the order is journaled `CONFIRMATION_UNCLEAR`, its budget reservation
  is retained, and the next cycle's phase 0 resolves it by client order ID
  against the broker BEFORE any new order is placed. (A2, A5, A23)
- **S-CYC-05** Pre-submit revalidation: between core approval and submission
  the executor refetches positions + open orders; if the delta touches the
  action's preconditions (position appeared/disappeared, human traded, an
  order filled meanwhile), the action is voided and journaled `REVALIDATION_
  VOID` — never submitted "because the core said so". (A13)
- **S-CYC-06** Local journal append fails (disk full, lock), then no entry
  order is submitted this cycle; risk-reducing closes remain permitted with
  best-effort logging; the condition itself is surfaced on the next
  successful append. (A7)
- **S-CYC-07** `git push` fails, then trading and local journaling continue;
  push is retried next cycle; the dashboard shows its last-updated stamp.
  Freshness may lag, content may not lie. (A9)
- **S-CYC-08** First cycle after any gap (reboot, sleep, stop, overnight):
  phase 0 re-derives everything from the broker, journals the gap (`GAP`,
  from–to, state then vs. now), and the cycle behaves as exactly one cycle —
  no catch-up trading, no doubled aggression. (A1, A20)

## 3. Entry gates

### G1 — defined risk only (A11)

- **S-G1-01** Vertical debit spread → accepted; `maxLoss = netDebit × 100 ×
  qty`.
- **S-G1-02** Vertical credit spread → accepted; `maxLoss = (width − credit)
  × 100 × qty`.
- **S-G1-03** Iron condor → accepted; `maxLoss = (widest wing − net credit)
  × 100 × qty`.
- **S-G1-04** Long single option → accepted; `maxLoss = premium × 100 × qty`.
- **S-G1-05** Naked short option (any leg pattern leaving an uncovered
  short) → veto `DEFINED_RISK`.
- **S-G1-06** Ratio spread with net short side → veto `DEFINED_RISK`.
- **S-G1-07** Structure whose max loss cannot be computed from its legs →
  veto `DEFINED_RISK` (independently of the whitelist).
- **S-G1-08** Degenerate "spread" (two legs, same contract) → veto.

### G2 — sleeve budgets (A14, A23)

Exposure counting rule (owner call A): one *exposure-lifecycle identity* =
filled position + its fillable or confirmation-unclear entry remainder or
INTENT, counted exactly once; partial fills split into filled portion and
remaining reservation; exit orders reserve nothing.

- **S-G2-01** Income candidate with `maxLoss ≤` remaining income budget →
  pass; equality passes (≤).
- **S-G2-02** Candidate exceeding remaining sleeve budget by $1 → veto
  `BUDGET`.
- **S-G2-03** Reservation at approval: two candidates in one cycle are
  evaluated sequentially; the second sees the budget minus the first's
  reservation.
- **S-G2-04** Open fillable entry order counts against its sleeve even
  before any fill.
- **S-G2-05** `CONFIRMATION_UNCLEAR` order counts as reserved until
  reconciled (S-CYC-04).
- **S-G2-06** Partial fill 4/10: filled 4 count as position max loss,
  resting 6 as reservation; total equals the 10-lot reservation, counted
  once.
- **S-G2-07** Exit (closing) orders reserve no budget and release the
  identity's reservation only on terminal state (filled/canceled).
- **S-G2-08** Sleeves are disjoint: an income candidate can never draw
  convex budget, and vice versa; sleeve tag comes from the validated
  candidate and is journaled. (A5)

### G3 — max loss per position

- **S-G3-01** `maxLoss ≤ MAX_LOSS_PER_POSITION_FRAC × sleeve budget` → pass
  (equality passes); above → veto `POSITION_SIZE`.

### G4 — per-underlying concentration

- **S-G4-01** Sum of exposure (filled + reserved, both sleeves) per
  underlying after the candidate `≤ MAX_UNDERLYING_EXPOSURE` → pass;
  above → veto `CONCENTRATION`.

### G5 — liquidity (A3)

Per leg, all of: `bid > 0`, market not crossed, `(ask − bid) / mid ≤
MAX_REL_SPREAD`, quote size ≥ `MIN_QUOTE_SIZE`, quote age ≤ `QUOTE_MAX_AGE`.

- **S-G5-01** All legs pass → pass.
- **S-G5-02** One leg fails any criterion → whole structure veto
  `LIQUIDITY` (with the failing leg named).
- **S-G5-03** Missing quote for a leg → veto (absence is failure, not
  pass-through).

### G6 — session and tradability (A16)

- **S-G6-01** Exchange calendar says open AND clock inside the session →
  orders possible.
- **S-G6-02** Weekend/holiday/after-hours per calendar → every order action
  vetoed `SESSION`; the cycle still journals normally (defined harmless
  closed-market behavior).
- **S-G6-03** Session boundaries come from the calendar's actual times
  (half-days included), never from hardcoded 09:30/16:00.
- **S-G6-04** Mon Aug 31 2026 is a normal session; Labor Day is Sep 7 —
  asserted via calendar fixture, not code. (#47)
- **S-G6-05** Underlying with frozen/stale quotes while the clock says open
  (halt heuristic) → veto for that underlying; every working order on it is
  either canceled or journaled as deliberately held. Nothing rides a reopen
  unowned.

### G7 — idempotency (A13)

- **S-G7-01** Client order ID is a deterministic function of (trading day,
  cycle index, structure identity, action kind); same inputs → same ID;
  different cycle → different ID.
- **S-G7-02** Re-submission of an already-submitted ID (crash replay) →
  broker duplicate response is treated as "already submitted": reconcile,
  journal, do not error and do not re-send with a fresh ID.

### G8 — schema and whitelist (A12)

Spec decision **D-SPEC-1** (reversible): *structural* failure (invalid JSON,
schema mismatch) drops the entire analyst output; a *semantic* whitelist
violation (well-formed candidate, out-of-policy value) vetoes that candidate
and the rest are still evaluated. Rationale: after a structural failure
nothing in the payload is trustworthy; a policy violation is contained.

- **S-G8-01** Invalid JSON / schema mismatch / truncated output → whole
  output dropped, `SCHEMA_VETO` journaled, cycle continues management-only.
- **S-G8-02** Refusal prose or any non-candidate text where candidates
  belong → same as S-G8-01. Nothing is executed on charity.
- **S-G8-03** Candidate with underlying outside `UNDERLYING_UNIVERSE`,
  structure outside `STRUCTURE_WHITELIST`, expiry outside the allowed
  window, strike outside the allowed band, or qty above the ceiling → that
  candidate vetoed `WHITELIST` with the offending field named.
- **S-G8-04** No silent repair, ever: an out-of-range qty is vetoed, not
  clamped; a misspelled symbol is vetoed, not corrected.
- **S-G8-05** Candidate referencing a contract absent from the fetched chain
  (nonexistent/expired/typo) → veto `UNKNOWN_CONTRACT`. (#14)

## 4. Lifecycle gates

### G9 — expiry eviction (A17)

- **S-G9-01** Entry candidate whose expiry day ≤ the next trading session →
  veto `EXPIRY` (it would meet eviction immediately).
- **S-G9-02** Open position whose expiry day is the next trading session →
  whole-structure close action generated this session, regardless of P&L.
- **S-G9-03** Eviction closes are management actions: they run under halt
  and on Friday, and they are never leg-wise on intact structures. (A11)

### G10 — reconciliation of unexplained state (A2, A11)

Phase 0 classifies every broker position and order into: `MATCHED` (a
journaled structure), `RESIDUE` (assignment shares, orphan leg),
`HUMAN_ACTION` (delta explained by manual intervention), `UNKNOWN_ORDER`,
`CONFIRMATION_UNCLEAR` (intent without outcome).

- **S-G10-01** All MATCHED → proceed normally.
- **S-G10-02** Any non-MATCHED item → `RECONCILIATION` entry with the
  classification, halt new entries, and generate risk-reducing resolution
  actions (close residue at next opportunity).
- **S-G10-03** Assignment overnight: morning cycle finds shares + orphan
  long leg → classified `RESIDUE`; resolution may act leg-wise because the
  structure is already broken and each step strictly reduces risk. (A11)
- **S-G10-04** Intent without outcome: broker queried by client order ID;
  found → outcome journaled now; not found → journaled `NOT_SUBMITTED` and
  the reservation released.
- **S-G10-05** A manual human trade is journaled `HUMAN_ACTION` — visible to
  the judge as exactly that, never absorbed into agent reasoning. (#8, #31)

### G11 — deadline flatten and Friday regime (A17, A22)

- **S-G11-01** On `FLATTEN_DATE`, every cycle generates whole-structure
  closes for all open positions and cancels all non-terminal orders; by
  Thursday close the assertion is zero positions AND zero non-terminal
  orders; a violation halts and alarms.
- **S-G11-02** Friday Sep 4: all entry actions veto `DEADLINE`; the agent is
  journaling-only; broker mutations are limited to the (empty) management
  set.
- **S-G11-03** Fri 17:00 CEST: dedicated `DEADLINE_RECONCILIATION` entry —
  full broker snapshot + reference to the submitted revision.
- **S-G11-04** Fri US close: final snapshot, `TERMINAL` entry, controlled
  end of scheduler and dead-man expectation. Artifacts frozen thereafter.

## 5. State and failure gates

### G12 — single instance and halt (A13, A19)

- **S-G12-01** Lock held by a live instance → the second instance makes no
  broker call, appends a single `SUPPRESSED` line, exits 0. (#23, #40)
- **S-G12-02** Stale lock (holder provably dead, heartbeat older than
  bound) → takeover journaled; two live holders are impossible by
  construction of the lock protocol.
- **S-G12-03** Halt flag set → all entry actions veto `HALT`; management
  actions (eviction, residue closes, flatten, kill-switch) still run.
- **S-G12-04** Un-halt is manual and journaled; no code path clears the
  flag. (A19)
- **S-G12-05** The halt flag is a persisted file, part of the snapshot, and
  a core input — not ambient state read inside the core.

### G13 — drawdown kill-switch

- **S-G13-01** `equity < KILL_EQUITY_THRESHOLD` → flatten all (whole
  structures) + halt + `KILL` journaled. Equality does not trigger
  (strict <).
- **S-G13-02** The threshold prices in the convex sleeve's planned total
  decay: losing the full $8k convex budget alone must NOT trigger. (CONCEPT
  gate 13)
- **S-G13-03** Kill-halt is sticky: equity recovering above the threshold
  does not un-halt. (A19)

### G14 — dead-man watchdog (A18, A11)

- **S-G14-01** Separate process; market-hours-aware: an overnight or
  weekend heartbeat gap is normal and triggers nothing.
- **S-G14-02** During a session, journal staleness beyond `DEAD_MAN_BOUND`
  → watchdog closes all positions as whole structures and sets halt; its
  actions are journaled (by itself, append-only).
- **S-G14-03** External detection (decision C): the agent pings
  healthchecks.io only AFTER a durable local journal append; the check's
  schedule follows `America/New_York` session slots; missed ping alerts
  Felix within the 45–60 min SLA via mail + the named push channel.
- **S-G14-04** Declared limit: watchdog and agent share the host; host death
  kills both — the backstop is construction (A23), and the SaaS blindness of
  a single dead-man service is part of the accepted A23 residual.

## 6. Journal and publishing (A4–A10, A21, A24)

- **S-J-01** Format: JSONL, one entry per line, append-only; corrections are
  new entries referencing the corrected one. A torn last line (power cut) is
  detected and quarantined without losing prior history. (A6)
- **S-J-02** Timestamps: UTC ISO-8601 in every entry; broker timestamps
  recorded verbatim alongside; a third party can map journal times 1:1 onto
  broker times. All CEST talk lives in rendering only. (A21)
- **S-J-03** Entry types (closed set): `CYCLE`, `INTENT`, `OUTCOME`,
  `RECONCILIATION`, `HUMAN_ACTION`, `GAP`, `SKIP`, `SUPPRESSED`, `HALT`,
  `UNHALT`, `KILL`, `DEADLINE_RECONCILIATION`, `TERMINAL`. Every cycle emits
  exactly one `CYCLE` entry — including "did nothing, because X" with the
  full verdict vector. (A4)
- **S-J-04** Every `INTENT` carries: sleeve, structure + legs, computed max
  loss, client order ID, the concrete rationale (the why), and the gate
  verdict vector. Every broker fill maps to a stated reason. (A5)
- **S-J-05** Secrets: journal schemas contain no free-form environment
  dumps; before any write, known secret values (keys, tokens, ping URL) are
  redacted from error strings. A test injects a fake key into an error path
  and asserts it never reaches the journal file. (A8)
- **S-J-06** Account binding: every order-related entry records the account
  ID; the executor asserts at startup and per order that the configured
  `ALPACA_PROFILE` matches the expected role (competition from arming, dev
  in pre-arm) and refuses all orders on mismatch, journaled. Live endpoints
  are not configured anywhere. (A24)
- **S-J-07** Dashboard renders exclusively from the journal; it shows a
  last-updated stamp; a stale dashboard is visibly stale, and its worst
  momentary state (mid-build, half-pushed) is still dated and coherent.
  (A9, A10)

## 7. Execution pricing (A15)

- **S-X-01** Every order is a limit order; the limit derives from the
  decision's own quotes (mid ± configured tolerance). Market orders do not
  exist in the codebase.
- **S-X-02** A fill at the limit is by construction within the decision's
  assumptions; any broker-reported deviation (price improvement is fine,
  anything worse is impossible for limits, partial fills are handled by
  S-G2-06) is journaled with the fill data verbatim.

---

## Traceability

Axiom → cases (spot map; the adversarial pass checks the inverse too):
A1 (S-CYC-08, S-CORE-01), A2 (S-CYC-04, G10), A3 (S-CORE-02, S-CYC-02, G5),
A4 (S-CYC-01/03, S-J-03), A5 (S-J-04, S-G10-04), A6 (S-J-01), A7 (S-CYC-06),
A8 (S-J-05), A9 (S-CYC-07, S-J-07), A10 (S-J-07), A11 (G1, S-G9-03,
S-G10-03), A12 (G8, S-CYC-01), A13 (G7, S-CYC-05, S-G12-01), A14 (G2),
A15 (§7), A16 (G6), A17 (G9, G11), A18 (S-G14-03), A19 (S-G12-03/04,
G13-03), A20 (S-CYC-08), A21 (S-J-02), A22 (G11), A23 (G2 counting,
S-G14-04), A24 (S-J-06).
