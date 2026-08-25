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
| `MAX_REL_SPREAD` | *O5* | liquidity gate, per leg; fraction of mid |
| `MIN_QUOTE_SIZE` | *O5* | liquidity gate, per leg |
| `QUOTE_MAX_AGE` | *O5* | seconds |
| `SNAPSHOT_STALENESS_BOUND` | *O5* | seconds; actions void beyond it |
| `KILL_EQUITY_THRESHOLD` | *O5* | must price in planned convex decay |
| `DEAD_MAN_BOUND` | ≤ 45 min effective | decision C: 45–60 min SLA incl. grace |
| `CYCLE_INTERVAL` | *O5* | 15–30 min during US session |
| `UNDERLYING_UNIVERSE` | *O5* | liquid ETF class (SPY/QQQ …) |
| `STRUCTURE_WHITELIST` | *O5* | vertical debit/credit, iron condor, long option |
| `LIMIT_TOLERANCE` | *O5* | limit-price tolerance around decision mid, $/share of option price; buys mid+, sells mid− (§7) |
| `CLOSE_ESCALATION_STEP` | *O5* | per-cycle limit re-price step for closes, $/share of option price (§7) |
| `RESIDUE_MAX_SESSIONS` | *O5* (default 1) | sessions until unresolved residue alarms |
| `ANALYST_TIMEOUT` | *O5* | hard wall-time ceiling for the analyst call |
| `CYCLE_WALLTIME_BUDGET` | *O5* | hard ceiling on total cycle wall-time, shell-enforced across all phases (`ANALYST_TIMEOUT` and every broker/journal/push timeout live under it) |
| `LOCK_TAKEOVER_BOUND` | *O5* | constraint: `> CYCLE_WALLTIME_BUDGET`, and `LOCK_TAKEOVER_BOUND + CYCLE_INTERVAL + CYCLE_WALLTIME_BUDGET ≤ DEAD_MAN_BOUND` (see S-G12-02) |
| `EXPECTED_ACCOUNT_ID` | set at kickoff | literal broker account ID per role (see S-J-06) |

## 1. Core contract

`decide(snapshot, candidates, config, now) → { verdicts, actions }` — pure:
no I/O, no clock, no randomness, no environment. Same inputs produce
identical outputs. (A1, A3; house FCIS rule)

