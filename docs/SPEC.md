# Spec — cases per gate (the red-first test oracle)

Provenance: concretized 2026-08-25 from [`docs/AXIOMS.md`](AXIOMS.md) (24
axioms, owner-reviewed) per the build order Szenario → Axiom → Spec → Code.
This spec is *measured against* [`docs/SCENARIOS.md`](SCENARIOS.md) — the
catalog is never edited to fit this file. Every case cites the axioms it
concretizes. Case IDs are stable: tests reference them (`S-G2-06`), and the
first implementation step is writing them red. One entry is exempt by its
own text: a case marked "Declared limit — NOT a test case" (currently only
S-G14-04) documents an accepted residual and carries no red-first
obligation.

Status: passed the capped adversarial pass `spec-pass` (2 rounds; accepted
by the owner 2026-08-25 as a capped Vorlage, NOT a bis-0 termination).
Owner ruling on executability (spec-pass D16): this spec COUNTS AS
EXECUTABLE — its configuration equations and closed journal sets form an
executable surface. Consequently, findings that spec-pass closed only
argumentatively are a named **evidence debt**: the red-first tests MUST
execute each such finding's trigger path. Authoritative, tracked register:
[`docs/EVIDENCE-DEBT.md`](EVIDENCE-DEBT.md) (the machine-local run store
holds the full finding texts but is not clone-portable — KGV-13). Green
tests without those paths do not discharge the debt.

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
| `MAX_REL_SPREAD` | *O5* | liquidity gate, per leg; fraction of mid |
| `MIN_QUOTE_SIZE` | *O5* | liquidity gate, per leg |
| `QUOTE_MAX_AGE` | *O5* | seconds |
| `SNAPSHOT_STALENESS_BOUND` | *O5* | seconds; actions void beyond it; coupling (validated at S-CYC-11): `≥ CYCLE_WALLTIME_BUDGET` and `≤ CYCLE_INTERVAL` |
| `KILL_EQUITY_THRESHOLD` | *O5* | must price in planned convex decay |
| `DEAD_MAN_BOUND` | 50 min detection | detection threshold; plus `ALERT_DELIVERY_BUDGET` the total stays AT the 60-min SLA edge (owner ruling GV-2: upper side of the 45–60 SLA; detection at 60 itself would push every delivery beyond the absolute SLA — KGV-17) |
| `ALERT_DELIVERY_BUDGET` | 10 min | grace + delivery of the external check; `DEAD_MAN_BOUND + ALERT_DELIVERY_BUDGET ≤ 60 min` |
| `CYCLE_INTERVAL` | 15 min | frozen by owner ruling GV-2, 2026-08-25; 30 min is EXCLUDED (incompatible with the coupling below) |
| `UNDERLYING_UNIVERSE` | *O5* | liquid ETF class (SPY/QQQ …) |
| `STRUCTURE_WHITELIST` | *O5* | vertical debit/credit, iron condor, long option |
| `LIMIT_TOLERANCE` | *O5* | limit-price tolerance around decision mid, $/share of option price; buys mid+, sells mid− (§7) |
| `CLOSE_ESCALATION_STEP` | *O5* | per-cycle limit re-price step for closes, $/share of option price (§7) |
| `RESIDUE_MAX_SESSIONS` | *O5* (default 1) | sessions until unresolved residue alarms |
| `ANALYST_TIMEOUT` | *O5* | hard wall-time ceiling for the analyst call |
| `CYCLE_WALLTIME_BUDGET` | *O5* | hard ceiling on total cycle wall-time, shell-enforced across all phases (`ANALYST_TIMEOUT` and every broker/journal/push timeout live under it) |
| `LOCK_TAKEOVER_BOUND` | *O5* | scheduling constraint ONLY (writer authority comes from fencing, S-G12-07): `> CYCLE_WALLTIME_BUDGET`, and `LOCK_TAKEOVER_BOUND + 2 × (CYCLE_INTERVAL + CYCLE_WALLTIME_BUDGET) ≤ DEAD_MAN_BOUND` (corrected per spec-pass GV-2; see S-G12-02) |
| `EXPECTED_ACCOUNT_ID` | set at kickoff | literal broker account ID per role (see S-J-06) |