**Snapshot** (assembled by the shell, one fetch per cycle): account id +
profile role, cash, equity, positions, ALL open orders, halt flag, exchange
calendar segment for today, quotes for candidate and position legs (each
quote carrying its own timestamp), the previous cycle's quotes for the same
underlyings (a pure carry-over the shell passes in, exactly like the halt
flag — S-G6-05's frozen-market signal is computed from this parameter,
never from state held inside the core), and `snapshotAt`.

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
  the executor refetches positions + open orders. Preconditions are a closed
  list — the broker-state facts that entered the approving gate verdicts
  AND are derivable from the refetched positions + open orders: the
  action's target positions/orders, sleeve exposure totals, per-underlying
  exposure totals, and the halt flag. Quote-, calendar-, and chain-facts
  are deliberately not re-fetched here; their currency is bounded by
  S-CORE-02's staleness bound, which still applies at submit time — a
  snapshot too old to act on voids the action regardless. ANY delta in the
  listed facts
  (position appeared/disappeared, human traded elsewhere in the account, an
  order filled meanwhile) voids the action, journaled `REVALIDATION_VOID` —
  never submitted "because the core said so". A narrower reading (only the
  target position) is non-conforming. (A13, #8)
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
  S-J-06), and the bound constraint of S-G12-02 satisfied. Any violation →
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
  held. Nothing rides a reopen unowned. (#30, A16)

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
  structure is already broken and each step strictly reduces risk. (A11)
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
  broker call, appends a single `SUPPRESSED` line, exits 0. (#23, #40)
- **S-G12-02** Stale lock (holder provably dead, heartbeat older than
  `LOCK_TAKEOVER_BOUND`) → takeover journaled. The bound is constrained by
  enumerable quantities, not prose: `CYCLE_WALLTIME_BUDGET` is the
  shell-enforced ceiling on total cycle wall-time (every phase timeout lives
  under it), `LOCK_TAKEOVER_BOUND > CYCLE_WALLTIME_BUDGET`, and
  `LOCK_TAKEOVER_BOUND + CYCLE_INTERVAL + CYCLE_WALLTIME_BUDGET ≤
  DEAD_MAN_BOUND` — so a legitimate takeover completes and journals before
  the watchdog's staleness bound can fire on the gap the takeover itself
  creates. The holder writes a lock heartbeat at every phase boundary — a
  slow-but-alive cycle (a 4-minute analyst call, #13) can never look dead.
  A configuration violating either inequality never arms (S-CYC-11). Only
  under these constraints is "two live holders" excluded. (#23, A13, A18)
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
  Felix within the 45–60 min SLA via mail + the named push channel. The
  same check also carries ACTIVE alarms: alarm-worthy conditions (residue
  escalation S-G10-02, config invalid S-CYC-11, flatten violation S-G11-01,
  ladder cap S-X-05) are signaled by an explicit fail-ping to the check's
  fail endpoint — alerting immediately, not by waiting for a missed ping.
  A cycle that journals such a condition sends the fail-ping INSTEAD of the
  success ping.
- **S-G14-04** Declared limit: watchdog and agent share the host; host death
  kills both — the backstop is construction (A23), and the SaaS blindness of
  a single dead-man service is part of the accepted A23 residual.

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
  `AUTH_FAILURE`, `REVALIDATION_VOID`, `SCHEMA_VETO`, `NOT_SUBMITTED` are
  reason codes *inside* `CYCLE`/`OUTCOME`/`RECONCILIATION` entries, not
  extra types. `OUTCOME` carries a status from the closed set {filled,
  partially_filled, rejected, canceled, expired, confirmation_unclear} —
  a rejection is an `OUTCOME` with status `rejected`, structurally
  incapable of being read as an execution. Every cycle emits exactly one
  `CYCLE` entry — including "did nothing, because X" with the full verdict
  vector. (A4, A5)
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
  last-updated stamp; a stale dashboard is visibly stale, and its worst
  momentary state (mid-build, half-pushed) is still dated and coherent.
  (A9, A10)
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
  limit is still a limit; S-X-01 survives). The ladder is capped by the
  structure's own defined-risk arithmetic: for a credit structure the close
  debit never exceeds the width (wing) from which S-G1-02/03 computed
  maxLoss; for a debit structure or long option the close credit never goes
  below zero. Reaching the cap → the order rests AT the cap, halt + alarm,
  attempts continue at the cap — so the realized exit cost can never exceed
  the maxLoss the budgets were charged with. Every re-price is journaled.
  The ladder never crosses into opening exposure and never legs out of an
  intact structure (A11).

---

## Traceability

Axiom → cases (spot map; the adversarial pass checks the inverse too):
A1 (S-CYC-08, S-CORE-01), A2 (S-CYC-04/10, G10), A3 (S-CORE-02, S-CYC-02,
G5), A4 (S-CYC-01/03/09, S-J-03), A5 (S-J-04, S-G10-04, S-X-03), A6
(S-J-01), A7 (S-CYC-06), A8 (S-J-05), A9 (S-CYC-07, S-J-07), A10 (S-J-07),
A11 (G1, S-G9-03, S-G10-03, S-X-05), A12 (G8, S-CYC-01), A13 (G7,
S-CYC-05, S-G12-01/02, S-J-08), A14 (G2, S-G8-06), A15 (§7), A16 (G6),
A17 (G9, G11), A18 (S-G14-03, S-CYC-11), A19 (S-G12-03/04/06, G13-03),
A20 (S-CYC-08/09), A21 (S-J-02), A22 (G11), A23 (G2 counting, S-G14-04),
A24 (S-J-06, S-CYC-11).