## 0.5 Build priority — the MVP cut (added 2026-08-25, spec-pass NUT-1)

The schedule itself gates arming: CONCEPT §8 arms the competition account
only after Monday's pre-arm live test. The 87 test cases below (plus one
declared limit, S-G14-04, which has no deadline because it has no test)
therefore carry an explicit priority, so a solo build weekend never has to
guess what may slip:

- **Tier 1 — no order without it (build weekend, red-first):** S-CORE-01..03,
  S-CYC-01/02/04/05/06/11, G1, G2, G3, G4, G6, G7, G8 (incl. S-G8-06), G12
  (S-G12-01..05, S-G12-07 — writer fencing is order safety), G13,
  S-J-01..06, S-X-01/02/03.
- **Tier 2 — before the first unattended session (Mon arming):** G5, G10,
  G14 (S-G14-01..03), S-G12-06 (fence drill is pre-arm by its own text),
  S-X-06 (arming precondition for short-capable structures by its own
  text), S-CYC-03, S-CYC-07..10, S-X-04/05, S-J-07/08.
  Note: the tier-1 kill-switch (S-G13-01) closes
  via plain S-X-01 limits until the S-X-05 ladder lands in tier 2 — a known,
  accepted weekend gap.
- **Tier 3 — before Thursday Sep 3 (first expiry/deadline pressure):** G9,
  G11.

Tiers schedule the work; they do not waive it — a tier missing at its own
deadline blocks arming (tier 2) or requires a manual flatten decision by the
owner (tier 3), journaled either way.

## 1. Core contract

`decide(snapshot, candidates, config, now) → { verdicts, actions }` — pure:
no I/O, no clock, no randomness, no environment. Same inputs produce
identical outputs. (A1, A3; house FCIS rule)

**Snapshot** (assembled by the shell, one fetch per cycle): account id +
profile role, cash, equity, positions, ALL open orders, halt flag, exchange
calendar segment for today, quotes for candidate and position legs (each
quote carrying its own timestamp), the previous quote observations
(owner ruling GV-8, 2026-08-25: reconstructed by the shell from the most
recent snapshot-bearing journal entry — every entry written from a taken
snapshot records its quote samples, see S-J-03 — never from process
memory; this satisfies A1's no-in-memory-state rule and makes the
carry-over survive any restart), and `snapshotAt`. S-G6-05's
frozen-market signal is computed from this parameter, never from state
held inside the core. A prior sample qualifies only if it is at most
`2 × CYCLE_INTERVAL` old — an overnight-stale sample would compare
yesterday against now and silently disarm the frozen-market signal
(KGV-12). Missing, incomplete, or over-age history blocks entries **per
underlying** (the S-G6-05 scope governs; an underlying with valid history
trades normally), never risk-reducing management; concretely, until a
current plus a qualifying immediately-prior sample exist for an
underlying, the cycle may fetch, journal, and manage risk there, but
places no entry orders on it.

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
  `SKIP` reason is journaled, and the process exits cleanly. Bounded, not
  rhetorical: the analyst is invoked at most ONCE per cycle (no in-process
  retry), and the process never relaunches itself — restarts come only from
  the scheduler at the next interval. (A4, A12)
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
- **S-CYC-05** Pre-submit revalidation via typed claimset (owner ruling
  GV-3, 2026-08-25): every core-approved action carries a **typed
  revalidation claimset** — the machine-readable list of facts its gate
  verdicts rested on. Immediately before submit, the executor refetches
  and re-checks against broker truth: the account (ID match per S-J-06 AND
  fresh equity re-evaluated against the kill predicate of S-G13-01),
  positions, non-terminal orders, the control epoch (S-G12-07), and the
  halt flag. ANY violated claim (position appeared/disappeared, human
  traded elsewhere in the account, an order filled meanwhile, equity
  crossed the kill threshold, epoch stale) voids the action, journaled
  `REVALIDATION_VOID` **with the claimset and the violated claim as
  journal fields** (A5: discrepancies explain themselves) — never
  submitted "because the core said so". A kill-predicate breach seen here
  is the freshest possible evidence of a kill state: it does not merely
  void the action, it triggers the full S-G13-01 path (flatten + halt +
  `KILL`) in the SAME cycle, not the next one.
  Quote-, calendar-, and chain-facts are not re-fetched here; their
  currency is bounded by S-CORE-02's staleness bound, which still applies
  at submit time. A narrower reading (only the target position) is
  non-conforming. (A13, #8)
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
- **S-CYC-09** Bootstrap (very first cycle ever): an empty or absent journal
  is the bootstrap state ONLY if the broker account is also virgin — zero
  positions and zero non-terminal orders. Then the cycle journals
  `BOOTSTRAP` (broker snapshot as the opening baseline; no "state then"
  exists and none is fabricated) and proceeds as a normal cycle. An empty
  journal facing a NON-empty account (lost/corrupted journal, wrong working
  directory, fresh clone without the journal branch) is NOT bootstrap: it is
  a `GAP` with unknown prior state, and every broker item is non-MATCHED by
  definition → G10 reconciliation + halt. A foreign book is never silently
  adopted as an opening baseline. Any failure in this first cycle follows
  the normal halt/alarm paths — the first unattended cycle fails visibly
  and safely, it cannot silently burn the day. (#1, A4, A20)
- **S-CYC-10** Failed resolution stays blocking: if phase 0 cannot resolve a
  `CONFIRMATION_UNCLEAR` item or other unexplained state (broker still
  unreachable, lookup ambiguous), the item remains open, new entries remain
  blocked, and each cycle journals the still-unresolved state. Only a
  successful classification unblocks — "we tried" does not. (A2, A3)
- **S-CYC-11** Startup config validation, fail closed: before any broker
  call, the shell validates the mandatory configuration — `EXPECTED_
  ACCOUNT_ID` set and non-empty (an empty comparison never passes, see
  S-J-06), the bound constraints of S-G12-02 satisfied, the
  `SNAPSHOT_STALENESS_BOUND` coupling of §0 satisfied, and — if
  `STRUCTURE_WHITELIST` contains any short-capable structure — the S-X-06
  capability flag present. Any violation →
  the agent refuses to arm: no orders ever, `CONFIG_INVALID` journaled
  locally, active fail-signal to the dead-man check (S-G14-03). Missing
  configuration is indistinguishable from wrong configuration — both are
  fail-closed. (A24, A18)

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
- **S-G2-07** Exit (closing) orders reserve no budget; an entry identity's
  reservation is released only when its order reaches a terminal state —
  filled (reservation becomes position max loss), rejected, canceled, or
  expired (reservation freed). A rejection that failed to release its
  reservation would block the sleeve permanently; a test asserts release on
  every terminal path. (#17)
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

Scope: G5 gates *entries* only. Risk-reducing closes (eviction, residue
resolution, flatten, kill-switch) are never blocked by G5 — they use the
close-escalation ladder (§7) instead. A close that G5 could veto would make
the safety path fail exactly when liquidity is worst.

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
- **S-G6-05** Untradable-underlying heuristic — two distinct signals, either
  suffices: (a) quote timestamps older than `QUOTE_MAX_AGE` (stale feed), or
  (b) price AND size frozen across ≥2 successive snapshots while timestamps
  keep advancing (halted market with a live feed — reusing only the G5 age
  check does not detect this). Either signal → veto for that underlying;
  every working order on it is either canceled or journaled as deliberately
  held. Nothing rides a reopen unowned. Signal (b) needs a current plus an
  immediately-prior COMPLETE quote sample from the journal (§1); while
  that history is missing, entries for the underlying are blocked (fail
  closed toward abstention), risk-reducing management stays permitted.
  (#30, A16, GV-8)

### G7 — idempotency (A13)

- **S-G7-01** Client order ID is a deterministic function of (trading day,
  cycle index, structure identity, action kind); same inputs → same ID;
  different cycle → different ID.
- **S-G7-02** Re-submission of an already-submitted ID (crash replay) →
  broker duplicate response is treated as "already submitted": reconcile,
  journal, do not error and do not re-send with a fresh ID.

### G8 — schema and whitelist (A12)

Two-level rule per A12 (sharpened there 2026-08-25 — the axiom, not this
spec, is the source): *structural* failure (invalid JSON, schema mismatch)
drops the entire analyst output; a *semantic* whitelist violation
(well-formed candidate, out-of-policy value) vetoes that candidate and the
rest are still evaluated.

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
- **S-G8-06** Sleeve–structure consistency: the sleeve tag must match the
  structure's economics — net-credit structures (credit spreads, iron
  condors) may only carry `income`; net-debit structures and long options
  may only carry `convex`. The economics are computed from the legs' quoted
  prices (sign of the net premium), never from the declared structure type;
  an exactly-zero net premium is degenerate → veto. A mismatch (e.g., a
  credit condor tagged `convex`, which would be measured against the wrong
  budget basis) → veto `SLEEVE_MISMATCH`. The tag is validated, never
  trusted. (A14, CONCEPT §2)

## 4. Lifecycle gates

### G9 — expiry eviction (A17)

- **S-G9-01** Entry candidate whose expiry day ≤ the next trading session →
  veto `EXPIRY` (it would meet eviction immediately).
- **S-G9-02** Open position whose expiry day is the next trading session →
  whole-structure close action generated this session, regardless of P&L —
  and *tracked to a terminal state*: an eviction close that does not fill
  (liquidity, rejection) re-enters every subsequent cycle via the
  close-escalation ladder (§7) until the position is actually closed;
  "a close was generated once" never satisfies this case. If the position
  is still open in a cycle after which no further cycle is scheduled before
  that session's close, halt + active fail-signal on the dead-man check
  (S-G14-03) while close attempts continue. (A17)
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
  actions. Resolution is driven, not hoped for: residue closes use the
  close-escalation ladder (§7) every cycle; if ANY unresolved non-MATCHED
  item — `RESIDUE`, `CONFIRMATION_UNCLEAR`, `UNKNOWN_ORDER`, an unexplained
  `HUMAN_ACTION` delta — has not reached a terminal state within
  `RESIDUE_MAX_SESSIONS`, the condition raises an active fail-signal on the
  dead-man check (S-G14-03; it is a genuine "developer must look" state)
  while attempts and halt continue. "No opportunity yet", repeated forever,
  is non-conforming. (A2)
- **S-G10-03** Assignment overnight: morning cycle finds shares + orphan
  long leg → classified `RESIDUE`; resolution may act leg-wise because the
  structure is already broken and each step strictly reduces risk. Bounded
  residue closes via the capped ladder (S-X-05); unbounded residue (short
  stock, orphan short leg) via the discriminated recovery policy S-X-06.
  (A11)
- **S-G10-04** Intent without outcome: broker queried by client order ID;
  found → outcome journaled now; not found → journaled `NOT_SUBMITTED` and
  the reservation released.
- **S-G10-05** A manual human trade is journaled `HUMAN_ACTION` — visible to
  the judge as exactly that, never absorbed into agent reasoning. (#8, #31)

### G11 — deadline flatten and Friday regime (A17, A22)

- **S-G11-01** On `FLATTEN_DATE`, all entry actions veto `DEADLINE` (no
  position is opened on the day everything must die), every cycle generates
  whole-structure closes for all open positions and cancels all non-terminal
  orders. Closes run the close-escalation ladder (§7) from the first
  `FLATTEN_DATE` cycle onward, so an illiquid leg is walked across the
  spread with hours of margin, not hoped into a fill; by Thursday close the
  assertion is zero positions AND zero non-terminal orders; a violation
  halts and alarms.
- **S-G11-02** Friday Sep 4: all entry actions veto `DEADLINE`; the agent is
  journaling-only; broker mutations are limited to the management set —
  which is empty when Thursday succeeded. Failure path (deviation from the
  normal decision-B regime, journaled as such): if the Thursday assertion
  failed, Friday cycles still execute risk-reducing closes via the ladder
  until flat — a stuck position is never abandoned to expiry mechanics just
  because the calendar said "journaling-only". (A17, #19)
- **S-G11-03** Fri 17:00 CEST: dedicated `DEADLINE_RECONCILIATION` entry —
  full broker snapshot + reference to the submitted revision.
- **S-G11-04** Fri US close: final snapshot, `TERMINAL` entry, controlled
  end of scheduler and dead-man expectation. Artifacts frozen thereafter.
  If the S-G11-02 failure path is STILL not flat at Friday close, the
  `TERMINAL` entry records the open remainder explicitly (structure, max
  loss, expiry consequence) and raises the active fail-signal — the story
  hands over to the owner in writing, never in silence.

## 5. State and failure gates

### G12 — single instance and halt (A13, A19)

- **S-G12-01** Lock held by a live instance → the second instance makes no
  broker call, appends a single `SUPPRESSED` line **as a witness append**
  (the authority-free gateway class defined in S-G12-07), exits 0.
  `SUPPRESSED` is **staleness-neutral**: it does not count as a journal
  append for the watchdog's staleness clock (S-G14-02) and never triggers
  a success ping (S-G14-03) — a dead or hanging holder can never be kept
  looking alive by its own suppressed successors. Journal appends from any
  instance reach the JSONL only serialized (single writer path / file
  lock), never interleaved. (#23, #40; owner ruling GV-2, 2026-08-25)
- **S-G12-02** Time alone NEVER grants writer authority (owner ruling GV-2,
  2026-08-25). A heartbeat older than `LOCK_TAKEOVER_BOUND` is only the
  *trigger* to attempt a takeover; the takeover itself proceeds exclusively
  through the fencing protocol of S-G12-07 — fence first, then reconcile
  (phase 0 against the broker), only then act. The inequalities
  (`LOCK_TAKEOVER_BOUND > CYCLE_WALLTIME_BUDGET`;
  `LOCK_TAKEOVER_BOUND + 2 × (CYCLE_INTERVAL + CYCLE_WALLTIME_BUDGET) ≤
  DEAD_MAN_BOUND` — the doubled term covers a holder dying mid-cycle,
  after heartbeats but before the phase-5 append, per spec-pass GV-2) are
  **scheduling constraints**: they size the timers so detection and
  takeover fit inside the dead-man SLA; they are not an authority
  mechanism. The holder writes a lock heartbeat at every phase boundary —
  a slow-but-alive cycle (a 4-minute analyst call, #13) can never look
  dead. A configuration violating either inequality never arms
  (S-CYC-11). (#23, A13, A18)
- **S-G12-03** Halt flag set → all entry actions veto `HALT`; management
  actions (eviction, residue closes, flatten, kill-switch) still run.
- **S-G12-04** Un-halt is manual and journaled; no code path clears the
  flag. (A19)
- **S-G12-05** The halt flag is a persisted file, part of the snapshot, and
  a core input — not ambient state read inside the core.
- **S-G12-06** Credential fence (decision D): an auth failure (401/403) is
  journaled as `AUTH_FAILURE` — a distinguishable state, not generic
  `WORLD_UNREACHABLE` — and blocks all orders. The runbook fact is spec:
  a key rotation does NOT cancel working orders; the documented fence
  procedure therefore ends with a working-order check/cancel in the broker
  dashboard, and the fence is drilled once on the dev account pre-arm
  (drill outcome journaled there). Re-arm after a fence only under halt,
  after full reconciliation. (#34, A19)
- **S-G12-07** Writer fencing (owner ruling GV-2, 2026-08-25; gateway
  categories per KGV class fix): writer authority exists ONLY through
  (a) a held OS-level lock that the previous holder has verifiably
  released, or (b) a monotone **control epoch** validated at the SINGLE
  mutation gateway through which every broker mutation and every journal
  append passes. The gateway knows exactly two request classes:
  **authoritative mutations** (orders, cancels, and all journal entries
  that assert agency — `INTENT`, `OUTCOME`, `CYCLE`, `RECONCILIATION`, …)
  require a currently valid authority; **witness appends** (`SUPPRESSED`,
  and a fenced writer's own `FENCED_OUT` demise notice) carry NO
  authority, may mutate nothing at the broker, are staleness-neutral
  (S-G14-02), never trigger a success ping, and reach the JSONL only
  through the same serialized append path. Epoch acquisition is a single
  **atomic compare-and-increment** on the persisted epoch store: of two
  concurrent takers exactly one wins; the loser observes the changed
  epoch and demotes itself to a witness. The epoch store persists next to
  the journal and follows the S-CYC-09 rule: an absent/reset epoch store
  facing a non-virgin account is never re-seeded silently — it is the GAP
  path, halt included. Order of operations is fixed: fence (atomic epoch
  increment) → reconcile (phase 0 against broker truth) → act. Tests:
  (1) a paused writer resuming after a takeover gets every authoritative
  mutation rejected and can still append exactly one `FENCED_OUT` witness
  line; (2) no code path mutates broker or journal except through the
  gateway; (3) two concurrent takeover attempts yield exactly one winner;
  (4) the watchdog's flatten runs under its own atomically acquired
  epoch. (#23, #9, A13)

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
  → the watchdog first FENCES the (possibly still-hanging) writer via the
  S-G12-07 epoch, then reconciles against the broker, then closes all
  positions as whole structures and sets halt; its actions run under its
  own incremented epoch and are journaled via the serialized path. A
  fenced old writer that wakes later cannot mutate anything (S-G12-07).
  `SUPPRESSED` lines do not reset this staleness clock (S-G12-01).
- **S-G14-03** External detection (decision C): the agent pings
  healthchecks.io only AFTER a durable local journal append; the check's
  schedule follows `America/New_York` session slots; missed ping alerts
  Felix within the 45–60 min SLA via mail + the named push channel
  (`DEAD_MAN_BOUND` + `ALERT_DELIVERY_BUDGET` stay ≤ the 60-min edge). The
  same check also carries ACTIVE alarms — and the set of alarm-worthy
  conditions has ONE source, not a second list here: every case whose own
  text prescribes an "active fail-signal" or "fail-ping" (currently
  S-G9-02, S-G10-02, S-CYC-11, S-G11-01, S-G11-04, S-X-05, S-X-06; the
  case texts govern, this parenthesis is illustrative) signals via an
  explicit fail-ping to the check's fail endpoint — alerting immediately,
  not by waiting for a missed ping. A cycle that journals such a condition
  sends the fail-ping INSTEAD of the success ping.
- **S-G14-04** Declared limit — NOT a test case, no red-first obligation:
  watchdog and agent share the host; host death kills both — the backstop is
  construction (A23), and the SaaS blindness of a single dead-man service is
  part of the accepted A23 residual. The testable surface of G14 is
  S-G14-01..03; this entry exists so the limit is stated where its gate is,
  not silently.

## 6. Journal and publishing (A4–A10, A13, A21, A24)

- **S-J-01** Format: JSONL, one entry per line, append-only; corrections are
  new entries referencing the corrected one. A torn last line (power cut) is
  detected and quarantined without losing prior history. (A6)
- **S-J-02** Timestamps: UTC ISO-8601 in every entry; broker timestamps
  recorded verbatim alongside; a third party can map journal times 1:1 onto
  broker times. All CEST talk lives in rendering only. (A21)
- **S-J-03** Entry types (closed set): `CYCLE`, `BOOTSTRAP`, `INTENT`,
  `OUTCOME`, `RECONCILIATION`, `HUMAN_ACTION`, `GAP`, `SKIP`, `SUPPRESSED`,
  `HALT`, `UNHALT`, `KILL`, `DEADLINE_RECONCILIATION`, `TERMINAL`. Labels
  like `WORLD_UNREACHABLE`, `WORLD_PARTIAL`, `STALE_SNAPSHOT`,
  `AUTH_FAILURE`, `REVALIDATION_VOID`, `SCHEMA_VETO`, `NOT_SUBMITTED`,
  `CONFIG_INVALID` are reason codes *inside* `CYCLE`/`OUTCOME`/
  `RECONCILIATION` entries, not extra types. `OUTCOME` carries a status from the closed set {filled,
  partially_filled, rejected, canceled, expired, confirmation_unclear} —
  a rejection is an `OUTCOME` with status `rejected`, structurally
  incapable of being read as an execution. Every scheduled invocation
  emits exactly one PRIMARY entry: `CYCLE` for a full cycle, else its
  substitute (`BOOTSTRAP`, `GAP`, `SKIP`, `SUPPRESSED`) — "exactly one
  CYCLE per cycle" never demands a second entry beside a substitute
  (KGV-11). Every primary entry written from a TAKEN snapshot (`CYCLE`,
  `BOOTSTRAP`, `GAP`, and `SKIP` when the snapshot phase ran) records the
  quote samples observed (per watched underlying: bid, ask, sizes, quote
  timestamps), so the next cycle's frozen-market history (§1, S-G6-05) is
  reconstructed from the journal, not from memory; snapshot-less entries
  (`SUPPRESSED`, connectivity-failure cycles) simply leave a hole that
  the per-underlying age rule of §1 handles. (A4, A5, A1)
- **S-J-04** Every `INTENT` carries: sleeve, structure + legs, computed max
  loss, client order ID, the gate verdict vector, and a rationale with a
  content requirement, not just non-emptiness: (a) the expected
  distribution it buys ("paid from": income drift vs. convex tail), (b) a
  reference to at least one concrete snapshot datum it rests on (the quotes
  or chain facts used), and (c) candidate-specific free text naming
  underlying and structure. Mechanically testable floor: no two INTENT
  entries anywhere in the journal's lifetime may carry byte-identical
  rationale text, and a
  rationale without a snapshot reference fails. Boilerplate ("gates
  passed") is non-conforming. (A5, #31)
- **S-J-05** Secrets: journal schemas contain no free-form environment
  dumps; before any write, known secret values (keys, tokens, ping URL) are
  redacted from error strings. A test injects a fake key into an error path
  and asserts it never reaches the journal file. (A8)
- **S-J-06** Account binding — two independent sources, or the check is
  tautological: `EXPECTED_ACCOUNT_ID` is a separately configured literal
  (the known account ID for the role: competition ID from arming, dev
  `PA349COOGKZ1` pre-arm), NOT derived from `ALPACA_PROFILE` or from the
  credentials. At startup and before every order, the account ID that the
  broker itself reports for the active credentials must equal
  `EXPECTED_ACCOUNT_ID`; mismatch → refuse all orders, journal, halt. An
  unset or empty `EXPECTED_ACCOUNT_ID` is a config error, fail-closed per
  S-CYC-11 — an empty-vs-empty comparison never counts as a match.
  Every order-related entry records the account ID. Live endpoints are not
  configured anywhere. (A24)
- **S-J-07** Dashboard renders exclusively from the journal; it shows a
  last-updated stamp; a stale dashboard is visibly stale. "Coherent" is
  operational, not aspirational: every displayed figure derives from the
  entries of ONE committed journal revision, the page names that revision
  next to its last-updated stamp, and builds are atomic (render aside, then
  swap) — a viewer never sees a half-written page. Test: a build
  interrupted mid-render leaves the previous page fully intact. (A9, A10)
- **S-J-08** Branch isolation is checked, not assumed: the journal writer
  pushes exclusively to the configured journal branch and refuses any other
  ref — a test configures a non-journal target and asserts refusal; the
  refusal itself is journaled locally. Human submission work never touches
  that branch (enforced by convention plus the writer-side refusal; the
  collision of #44 is thereby structurally one-sided). (A13, #44)

## 7. Execution pricing (A15)

- **S-X-01** Every order is a limit order; the limit derives from the
  decision's own quotes (mid ± `LIMIT_TOLERANCE`). Market orders do not
  exist in the codebase.
- **S-X-02** A fill at the limit is by construction within the decision's
  assumptions; any broker-reported deviation (price improvement is fine,
  anything worse is impossible for limits, partial fills are handled by
  S-G2-06) is journaled with the fill data verbatim.
- **S-X-03** Synchronous broker rejection (buying power, approval level,
  unsupported order type, unmarketable price, halted underlying) →
  `OUTCOME` with status `rejected` and the broker's reason verbatim; the
  G2 reservation is released (S-G2-07); the journal can never show it as
  executed. (#17, A5)
- **S-X-04** Asynchronous rejection (accepted, later rejected): the status
  change is picked up by the executor's post-submit status check (part of
  phase 4) or by the next cycle's phase 0, journaled as in S-X-03,
  reservation released. Until the
  terminal status is seen, the order counts as fillable exposure (A23
  counting rule). (#17, A2)
- **S-X-05** Close-escalation ladder (shared by G9/G10/G11 and the
  kill-switch): a risk-reducing close starts at mid, then re-prices by
  `CLOSE_ESCALATION_STEP` toward — and past — the opposing quote on every
  subsequent cycle, remaining a limit order at all times (a marketable
  limit is still a limit; S-X-01 survives). For INTACT structures the
  ladder is capped by the structure's own defined-risk arithmetic: for a
  credit structure the close debit never exceeds the width (wing) from
  which S-G1-02/03 computed maxLoss; for a debit structure or long option
  the close credit never goes below zero. Reaching the cap → the order
  rests AT the cap, halt + alarm, attempts continue at the cap — so the
  realized NET loss (close debit minus the credit received at entry, or
  premium paid minus close credit) can never exceed the maxLoss the
  budgets were charged with (KGV-16: the cap sits at width, maxLoss at
  width − credit; the guarantee is about the net). Non-intact subjects (orphan legs, share residue) do not use this
  cap — they follow the discriminated recovery policy of S-X-06. Every
  re-price is journaled. The ladder never crosses into opening exposure
  and never legs out of an intact structure (A11).
- **S-X-06** Discriminated recovery policy for unbounded residues (owner
  ruling GV-6, 2026-08-25): a subject that is already outside defined-risk
  construction — an orphan SHORT option leg, or short stock from
  assignment — has no width to derive a cap from; its close is therefore
  run under halt + active fail-ping as a requoted **marketable-limit**
  close, re-priced every cycle to remain marketable until flat, with no
  price cap. The realized cost MAY exceed the structure's original
  maxLoss; every such close is journaled explicitly as an **assignment
  exception to A23's constructive worst case** (referencing A23's own
  "not a guarantee against assignment mechanics" clause). This policy is
  an ARMING PRECONDITION for short-capable structures, and the
  precondition is CHECKED, not prose: S-CYC-11 refuses to arm when
  `STRUCTURE_WHITELIST` contains any short-capable structure while the
  S-X-06 capability flag is absent from config. Orphan LONG legs and long
  residue remain capped (credit floor zero); a long residue that is
  unsellable (bid 0, worthless) may reach its terminal state by a
  **declared expiry-hold**: a journaled deliberate decision "hold to
  expiry, zero additional risk" ends the escalation, lifts the fail-ping,
  and satisfies A17's deliberate-decision clause — riskless paper never
  jams the alarm channel. (#18, A11, A17, A23)

---

## Traceability

Axiom → cases (spot map; the adversarial pass checks the inverse too):
A1 (S-CYC-08, S-CORE-01), A2 (S-CYC-04/10, G10), A3 (S-CORE-02, S-CYC-02,
G5), A4 (S-CYC-01/03/09, S-J-03), A5 (S-J-04, S-G10-04, S-X-03), A6
(S-J-01), A7 (S-CYC-06), A8 (S-J-05), A9 (S-CYC-07, S-J-07), A10 (S-J-07),
A11 (G1, S-G9-03, S-G10-03, S-X-05/06), A12 (G8, S-CYC-01), A13 (G7,
S-CYC-05, S-G12-01/02/07, S-J-08), A14 (G2, S-G8-06), A15 (§7), A16 (G6),
A17 (G9, G11, S-X-06), A18 (S-G14-02/03, S-CYC-11), A19 (S-G12-03/04/06,
G13-03), A20 (S-CYC-08/09), A21 (S-J-02), A22 (G11), A23 (G2 counting,
S-G14-04, S-X-06), A24 (S-J-06, S-CYC-11).
