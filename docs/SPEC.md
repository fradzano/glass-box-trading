# Spec — cases per gate (the red-first test oracle)

Provenance: concretized 2026-08-25 from [`docs/AXIOMS.md`](AXIOMS.md) (28
axioms, owner-reviewed) per the build order Szenario → Axiom → Spec → Code.
This spec is *measured against* [`docs/SCENARIOS.md`](SCENARIOS.md) — the
catalog is never edited to fit this file. Every case cites the axioms it
concretizes. Case IDs are stable: tests reference them (`S-G2-06`), and the
first implementation step is writing them red. One entry is exempt by its
own text: a case marked "Declared limit — NOT a test case" (currently only
S-G14-04) documents an accepted residual and carries no red-first
obligation.

External requirements are frozen in
[`docs/HACKATHON-FACTS.md`](HACKATHON-FACTS.md). Judge-facing assets, public
access, and delivery acceptance live in
[`docs/SUBMISSION-SPEC.md`](SUBMISSION-SPEC.md); this file owns the runtime
evidence those surfaces consume.

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

Frozen values are owner decisions; symbols marked *O5* are frozen before the
actual first arm and journaled as config. The core receives config as a
parameter — no constant below may be hardcoded in core logic.

| Symbol | Value | Basis |
|---|---|---|
| `INCOME_BUDGET` | $12,000 | max-loss basis (owner call A) |
| `CONVEX_BUDGET` | $8,000 | premium-paid basis (owner call A) |
| `INITIAL_CAPITAL` | $100,000 | competition start |
| `COMPETITION_START` | 2026-08-28 17:00 CEST | official kickoff; no competition action before it |
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
| `EXPIRY_MIN_SESSIONS` | *O5*, integer ≥ 2 | minimum remaining trading sessions at entry; compatible with G9 |
| `EXPIRY_MAX_SESSIONS` | *O5*, integer ≥ `EXPIRY_MIN_SESSIONS` | maximum remaining trading sessions at entry |
| `MAX_STRIKE_DISTANCE_FRAC` | *O5*, `(0, 1]` | maximum `abs(strike - spot) / spot` for every candidate leg |
| `MAX_CANDIDATE_QTY` | *O5*, positive integer | per-candidate structure quantity ceiling; budgets/exposure may be stricter |
| `LIMIT_TOLERANCE` | *O5* | limit-price tolerance around decision mid, $/share of option price; buys mid+, sells mid− (§7) |
| `CLOSE_ESCALATION_STEP` | *O5* | per-cycle limit re-price step for closes, $/share of option price (§7) |
| `RESIDUE_MAX_SESSIONS` | *O5* (default 1) | sessions until unresolved residue alarms |
| `ANALYST_TIMEOUT` | *O5* | hard wall-time ceiling for the analyst call |
| `CYCLE_WALLTIME_BUDGET` | *O5* | hard ceiling on caller-visible total cycle wall-time, shell-enforced across all phases (`ANALYST_TIMEOUT` and every broker/journal/push timeout live under it). The shell rechecks elapsed wall time before returning, so synchronous event-loop blocking cannot turn a late result into success. No local effect begins after the ceiling; a broker request begun before it but settling after it is confirmation-unclear and must be reconciled, never reported as success. |
| `LOCK_TAKEOVER_BOUND` | *O5* | scheduling constraint ONLY (writer authority comes from fencing, S-G12-07): `> CYCLE_WALLTIME_BUDGET`, and `LOCK_TAKEOVER_BOUND + 2 × (CYCLE_INTERVAL + CYCLE_WALLTIME_BUDGET) ≤ DEAD_MAN_BOUND` (corrected per spec-pass GV-2; see S-G12-02) |
| `EXPECTED_ACCOUNT_ID` | set at kickoff | literal broker account ID per role (see S-J-06) |
| `ALPACA_PROFILE` | explicit `dev` or `competition` | selects one closed credential/account role; no default or fallback |
| `ALPACA_TRADING_ORIGIN` | `https://paper-api.alpaca.markets` | exact canonical order-capable origin for both roles; HTTPS, default port, no path/query/fragment, redirects, aliases, or live-origin fallback |
| `STATE_DIR` | set at install | absolute path literal; home of journal, halt flag, epoch store — every instance resolves the same one (S-G12-07, S-CYC-11) |
| `BOOTSTRAP_DIAGNOSTIC_SINK` | installed before arming | Windows Application event-log source outside `STATE_DIR`; redacted diagnostics only, never state authority |
| `ANALYST_MCP_CAPABILITY_MANIFEST` | `config/analyst-mcp-readonly.json` | single positive source for toolsets and exact allowed tool inventory |
| `ANALYST_MCP_RUNTIME_LOCK` | `config/analyst-runtime-lock.json` | independently expected upstream commit, frozen dependency lock, interpreter identity, and immutable-file verification policy |
| `ANALYST_ALPACA_PROFILE` | `dev` | analyst child receives dev data-account credentials only, never competition executor credentials |
| `PRE_ARM_CERTIFICATE` | generated by S-ARM-01 | machine-readable dev-live-test evidence bound to `runtimeDigest` + role-neutral `policyDigest` |
| `SUCCESSFUL_DEV_LIVE_TEST_AT` | derived from `PRE_ARM_CERTIFICATE` | never manually supplied; missing/mismatched certificate blocks competition arming |
| `QUALIFYING_ACTIVITY_CHECKPOINT` | 2026-09-01 US market close | internal competitiveness check; not a published eligibility threshold |
| `QUALIFICATION_WINDOW_END` | 2026-09-02 US market close | after this, no qualification-specific entry attempt may start |
| `QUALIFICATION_MAX_LOSS` | *O5* | positive one-lot cap below the ordinary per-position cap for either sleeve |

## 0.5 Build priority — the MVP cut (added 2026-08-25, spec-pass NUT-1)

The schedule itself gates arming: CONCEPT §8 arms the competition account at
the later of kickoff and the successful dev-account live test. The 90 test
cases below (plus one
declared limit, S-G14-04, which has no deadline because it has no test)
therefore carry an explicit priority, so a solo build weekend never has to
guess what may slip:

- **Tier 1 — no order without it (build weekend, red-first):** S-CORE-01..03,
  S-CYC-01/02/04/05/06/11, G1, G2, G3, G4, G6, G7, G8 (incl. S-G8-06), G12
  (S-G12-01..05, S-G12-07 — writer fencing is order safety), G13,
  S-J-01..06, S-X-01/02/03.
- **Tier 2 — before the first unattended competition session:** G5, G10,
  G14 (S-G14-01..03), S-G12-06 (fence drill is pre-arm by its own text),
  S-X-06 (arming precondition for short-capable structures by its own
  text), S-CYC-03, S-CYC-07..10/12, S-X-04/05, S-J-07..09, S-ARM-01.
  Note: the tier-1 kill-switch (S-G13-01) closes
  via plain S-X-01 limits until the S-X-05 ladder lands in tier 2 — a known,
  accepted weekend gap.
- **Tier 3 — before Thursday Sep 3 (first expiry/deadline pressure):** G9,
  G11.

Tiers schedule the work; they do not waive it — a tier missing at its own
deadline blocks arming (tier 2) or requires a manual flatten decision by the
owner (tier 3), journaled either way.

The arming timestamp is not hardcoded to Monday:
`first_arm = max(COMPETITION_START, successful_dev_live_test_at)`. The dev
market-hours tests target Aug 26–27; failure delays the judged account. The
public golden path and submission deliverables follow the independent dates
in `SUBMISSION-SPEC.md` and may block a competitive release even when trading
safety is green.

### S-ARM-01 — dev live-test certificate

`successful_dev_live_test_at` exists only as the timestamp inside a PASS
certificate at `PRE_ARM_CERTIFICATE`; normal startup has no independent
timestamp override. The trusted local operator supplies that certificate, and
its complete-body digest detects accidental or unreviewed edits. This is an
integrity and semantic-evidence boundary, not an external attestation against a
malicious local operator or modified verifier that deliberately regenerates a
synthetic certificate.
The certificate contains the literal dev role/account ID, canonical paper
origin, UTC test window, `runtimeDigest` (over `src/**/*.ts`, `dist/**/*.js`,
`config/**/*.json`, `tools/*.mjs|*.py`, the package and tsconfig files, and
every file under `assets/` — the judge-visible stylesheets, bound since
2026-09-02), role-neutral `policyDigest`, and broker IDs/timestamps proving:

1. fresh market-hours option quotes including bid/ask sizes and quote timestamps
   were consumed by the real liquidity gate;
2. a defined-risk credit mleg received a positive broker acceptance state
   (`new`/`accepted`/`open`/`pending_new`, or `partially_filled`/`filled` when
   a fast fill precedes the driver's first observation) and then reached
   `filled` or harness-requested `canceled`, recorded as an `OUTCOME`; the observed broker order must equal
   the INTENT's client/broker identity, complete leg ratios and sides, one-lot
   quantity, credit limit kind, and price; any synchronous or asynchronous
   `rejected` state or shape disagreement makes the certificate FAIL;
3. exactly one lot of that same accepted credit lifecycle and broker order
   followed a real fill through broker reconciliation and journal `OUTCOME`
   rather than accept/cancel alone; acceptance and fill may never be assembled
   from different client or broker order IDs, and the later bound-account
   broker snapshot must contain exactly the signed filled leg quantities, not
   merely positions with compatible signs;
4. the credential-fence drill required by S-G12-06 passed; and
5. the final fully paginated dev snapshot contains zero positions and zero
   non-terminal orders.

After the first live cycle, an exceptional certificate exit is itself a
failure signal and enters the same gateway-bound S-G11 flatten regime before
the error returns. Broker reads and flatten cycles are retried to the configured
certificate bound; failure to prove a flat bound account is reported as
unresolved exposure, never a quiet process exit. Recovery first ensures a
journal-authoritative halt, adding a non-sticky abort `HALT` only when no halt
already exists (an existing stronger halt is never replaced), and exact client-order-ID
reconciliation must bring every pre-abort risk-increasing lifecycle to
broker-authoritative terminal evidence: reject, cancel, expiry, fill, or the
terminal partially-filled representation of a canceled/expired remainder; every
filled portion must then be flattened. `NOT_AT_BROKER` and `confirmation_unclear` are not finality after
a lost acknowledgement, regardless of flat observations. A candidate stable
snapshot is bracketed before and after by one atomic gateway operation that
proves writer epoch, refreshes its heartbeat, and reads journal truth under the
same mutex; the exact terminal `HALT` sequence must be unchanged across that
bracket. Changed authority, any intervening human halt transition, or a still-uncertain
lifecycle makes recovery unresolved.

The normal PASS path applies the corresponding open-state proof after the
credential fence: the certificate binds the exact `AUTH_FAILURE` `HALT` and
human `UNHALT` sequences produced by that run, and two atomic writer reads
bracket both the pre-fence and final stable broker snapshots. Before either
snapshot, every risk-increasing entry lifecycle must already have
broker-authoritative terminal truth; `NOT_AT_BROKER` and
`confirmation_unclear` remain unresolved. Both reads must retain authority,
show no active halt where the phase requires an open state, and observe the
same terminal journal sequence, so no lifecycle transition can race a flat
snapshot. The final bracket must also name the fence run's same `UNHALT` as
the terminal halt transition. A journal change, replacement halt, or un-halt
invalidates the certificate run.

Every certificate/recovery full snapshot carries one absolute deadline through
all account, position, stability, and paginated order reads; that deadline is
strictly below the writer takeover bound. While the operator checkpoint is
open, the driver refreshes its writer heartbeat and aborts the prompt on lost
authority. After approval it repeats the stable-flat snapshot bracket. The
manual `UNHALT` is then one kernel-mutex CAS over the exact expected epoch,
holder, `AUTH_FAILURE` HALT sequence, and terminal journal sequence; any drift
leaves the halt active.

The supervised certificate driver's entry/flatten attempt counts and intervals
are positive constants in the executable runtime identity. Ambient environment
variables cannot reduce or disable the abort fence/recovery path; changing a
bound is a reviewed code change and invalidates `runtimeDigest`.

`runtimeDigest` canonically covers executable core/shell code, schemas,
dependency locks, the MCP capability manifest, the pinned MCP runtime lock, and
the verified immutable launch artifacts, including the complete importable MCP
site tree. `policyDigest` canonically covers
every role-independent behavior value and risk limit, including the normalized
paper trading origin. Its closed exclusions are the identity fields
`ALPACA_PROFILE` and `EXPECTED_ACCOUNT_ID`, dev/competition credentials, and
the three host-local deployment locations `STATE_DIR`,
`BOOTSTRAP_DIAGNOSTIC_SINK`, and `PRE_ARM_CERTIFICATE` (P7 decision,
2026-09-01: the competition journal must not inherit the dev journal, so
`STATE_DIR` differs per role by construction and cannot be role-neutral
policy); secrets are neither serialized nor hashed into public evidence. A versioned field-classification
schema rejects every unknown config field until it is assigned to policy or the
closed identity/secret set. The competition role, account ID, credentials, and
provenance are then checked separately by S-J-06/S-CYC-09; switching only those
closed identity fields cannot invalidate an otherwise identical dev proof.

Any absent observation, unstable or incomplete snapshot, unresolved order,
account mismatch, or runtime/policy digest mismatch makes the certificate FAIL and blocks
competition arming in S-CYC-11. A runtime or role-independent policy change
invalidates the certificate and requires a new market-hours run. The test uses the dev
account only and keeps every submitted structure inside the same defined-risk
and limit-order rules as production. (A24, A28; #59)

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
  is retained, every later risk-increasing plan in the same analyst batch is
  blocked immediately, and the next cycle's phase 0 resolves it by client
  order ID against the broker BEFORE any new order is placed. (A2, A5, A23)
  **Close side (2026-09-02):** a close attempt is journaled as INTENT before
  submission and resolved by its own client order ID, exactly as an entry is.
  Because the escalation ladder visits a close lifecycle only while the
  exposure it belongs to is still on the book, a resting attempt can reach
  its terminal broker state (filled, canceled, rejected, expired) while no
  ladder step ever looks at it again; the position is then gone from the
  account while the journal still shows the close working, and the S-J-09
  projection loses its bijection with broker truth (A5). Phase 0 therefore
  reconciles close attempts as well as entries: every journaled attempt that
  is not yet terminal in the fold (`submitted`, or `confirmation_unclear`)
  is re-read at the broker by its attempt ID BEFORE any management or entry
  action of the cycle, and a terminal broker record is journaled as that
  attempt's OUTCOME with the broker's exact filled quantity and average
  price. An attempt whose broker record is still working is left to the
  ladder and journals nothing. An attempt the broker does not know, a lookup
  that fails, and an answer that settles nothing invent no outcome: the
  attempt stays reserved and non-terminal, blocks every new entry of the
  cycle, and appears in the G10 classification as `CONFIRMATION_UNCLEAR`
  (S-G10-04), a transient block rather than a `RESIDUE_UNRESOLVED` halt. The
  resolution is idempotent: an attempt already carrying the status the
  broker reports is re-read but never re-journaled.
- **S-CYC-05** Pre-submit revalidation via typed claimset (owner ruling
  GV-3, 2026-08-25): every core-approved action carries a **typed
  revalidation claimset** — the machine-readable list of facts its gate
  verdicts rested on. Immediately before submit, the executor refetches
  and re-checks against broker truth: the account (ID match per S-J-06 AND
  fresh equity re-evaluated against the kill predicate of S-G13-01),
  positions, non-terminal orders, the control epoch (S-G12-07), and the
  halt flag; the final core-carried net entry limit and its `reservedMaxLoss`
  are unchanged and still pass G1–G4. ANY violated claim (position
  appeared/disappeared, human
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
  non-conforming.
  **Linearization point (owner ruling 2026-09-02):** the completion of the
  final fresh broker read in this revalidation is the instant at which the
  action is deemed checked against broker truth. The broker offers no
  conditional submit (no book revision, no if-match on orders; only client
  order ID idempotency), so a book change that occurs after that read and
  before broker acceptance of the submit is not observable by any claim
  and does not void the action. Manual broker mutations (Alpaca UI or API)
  are therefore prohibited during the supervised certificate run and
  during competition operation, except while a durable `HALT` is in force
  and no writer holds authority. A violation is never silent: the next
  cycle's phase 0 classifies the foreign quantity as `RESIDUE` or
  `HUMAN_ACTION` (S-G10-02) and halts, and on the competition account it
  breaks the SUB-08 provenance latch irreversibly. The agent's own
  position stays defined-risk regardless; only the aggregate caps (G3/G4)
  can be exceeded for one cycle, by the human's quantity, never the
  agent's. Should the broker ever offer an atomic conditional submit, this
  declaration becomes an implementation obligation. (A13, #8)
- **S-CYC-06** Local journal append fails (disk full, lock), then no entry
  order or ordinary close is submitted this cycle. Sole emergency exception:
  if mutation authority remains valid and the action is mechanically proven to
  reduce an existing broker exposure without opening any leg, the executor may
  submit a close only through the route-independent S-G7 close lifecycle.
  Before submit it reloads broker position, partial fills, and every
  non-terminal or confirmation-unclear close attempt for that lifecycle. It
  adopts a sufficient existing ordinary close; otherwise it subtracts all
  fillable close quantity from the broker-closeable remainder and never creates
  a parallel child. Cancel/replace waits for broker-confirmed terminal status,
  and a final gateway revalidation prevents a fill-between-check-and-submit
  reversal. The first successful append is a `RECONCILIATION` with
  reason `AUDIT_GAP_EMERGENCY_CLOSE`, the journal-failure class, broker order/
  fill data, and either the adopted ordinary INTENT or an explicit statement
  that no durable prior INTENT existed for a genuinely new emergency attempt;
  it never invents rationale retroactively. If fencing/epoch state is also
  unavailable, no broker mutation is permitted. Tests cover matched intact and
  S-X-06 residue closes plus rejection of anything that could increase risk.
  (A5, A7; #53)
- **S-CYC-07** `git push` fails, then trading and local journaling continue;
  push is retried next cycle; the dashboard shows its last-updated stamp.
  Freshness may lag, content may not lie. (A9)
- **S-CYC-08** First cycle after any gap (reboot, sleep, stop, overnight):
  phase 0 re-derives everything from the broker, journals the gap (`GAP`,
  from–to, state then vs. now), and the cycle behaves as exactly one cycle —
  no catch-up trading, no doubled aggression. (A1, A20)
- **S-CYC-09** Bootstrap (very first cycle ever): an empty or absent journal
  is the bootstrap state ONLY if the broker account is also virgin. For dev,
  that means zero positions and zero non-terminal orders. For competition,
  before any order it additionally requires a fully paginated provenance bundle:
  paper role and `EXPECTED_ACCOUNT_ID`; broker creation timestamp at or after
  `COMPETITION_START`; opening cash and equity both exactly `INITIAL_CAPITAL`;
  zero positions and non-terminal orders; empty order and fill history from
  creation through the snapshot; and a complete account-activity ledger that
  holds nothing but opening capital funding — a virgin paper account carries
  exactly one such activity (recorded from the dev account 2026-09-02), so
  "empty" means "no activity other than the opening funding". An activity
  counts as opening funding exactly when its type is `JNLC`, its status
  `executed`, its currency `USD`, and its net amount a strictly positive
  exact cent value; the exact-cent sum of all such journals must equal
  `INITIAL_CAPITAL` (the rule is the sum, not the count). The remainder is
  graded: any non-`JNLC` activity, or an executed `JNLC` with a negative
  amount (cash that left the account), is reset/reuse evidence and latches
  `PROVENANCE_BROKEN`; so does a countable funding sum that differs from
  `INITIAL_CAPITAL` (a second funding is a reset, a different opening
  balance is not the prescribed account), and so does a creation instant
  before `COMPETITION_START` (not spend evidence, but an unfixable fact of
  ineligibility, so the irreversible latch costs nothing and forces the
  human); a cash-out latches even when the remaining journals still sum to
  the initial capital; a `JNLC` that merely fails to count (cancelled,
  non-USD, zero, amount absent) or an incomplete page blocks the bootstrap
  retryably without the latch — reuse evidence must be positive evidence
  that the account was spent. A complete but EMPTY ledger is virgin
  evidence: the broker posts the opening funding journal later than account
  creation (recorded 2026-09-02 on the competition account, created
  09:54:41Z with cash and equity at exactly the initial capital and no
  activity at all), so when no funding journal exists yet, opening cash and
  equity equal to `INITIAL_CAPITAL` together with empty, complete order and
  fill history are the funding evidence. No
  ordering between the funding instant and the creation instant is checked;
  creation is bounded by `COMPETITION_START` alone. Missing pages, reset/
  reuse evidence, or an allowed-looking $100k snapshot without creation/history
  proof fails closed. Declared limit: on a fresh `STATE_DIR` nothing can be
  journaled before the seed `BOOTSTRAP` (S-G12-02 seed rule), so a failed
  first proof leaves no journal entry and no persisted halt flag; it stays
  fail-closed (no order path exists without the seed), alarms through the
  fail ping, and is re-evaluated every cycle, and the first competition cycle
  is therefore run supervised in a terminal whose report is read. Then the cycle journals
  `BOOTSTRAP` (broker snapshot as the opening baseline; no "state then"
  exists and none is fabricated) and proceeds as a normal cycle. An empty
  journal facing a NON-empty account (lost/corrupted journal, wrong working
  directory, fresh clone without the journal branch) is NOT bootstrap: it is
  a `GAP` with unknown prior state, and every broker item is non-MATCHED by
  definition → G10 reconciliation + halt. A foreign book is never silently
  adopted as an opening baseline. Any failure in this first cycle follows
  the normal halt/alarm paths — the first unattended cycle fails visibly
  and safely, it cannot silently burn the day. Any later manual competition
  activity sets sticky reason `PROVENANCE_BROKEN`; un-halt cannot clear it,
  entries remain blocked, SUB-08 is failed, and only risk-reducing cleanup may
  continue. (#1 #54, A4, A20, A25)
- **S-CYC-10** Failed resolution stays blocking: if phase 0 cannot resolve a
  `CONFIRMATION_UNCLEAR` item or other unexplained state (broker still
  unreachable, lookup ambiguous), the item remains open, new entries remain
  blocked, and each cycle journals the still-unresolved state. Only a
  successful classification unblocks — "we tried" does not. (A2, A3)
- **S-CYC-11** Startup config validation, fail closed: before any broker
  call, the shell validates the mandatory configuration — `EXPECTED_
  ACCOUNT_ID` set and non-empty (an empty comparison never passes, see
  S-J-06); `ALPACA_PROFILE` is exactly `dev` or `competition`; the parsed
  order-capable origin for that role is exactly
  `https://paper-api.alpaca.markets` with HTTPS/default port and no path,
  query, fragment, redirect, alias, or fallback; the bound constraints of
  S-G12-02 satisfied; the
  `SNAPSHOT_STALENESS_BOUND` coupling of §0 satisfied; all G8 policy symbols
  present with the bounds in §0; the qualifying checkpoint/window are ordered
  as specified and `QUALIFICATION_MAX_LOSS` is positive and strictly below both
  ordinary sleeve per-position caps; `STATE_DIR` an absolute, resolvable, writable
  path; the installed `BOOTSTRAP_DIAGNOSTIC_SINK` writable; and — if
  `STRUCTURE_WHITELIST` contains any
  short-capable structure — the S-X-06 capability flag present. Any
  violation → the agent refuses to arm: no orders ever, `CONFIG_INVALID`
  journaled locally, active fail-signal to the dead-man check (S-G14-03).
  Before competition arming it also validates the S-ARM-01 certificate against
  the exact canonical `runtimeDigest` and role-neutral `policyDigest`; validates
  the competition-only identity/provenance fields separately; rejects unknown
  config fields; and verifies the analyst boundary: spawn
  the MCP child from a constructed minimal environment (never inherited), use
  `ANALYST_ALPACA_PROFILE=dev`, generate `ALPACA_TOOLSETS` from the single
  positive capability manifest, and validate the manifest schema/policy. The
  tracked runtime lock must independently name an immutable official upstream
  commit, its dependency lock, expected interpreter/content digests, and the
  canonical dependency-site digest derived from that pinned Git object's
  production dependency graph by a clean rebuild from its SHA-256-authenticated
  wheels, with wheel identity/hash rechecked and importable payload extracted
  without installer execution; every selected wheel tag must match the pinned
  interpreter/platform identity, and unsupported dependency markers fail closed.
  Hashes may never be learned from the currently
  installed environment. The server is
  built in a dedicated environment from that pinned source/dependency lock.
  Before spawn, the same launcher first removes every `__pycache__` directory
  and `.pyc` file from the dedicated environment and verifies their recursive
  absence. It likewise removes the installer-created `site/bin` tree and
  verifies its recursive absence, because Python could otherwise resolve its
  scripts as namespace-package modules even when the directory is absent from
  `PATH`. Still before executing any child code, the
  launcher verifies the exact interpreter/runtime bytes, immutable source/
  package files, package name/version, the complete importable dependency tree
  against that independently tracked digest, and launch environment against the
  independently expected values; all verified identities enter `runtimeDigest`.
  Only after every check passes may it start the child with Python bytecode
  writes disabled. Because the pinned stdio SDK injects a fixed OS default set,
  the launcher overrides every such value before spawn and its `-S` Python
  bootstrap reconstructs the complete validated environment before importing
  any MCP package code: secret values are captured from the child environment
  without entering argv, while every non-secret value is restored from an exact
  literal so an interpreter rewrite cannot drift it. It then inventories
  the tools actually offered and rejects a source/content/interpreter/dependency
  mismatch, surviving/generated bytecode, missing or ambiguous identity,
  launch-environment mismatch,
  extra/missing capability, or any analyst shell/CLI/executor secret. No arming
  or analyst request is released until that post-start inventory passes. Every
  external launch lifecycle operation — evidence collection, connect, inventory,
  tool call, and stop — has a hard runtime-digested deadline. Holder release is
  attempted independently of child shutdown, so a stalled transport cannot
  retain writer authority indefinitely. The launcher owns a cancellable child
  attempt before it waits for connect; timeout or connect failure must stop
  that attempt before returning,
  including when the connected child handle would arrive only after timeout.
  No started child may become unreachable through late promise settlement.
  Evidence cleanup/scans/hashes use
  asynchronous deadline-aware filesystem operations, and every Git subprocess
  receives the remaining aggregate timeout; a timed-out pre-spawn operation
  releases no child or analyst request. Required
  market-data origins are validated separately and are not confused with the
  order-capable paper-only origin.
  If `STATE_DIR` itself cannot open, the impossible local-journal requirement is
  replaced narrowly: write redacted `CONFIG_INVALID_STATE_DIR` to the pre-armed
  OS diagnostic sink, send a failure-only ping without a success-append
  precondition, and exit nonzero before broker access. Once repaired, the first
  journal append imports that diagnostic as `CONFIG_INVALID`. Missing
  configuration is indistinguishable from wrong configuration — both are
  fail-closed. (A12, A18, A24, A28; #56 #57 #58 #59)
- **S-CYC-12** Qualifying-activity competitiveness gate: a qualifying options
  activity is a broker fill on the fresh competition account joined to an
  ordinary core-approved options `INTENT` and `OUTCOME`. Dev/manual activity,
  emergency cleanup, and rejected, canceled, or unfilled orders do not count.
  At `QUALIFYING_ACTIVITY_CHECKPOINT`, absence journals and publicly exposes
  `COMPETITIVENESS_AT_RISK`; this is an internal winning signal, not a claim of
  external ineligibility. Until `QUALIFICATION_WINDOW_END`, the analyst may
  prioritize liquidity, fillability, and minimal risk for at most one live
  one-lot qualification lifecycle at a time. The proposal still traverses the
  unchanged analyst → schema → core → all gates → revalidation → limit-order
  path, with `reservedMaxLoss ≤ QUALIFICATION_MAX_LOSS`; no candidate or fill
  is fabricated or forced, and a no-trade verdict remains authoritative. The
  mode cannot widen `LIMIT_TOLERANCE`, whitelist, expiry, liquidity, sleeve, or
  concentration bounds. It starts no new qualification entry after the window
  and never changes G11. If no qualifying fill exists at window end, journal
  and dashboard show `WINNING_ACCEPTANCE_FAILED`; submission then requires an
  explicit owner waiver while the external rule remains unknown pending the
  kickoff organiser/form recheck. Tests cover an all-week no-candidate path,
  repeated safe non-fills, ordinary qualifying fill, cap boundary, attempted
  gate bypass, and zero new entries after the window. (A27; #65)

## 3. Entry gates

### G1 — defined risk only (A11)

- **S-G1-01** Vertical debit spread → accepted; `maxLoss = submittedDebitLimit
  × 100 × qty`.
- **S-G1-02** Vertical credit spread → accepted; `maxLoss = (width −
  submittedCreditLimit) × 100 × qty`.
- **S-G1-03** Iron condor → accepted; `maxLoss = (widest wing −
  submittedNetCreditLimit) × 100 × qty`.
- **S-G1-04** Long single option → accepted; `maxLoss = submittedBuyLimit ×
  100 × qty`.
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
- **S-G2-06** Partial fill 4/10: filled 4 use broker fill price for actual
  position max loss; resting 6 retain the submitted-limit reservation. Their
  total is at most the original 10-lot reservation, counted once; confirmed
  price improvement releases only the filled portion's difference.

For every candidate, G1–G4 use one `reservedMaxLoss` derived from the exact
final net mleg entry limit that the executor is permitted to submit, after tick
rounding and immediately before reservation/INTENT. A quote mid, target premium,
expected fill, or sum of independently rounded leg estimates is never the budget
input. The reservation covers the least favourable valid fill at that limit;
price improvement releases excess only after broker reconciliation. Changing
the limit requires an atomic max-loss recomputation and fresh G1–G4 approval.
The shell receives and submits this core-carried net limit unchanged.
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
  (equality passes); above → veto `POSITION_SIZE`. `maxLoss` is the same
  submitted-limit `reservedMaxLoss` used by G1/G2.

### G4 — per-underlying concentration

- **S-G4-01** Sum of exposure (filled + reserved, both sleeves) per
  underlying after the candidate `≤ MAX_UNDERLYING_EXPOSURE` → pass;
  above → veto `CONCENTRATION`. Candidate and resting-order exposure use that
  same submitted-limit `reservedMaxLoss`.

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

- **S-G7-01** Entry client order ID is a deterministic function of (trading
  day, cycle index, structure identity, action kind); same inputs → same ID and
  different cycle → different ID. The structure identity (every leg's contract
  id, side and ratio, order-independent) enters as a truncated SHA-256, so
  every id the core derives — entry, exposure lifecycle, close lifecycle,
  close attempt — stays within the broker's synchronous 128-character
  `client_order_id` limit (observed live 2026-09-02: a hex-encoded identity
  of 177 characters was rejected on every entry; the fake broker enforces
  the same limit with the same message; `tests/g7-order-id-length.spec.ts`). Every close instead owns one stable,
  route-independent `closeLifecycleId` derived from the exposure lifecycle.
  Ordinary, emergency, expiry, kill, and watchdog routes reconcile/adopt that
  lifecycle rather than invent a second close. A broker attempt ID is
  `(closeLifecycleId, generation)` and at most one child may be non-terminal or
  confirmation-unclear. Before submit, broker position and partial fills are
  reloaded, all fillable close quantity is subtracted from the remaining
  closeable amount, and cancel/replace requires confirmed terminal state. The
  final gateway check catches fill-between-reconcile-and-submit; no child may
  reverse or enlarge exposure.
- **S-G7-02** Re-submission of an already-submitted entry or close-attempt ID
  (crash replay) → broker duplicate response is treated as "already submitted":
  reconcile and adopt the lifecycle, journal, do not error and do not re-send
  with a fresh ID. Tests cover full-size existing close, partial fill/residual,
  lost cancel/confirmation-unclear, terminal replacement, fill at the final
  dispatch boundary, intact mleg and short-stock residue, and emergency retry.

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
  structure outside `STRUCTURE_WHITELIST`, remaining trading sessions outside
  inclusive `[EXPIRY_MIN_SESSIONS, EXPIRY_MAX_SESSIONS]`, any leg with
  `abs(strike - spot) / spot > MAX_STRIKE_DISTANCE_FRAC`, or structure qty
  `> MAX_CANDIDATE_QTY` → that candidate is vetoed `WHITELIST` with the
  offending field named. Equality at each bound passes this gate; one session,
  one basis point of spot-distance, or one contract beyond it fails. G2/G3
  budget and exposure limits still apply independently and the strictest gate
  wins. Missing or contradictory bounds are startup-invalid per S-CYC-11.
  (A12, A28; #57)
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
  (S-G14-03) while close attempts continue. Sole terminal exception: a residue
  already proven and journaled as `DECLARED_EXPIRY_HOLD` under S-X-06 is not
  re-enqueued; it remains broker-visible until expiry. (A17; #55)
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
  The residue set the resolution acts on is re-derived from the book read
  in the management step, not from the phase-1 classification that the
  journaled RECONCILIATION reports: a residue that vanished meanwhile is not
  attempted at all, and one whose quantity changed is closed at its current
  quantity.
  (A11)
- **S-G10-04** Intent without outcome: broker queried by client order ID;
  found terminal → outcome journaled now; found still working → identity
  journaled but the lifecycle remains `CONFIRMATION_UNCLEAR`, reserved,
  entry-blocking, and queried again; not found → journaled `NOT_SUBMITTED` with
  the same retained uncertainty. Neither a negative lookup nor a working match
  proves that a lost-acknowledgement request has reached terminal truth; only a
  broker-terminal outcome or a pre-submit `REVALIDATION_VOID` releases it. A
  normally acknowledged working submit is durably distinguished as
  `ACKNOWLEDGED_WORKING` and follows ordinary fillable-risk accounting. That
  transition is valid only directly from `INTENT` (or idempotently for the same
  broker order already `fillable`); it can never repair `CONFIRMATION_UNCLEAR`
  or a terminal lifecycle. Entry client-order IDs are unique across INTENTs;
  broker-order identity, filled quantity, and cumulative fill value are
  monotonic. The exact broker decimal average is retained beside the
  half-away-rounded cent value and the two must agree; every newly observed
  exact fill increment is classified against the submitted limit, including
  increments hidden by an aggregate average. The rounded display value uses
  its conservative interval edge for risk accounting (upper for debit, lower
  for credit).
  `REVALIDATION_VOID` is valid only before submit; and no OUTCOME may weaken or
  overwrite terminal truth. A cancel, expiry, or rejection after a partial fill
  must preserve the observed filled quantity as terminal partial-fill evidence.
  Any invalid transition makes lifecycle reconstruction fail closed.
- **S-G10-05** A manual human trade is journaled `HUMAN_ACTION` — visible to
  the judge as exactly that, never absorbed into agent reasoning. On the dev
  account it follows ordinary reconciliation. On the competition account it
  also sets irreversible `PROVENANCE_BROKEN`, blocks entries and SUB-08, and
  cannot be cleared by un-halt; risk-reducing cleanup remains permitted.
  (#8 #31 #54, A25)

### G11 — deadline flatten and Friday regime (A17, A22)

- **S-G11-01** On `FLATTEN_DATE`, all entry actions veto `DEADLINE` (no
  position is opened on the day everything must die), every cycle generates
  whole-structure closes for all open positions and cancels all non-terminal
  orders. Closes run the close-escalation ladder (§7) from the first
  `FLATTEN_DATE` cycle onward, so an illiquid leg is walked across the
  spread with hours of margin, not hoped into a fill; by Thursday close the
  assertion is zero risk-bearing positions AND zero non-terminal orders. The
  only nonzero broker position permitted is a currently valid
  `DECLARED_EXPIRY_HOLD` under S-X-06; the assertion and dashboard call the
  account not-flat when one exists. Any other violation halts and alarms.
- **S-G11-02** Friday Sep 4: all entry actions veto `DEADLINE`; the agent is
  journaling-only; broker mutations are limited to the management set —
  which is empty when Thursday succeeded except that a declared expiry hold
  remains observable and requires no mutation. Failure path (deviation from the
  normal decision-B regime, journaled as such): if the Thursday assertion
  failed, Friday cycles still execute risk-reducing closes via the ladder
  until flat — a stuck position is never abandoned to expiry mechanics just
  because the calendar said "journaling-only". (A17, #19)
- **S-G11-03** Fri 17:00 CEST: dedicated `DEADLINE_RECONCILIATION` entry —
  full broker snapshot + reference to the submitted revision.
- **S-G11-04** Fri US close: final snapshot, `TERMINAL` entry, controlled
  end of scheduler and dead-man expectation. Artifacts frozen thereafter.
  If the S-G11-02 failure path is STILL risk-bearing at Friday close, the
  `TERMINAL` entry records the open remainder explicitly (structure, max
  loss, expiry consequence) and raises the active fail-signal — the story
  hands over to the owner in writing, never in silence. A valid
  `DECLARED_EXPIRY_HOLD` is recorded as a non-flat, zero-additional-liability
  terminal residue and does not masquerade as this failure path.
  A Friday entry that cannot be written may not end in silence. Exactly two
  conditions prevent the entry: the decision snapshot cannot be assembled
  from the observed book and market, or the gateway refuses the
  authoritative append. In both, no journal entry exists and the journal is
  therefore unavailable as the handover channel, so the run raises the
  active fail-signal with the alarm condition
  `DEADLINE_ENTRY_NOT_JOURNALED`, qualified by the failure class
  (`SNAPSHOT_NOT_ASSEMBLED` or `ENTRY_NOT_JOURNALED`) and the underlying
  reason, and reports it in a closed `failure` field that is null exactly
  when the entry landed; the process exit is non-zero on every such path
  (an abort before either check reaches the same signal from the CLI as
  `ENTRY_ABORTED`). A `TERMINAL` reporting a risk-bearing remainder remains
  a success of the entry, not a failure of it. Both entries are owner-driven
  one-shot processes (`deadline-cli`): `STATE_DIR` comes from the validated
  configuration only, writer authority is acquired through the gateway like
  the agent's, nothing is appended when a live writer holds the epoch, and
  a second `TERMINAL` is refused by a pure admission rule over the journal.

## 5. State and failure gates

### G12 — single instance and halt (A13, A19)

- **S-G12-01** Lock held by a live instance → the second instance makes no
  broker call, appends a single `SUPPRESSED` line **as a witness append**
  (the authority-free gateway class defined in S-G12-07); the scheduled
  second instance exits 0, whereas an owner-driven one-shot tool (the
  certificate CLI, the deadline CLI) exits non-zero on suppression so the
  operator learns that the requested run did not happen.
  `SUPPRESSED` is **staleness-neutral**: it does not count as a journal
  append for the watchdog's staleness clock (S-G14-02) and never triggers
  a success ping (S-G14-03) — a dead or hanging holder can never be kept
  looking alive by its own suppressed successors. Journal appends from any
  instance reach the JSONL only serialized (single writer path / file
  lock), never interleaved. Runtime composition therefore acquires or is
  suppressed before the first account, calendar, position, order, or market
  broker read; the scheduled suppressed process exits 0 after its witness.
  (#23, #40; owner ruling GV-2, 2026-08-25)
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
  flag. Once a halt is sticky, later HALT entries remain audit evidence but
  cannot replace its projected reason or reduce its strength. (A19)
- **S-G12-05** The halt flag is a persisted file, part of the snapshot, and
  a core input — not ambient state read inside the core.
- **S-G12-06** Credential fence (decision D): an auth failure (401/403) is
  journaled as `AUTH_FAILURE` — a distinguishable state, not generic
  `WORLD_UNREACHABLE` — and blocks all orders. This applies to every
  authenticated startup read, including account identity and exchange
  calendar, before later cycle reads use the same fence. The runbook fact is spec:
  a key rotation does NOT cancel working orders; the documented fence
  procedure therefore ends with a working-order check/cancel in the broker
  dashboard, and the fence is drilled once on the dev account pre-arm
  (drill outcome journaled there). Re-arm after a fence only under halt,
  after full reconciliation. (#34, A19)
- **S-G12-07** Writer fencing (owner ruling GV-2, 2026-08-25; gateway
  categories per KGV class fix): every authoritative request must carry a
  **control epoch** equal to the current value in the persisted epoch store,
  checked at the SINGLE final mutation gateway through which every broker
  mutation and every journal append passes. A stale or unreadable epoch rejects
  the request. The OS-level lock only serializes local gateway and acquisition
  work; holding or reacquiring it never grants authority. The gateway knows
  exactly two request classes:
  **authoritative mutations** (orders, cancels, and all journal entries
  that assert agency — `INTENT`, `OUTCOME`, `CYCLE`, `RECONCILIATION`, …)
  require a currently valid authority; **witness appends** (`SUPPRESSED`,
  and a fenced writer's own `FENCED_OUT` demise notice) carry NO
  authority, may mutate nothing at the broker, are staleness-neutral
  (S-G14-02), never trigger a success ping, and reach the JSONL only
  through the same serialized append path. One purpose-specific monotonic
  safety interlock is narrower than either request class: a startup process
  that independently observes `AUTH_FAILURE` or `ACCOUNT_BINDING_MISMATCH`
  may append only that `HALT`, stamped with the current persisted epoch under
  the gateway mutex. It cannot reach the broker, acquire or release another
  holder, append any other type, or clear a halt. This prevents a fresh rival
  holder from suppressing a required broker-identity fence. The same mutex
  reconciles the halt projection from the authoritative journal and protects
  a final halt read immediately before broker I/O. A crash after the durable
  `HALT`/`UNHALT` line but before its projection write is therefore repaired
  before the state is exposed or an entry is admitted; an already-authorized
  but stale entry is vetoed. Cancel and explicit close remain available under
  S-G12-03. The mutex is a kernel-owned Windows named pipe (Linux: abstract
  socket), derived from the OS-canonical physical `STATE_DIR` so aliases of one
  directory converge, exclusive while its process lives and automatically released on
  close or crash. It has no stale-file cleanup, age takeover, or waiting
  timeout. Epoch acquisition is a single
  **atomic compare-and-increment** on the persisted epoch store: of two
  concurrent takers exactly one wins; the loser observes the changed
  epoch and demotes itself to a witness. The epoch store lives at the
  configured absolute, OS-canonical `STATE_DIR` (§0; validated at S-CYC-11 — a relative
  or unresolvable path never arms), so every instance on the host —
  agent, watchdog, manual run — validates against the SAME store by
  construction, and it follows the S-CYC-09 rule: an absent/reset epoch
  store facing a non-virgin account is never re-seeded silently — it is
  the GAP path, halt included; a re-seed in the virgin BOOTSTRAP state is
  itself journaled. Declared limit (KGV-4 residual, accepted): two hosts
  or two deliberately different `STATE_DIR`s cannot fence each other —
  this is a single-host, single-state-dir design; the backstop is
  construction (A23) plus the account-bound order check (S-J-06). Order
  of operations is fixed: fence (atomic epoch
  increment) → reconcile (phase 0 against broker truth) → act. Tests:
  (1) a paused writer resuming after a takeover gets every authoritative
  mutation — entry, cancel/close, management, or authoritative append — rejected
  even while it still holds or reacquires the OS lock, and can still append
  exactly one `FENCED_OUT` witness
  line; (2) no code path mutates broker or journal except through the
  gateway, including spawned MCP/CLI processes whose constructed environments
  contain no competition mutation capability outside it; (3) two concurrent
  takeover attempts yield exactly one winner;
  (4) the watchdog's flatten runs under its own atomically acquired epoch; and
  (5) a writer paused immediately before final gateway dispatch is rejected if
  takeover changes its epoch. (#23, #9, A13)

### G13 — drawdown kill-switch

- **S-G13-01** `equity < KILL_EQUITY_THRESHOLD` → under the valid fence,
  durably set sticky halt and journal the kill-management intent; cancel every
  risk-increasing non-terminal entry order; reconcile cancel-versus-fill and
  partial-fill races by broker ID; reload positions and orders; then flatten
  that post-cancel book through whole-structure/residue policy and journal
  `KILL`. Existing risk-reducing close/protective orders are adopted into close
  management, not blindly canceled or duplicated. A lost/unclear cancel remains
  fillable exposure. Kill management continues with alarm until broker truth
  shows both zero risk-bearing positions and zero risk-increasing non-terminal
  orders; only then may it report flat. Tests cover full and partial fill during
  cancel, lost cancel acknowledgement, a pre-existing close order, and a kill
  triggered by S-CYC-05. Equality does not trigger (strict <).
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
  S-G12-07 epoch, then performs full phase-0 classification and sets halt.
  `MATCHED` intact structures close whole via S-X-05/mleg. Every `RESIDUE`
  dispatches through S-G10-03: orphan shorts and assigned short stock use the
  uncapped marketable-limit S-X-06 path with immediate fail-ping; bounded long
  residue follows its zero-floor policy. A residue is never also submitted as
  a whole-structure close. All actions run under the watchdog's own incremented
  epoch and are journaled via the serialized path. A combined test starts with
  an intact spread, orphan short option, and assigned short stock and asserts
  one fence, mleg close, both S-X-06 closes, no duplicate action, halt, journal,
  and fail-ping. A
  fenced old writer that wakes later cannot mutate anything (S-G12-07).
  Controlled end: once a `TERMINAL` entry stands in the journal (S-G11-04),
  the deployment has ended by design and the watchdog stands down. A journal
  that stops growing after the controlled end is the intended outcome, not
  evidence of a hung writer, so the staleness assessment yields the quiet
  reason `DEPLOYMENT_TERMINAL`, and that reason outranks every other: no
  fence, no epoch increment, no takeover halt, no book recovery, no broker
  mutation and no ping, regardless of session hours and of how far the last
  authoritative append lies beyond `DEAD_MAN_BOUND`. The flag is a fold over
  the same journal read the staleness clock uses, passed into the pure
  assessment, which never reads a journal itself. Absent a standing
  `TERMINAL`, staleness behaviour is unchanged. The scheduled watchdog
  composes the real account-bound broker, the ping port and a close-oriented
  market window from the validated configuration; any configuration or
  credential problem degrades to fence-only behaviour that still halts and
  still fail-pings. Authority is the fence, not the observation: when the
  epoch acquisition returns anything but `WON` or `GAP_HALT` — a live holder
  that still heartbeats (`SUPPRESSED`), a rival taker that won the race
  (`LOST`), or a refusing store (`REFUSED`) — the run may not halt, journal,
  close or mutate, and therefore does the one thing still open to it: it
  fail-pings on a closed alarm condition naming the age of the silence
  (`WATCHDOG_NO_AUTHORITY:staleness <n> ms`) and the reason the fence was
  denied (`WRITER_HUNG_LOCK_HELD:<holderId>`,
  `WATCHDOG_AUTHORITY_LOST:<epoch>`, `WATCHDOG_AUTHORITY_REFUSED:<reason>`).
  A journal stale beyond `DEAD_MAN_BOUND` during a session while someone
  else holds authority is the developer-must-look state, never a quiet one.
  A takeover whose HALT append does not land reports `halted: false` with
  `HALT_NOT_JOURNALED` on its fail ping; the next firing, staleness
  unchanged, takes over again and lands the halt once the journal is
  writable, so the residual window is one watchdog interval.
  Witness appends (the S-G12-07 class — `SUPPRESSED`, `FENCED_OUT`) never
  reset this staleness clock.
- **S-G14-03** External detection (decision C): the agent sends a success
  liveness ping to healthchecks.io only AFTER a durable local journal append; the check's
  schedule follows `America/New_York` session slots; missed ping alerts
  Felix within the 45–60 min SLA via mail + the named push channel
  (`DEAD_MAN_BOUND` + `ALERT_DELIVERY_BUDGET` stay ≤ the 60-min edge). The
  same check also carries ACTIVE alarms. The append precondition applies only
  to success pings: an active failure ping is failure-only and may be sent
  before any journal exists, specifically for S-CYC-11 bootstrap/config errors;
  it can never refresh liveness. A cycle governed by
  `CYCLE_WALLTIME_BUDGET` computes its ping plan inside the cycle but delivers
  only after the aggregate work wins its deadline race; a losing background
  continuation cannot emit success. Delivery inherits the remaining absolute
  deadline, and any non-2xx HTTP response is failure. The set of alarm-worthy
  conditions has ONE source, not a second list here: every case whose own
  text prescribes an "active fail-signal" or "fail-ping" (currently
  S-G9-02, S-G10-02, S-CYC-11, S-G11-01, S-G11-04, S-X-05, S-X-06; the
  case texts govern, this parenthesis is illustrative) signals via an
  explicit fail-ping to the check's fail endpoint — alerting immediately,
  not by waiting for a missed ping. A cycle that journals such a condition
  sends the fail-ping INSTEAD of the success ping. A test makes `STATE_DIR`
  unopenable and proves: zero broker calls, redacted OS diagnostic, active
  fail-ping, no success ping, nonzero exit, and import of that diagnostic into
  the repaired journal. (#56, A18)
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
  `FENCED_OUT`, `HALT`, `UNHALT`, `KILL`, `DEADLINE_RECONCILIATION`,
  `TERMINAL`, `MANAGEMENT_REFUSAL` (added 2026-09-05 by S-X-08; not a
  primary type). Labels
  like `WORLD_UNREACHABLE`, `WORLD_PARTIAL`, `STALE_SNAPSHOT`,
  `AUTH_FAILURE`, `REVALIDATION_VOID`, `SCHEMA_VETO`, `NOT_SUBMITTED`,
  `CONFIG_INVALID`, `CONFIG_INVALID_STATE_DIR`, `PROVENANCE_BROKEN`,
  `AUDIT_GAP_EMERGENCY_CLOSE`, `DECLARED_EXPIRY_HOLD`,
  `COMPETITIVENESS_AT_RISK`, `WINNING_ACCEPTANCE_FAILED`,
  `BROKER_PRICE_BREACH` are reason codes
  *inside* `CYCLE`/`OUTCOME`/
  `RECONCILIATION` entries, not extra types. `OUTCOME` carries a status from the closed set {filled,
  partially_filled, rejected, canceled, expired, confirmation_unclear} —
  a rejection is an `OUTCOME` with status `rejected`, structurally
  incapable of being read as an execution. Every scheduled invocation
  emits exactly one PRIMARY entry: `CYCLE` for a full cycle, else its
  substitute (`BOOTSTRAP`, `GAP`, `SKIP`, `SUPPRESSED`, `FENCED_OUT`) —
  "exactly one CYCLE per cycle" never demands a second entry beside a
  substitute (KGV-11). Which entries are witness appends (authority-free,
  staleness-neutral, no success ping) is defined ONCE, in S-G12-07 —
  currently `SUPPRESSED` and `FENCED_OUT`; no second list exists. Every primary entry written from a TAKEN snapshot (`CYCLE`,
  `BOOTSTRAP`, `GAP`, and `SKIP` when the snapshot phase ran) records the
  quote samples observed (per watched underlying: bid, ask, sizes, quote
  timestamps), so the next cycle's frozen-market history (§1, S-G6-05) is
  reconstructed from the journal, not from memory; snapshot-less entries
  (`SUPPRESSED`, connectivity-failure cycles) simply leave a hole that
  the per-underlying age rule of §1 handles. (A4, A5, A1)
  Every snapshot-bearing primary entry also records the full account summary
  needed for public reconciliation: account ID, cash, equity, positions, and
  all non-terminal orders. Order/fill activity retains broker IDs, timestamps,
  quantities, and prices; no dashboard metric depends on an unjournaled broker
  value. (A25, A27)
- **S-J-04** Every `INTENT` carries: sleeve, structure + legs, exact submitted
  net entry limit, `reservedMaxLoss`, client order ID, the gate verdict vector,
  and a rationale with a
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
  `EXPECTED_ACCOUNT_ID`. Before every mutation the gateway binds the closed
  triplet `{ALPACA_PROFILE, verified canonical paper trading origin,
  EXPECTED_ACCOUNT_ID}`; the paper role in S-CYC-09 may be derived only from
  this validated origin, and S-ARM-01 records the same origin. A role, origin,
  or account mismatch → refuse all orders, journal, halt. Tests reject the live
  origin even when it reports the expected ID, as well as an unknown profile,
  redirect, foreign host/port/path, and the valid paper origin with a wrong ID.
  An
  unset or empty `EXPECTED_ACCOUNT_ID` is a config error, fail-closed per
  S-CYC-11 — an empty-vs-empty comparison never counts as a match.
  Every order-related entry records the role, canonical trading origin, and
  account ID. Market-data origins are a separate allowlist; they cannot grant
  order capability. (A24)
- **S-J-07** Dashboard renders exclusively from the journal; it shows a
  last-updated stamp; a stale dashboard is visibly stale. "Coherent" is
  operational, not aspirational: every displayed figure derives from the
  entries of ONE committed journal revision, the page names that revision
  next to its last-updated stamp, and builds are atomic (render aside, then
  swap) — a viewer never sees a half-written page. Test: a build
  interrupted mid-render leaves the previous page fully intact. Every revision
  is deployed first to an immutable candidate URL. An anonymous external probe
  must observe the expected journal revision, evidence cutoff, and freshness
  there before an atomic alias operation may point the stable submitted URL at
  that candidate. A failed or mismatched candidate probe never moves the alias;
  an alias or stable-origin verification failure restores the prior accepted
  immutable deployment and raises the active fail-signal. The pipeline writes a
  deployment receipt keyed by journal revision outside the append-only trading
  journal, so acceptance does not create a recursive new journal revision.
  Tests cover candidate rejection, successful promotion, and rollback for the
  deadline and terminal appends. "Content may not lie" reaches the
  presentation layer. The gate is the S-ARM-01 runtime digest: every file
  under `assets/` (the stylesheets inlined into every page) is enumerated
  like source — recursively, with no directory name skipped there, text
  files LF-normalized and every other file hashed by its raw bytes — so a
  stylesheet change after the certificate voids it
  exactly like a code change and the arming gate refuses (owner ruling
  2026-09-02 after R33/R34; the rendered dashboard is reviewed by the owner
  before the certificate run, never restyled after it). Defence in depth,
  not the gate: the pure renderers audit the stylesheet text before
  rendering and refuse constructs that hide, collapse, or paint away
  content, break out of the `<style>` block, or load an external resource
  (`display:none`, `visibility`, `opacity`, zero-alpha colours, zero sizes,
  negative offsets, `overflow:hidden`, absolute placement, transforms,
  clipping, CSS escapes, `<`, `@import`, `url(`; also through `var()`
  fallbacks and custom-property definitions); a refused stylesheet is a
  failed build (`DASHBOARD_BUILD_FAILED`) and the previous page stands. The
  audit is textual and known incomplete (R34/R35: native nesting,
  `@container`, shorthand zeros, exponent notation, string-embedded braces
  and string-embedded comment openers, a `</style>` breakout hidden inside
  a CSS comment — that one is refused by the renderers' own `</` assertion
  on the raw text, which is the only layer for it and is measured as such,
  while a lone `<` inside a comment passes both layers and is inert, since
  only `</` can close the style element — and any hiding by
  colour, near-zero size, or off-canvas spacing), which is why the
  digest, not the audit, carries the guarantee (`src/shell/digests.ts`,
  `src/shell/presentation-guard.ts`, `tests/p9-presentation-assets.spec.ts`,
  `tests/p9-presentation-guard.spec.ts`). (A9, A10, A26)
- **S-J-08** Branch isolation is checked, not assumed: the journal writer
  pushes exclusively to the configured journal branch and refuses any other
  ref — a test configures a non-journal target and asserts refusal; the
  refusal itself is journaled locally. Human submission work never touches
  that branch (enforced by convention plus the writer-side refusal; the
  collision of #44 is thereby structurally one-sided). (A13, #44)
- **S-J-09** Judge-facing performance projection is a pure fold over one
  committed journal revision and an explicit cutoff timestamp/kind. It rejects
  entries newer than that cutoff and reports: journal revision; evidence-cutoff
  timestamp and kind; submitted account ID; BOOTSTRAP start equity (which must
  equal `INITIAL_CAPITAL`) and current equity; absolute and percentage P&L
  relative to that broker-recorded start;
  realized and unrealized P&L separately; running peak and maximum drawdown;
  income/convex sleeve attribution; positions; non-terminal orders; and the
  actual first-arm, first-trade, flatten, and deadline timestamps observed at
  or before the cutoff (a future milestone is `null`, never fabricated). Realized
  and unrealized attribution uses broker order/fill/position values joined to
  `INTENT` lifecycle identities. The sole S-CYC-06 emergency close instead
  links to its `AUDIT_GAP_EMERGENCY_CLOSE` reconciliation. Any other unmatched value is displayed as
  `UNATTRIBUTED` and a reconciliation discrepancy — it is never assigned to a
  sleeve by inference. Tests fold fixed presentation- and deadline-cutoff
  journal fixtures and reconcile every total back to its broker-derived
  components; an interrupted render remains covered by S-J-07. (A5, A10,
  A25, A27; #31 #50 #52)

## 7. Execution pricing (A15)

- **S-X-01** Every order is a limit order; the limit derives from the
  decision's own quotes (mid ± `LIMIT_TOLERANCE`). That tick-rounded submitted
  limit is the same value G1 uses for worst-fill max loss and G2–G4 consume
  immediately before INTENT/submit; a re-price repeats all four gates atomically.
  Market orders do not exist in the codebase.
- **S-X-02** A fill at the limit is by construction within the decision's
  assumptions; any broker-reported deviation (price improvement is fine,
  anything worse is impossible for limits, partial fills are handled by
  S-G2-06) is journaled with the fill data verbatim. Any broker record worse
  than the submitted net limit is an explicit `BROKER_PRICE_BREACH`: halt,
  alarm, reserve the actual exposure, and block new entries pending
  reconciliation; the system never pretends the original bound still held.
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
  and never legs out of an intact structure (A11): the eviction targets,
  the flatten closure, the residue targets, and the eligibility check
  before every submission are all derived from a broker read taken inside
  the management step itself, never from the phase-1 snapshot the analyst
  step is older than. A step that plans an attempt and then refuses it
  records that refusal in the cycle report, so planning from a stale book
  is measurable instead of being silently absorbed by the eligibility gate.
  After a ladder cancel, the next generation's quantity is the exposure of
  that same fresh read, bounded above by the unfilled part of the canceled
  attempt: a fill the fresh read already excludes is never subtracted from
  it a second time, and a fill that landed after that read can never be
  over-closed.
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
  residue remain capped (credit floor zero). A long residue may reach terminal
  `DECLARED_EXPIRY_HOLD` only after zero-floor close attempts remain unfilled
  and one same-cycle proof shows: complete fresh option and underlying quotes;
  positive long quantity with no paired short option or share liability; bid
  exactly zero; out-of-the-money economics; and broker-confirmed protection
  from automatic exercise (or an accepted do-not-exercise instruction). The
  journal records every proof input and "hold to expiry, zero additional
  liability"; the fail-ping lifts, but the broker position stays visible and
  every judge surface says not-flat until expiry. A stale quote, missing leg,
  ITM state, or uncertain exercise policy keeps escalation and alarm active.
  (#18 #55, A11, A17, A23)
- **S-X-07** The cycle's market observation covers the book. A cycle builds
  its observation window from two independent sources: the *entry* window it
  has always used — the nearest three expiries inside
  `[EXPIRY_MIN_SESSIONS, EXPIRY_MAX_SESSIONS]` within a narrow strike band, a
  discovery device for what may be opened — and the *identities* of every
  option contract the account currently holds, taken from the book read of
  that same cycle. Held identities are quoted directly and are never subject
  to the entry window's session bounds or strike band, so a structure whose
  expiry has come nearer than `EXPIRY_MIN_SESSIONS` (the 2026-09-03 incident)
  and one whose strikes the underlying has drifted away from are both still
  priceable. Consequences that are part of the case, not of the
  implementation: the book read therefore precedes the market read inside
  phase 1 instead of running beside it, and a half-answer on either side is
  still the S-CYC-02 abstention; a held identity the broker still cannot quote
  reaches the management step as a missing price and is journaled under S-X-08
  rather than disappearing with the window;
  and the watchdog and the deadline runtime keep their close-oriented window
  (from zero remaining sessions, full configured strike distance) but build it
  through the same shared, pure window builder, so there is exactly one place
  where a window is defined. That window covers a near expiry but is still a
  band around spot, so both of them pass their own held identities into it as
  well: the flattener of last resort is the last place that may lose a
  contract to a band. A watchdog that could not compose reads no book, builds
  no window and passes none — it fences and halts exactly as before.
  (#72 #73, A17, A29)
- **S-X-08** A management refusal is journaled, not merely printed. Whenever
  the management step plans a close and then does not submit it — a plan veto,
  an unavailable price, a failed eligibility check — it appends a
  `MANAGEMENT_REFUSAL` entry naming the exposure lifecycle, the close route,
  the generation the attempt would have carried (`null` when the close plan
  itself was vetoed) and the reason. It is an entry of its own and not a field
  on `CYCLE` because of the order the cycle already has: the primary entry is
  written before any order exists (A5, A7) and the management step runs after
  phase 4, so at CYCLE time no refusal has happened yet. It is deliberately
  *not* a primary entry — exactly one primary per invocation still holds
  (S-J-03) — and it is appended at the instant of the refusal, so a process
  that dies mid-management still leaves the refusals it had already reached. A
  cycle that holds a position on purpose and one that tried and was refused
  are therefore distinguishable from the durable record alone, without the
  process's standard output (#74, A4). A refused append is the ordinary A7
  case: nothing is retried and nothing pretends. The deployment obligation of
  #75 is separate and lives with the installer, not here: the scheduled cycle
  task redirects the printed report to a kept file next to the journal, so the
  full report survives the run that produced it.

- **S-G12-08** A fence that could not be recorded still fences (A30, #76,
  #77). When the runner detects a credential rejection it marks
  `fencePending` in the epoch store **before** it attempts the `HALT` append,
  under the same mutex, and the mark is cleared by exactly one thing: a human
  un-halt. While it stands, the gateway refuses every risk-increasing broker
  mutation exactly as a journaled halt does — no stricter, so a risk-reducing
  close stays possible and a fenced book can still be flattened — and every
  cycle reports the fence as a standing impediment (S-G14-05). The effective
  halt state a cycle acts on is therefore the journal-authoritative state OR
  the fence mark, and a journaled `UNHALT` cannot clear the mark, because the
  mark does not live in the journal and `reconcileHaltProjection` governs only
  the projection. The **guaranteed failure boundary**, which is the point of
  the case and must be stated rather than implied:

  | What is writable at the moment of the rejection | What holds |
  |---|---|
  | Journal and epoch store | `HALT` is journaled and the mark is set; the deployment is halted twice over |
  | Epoch store only (journal full, read-only, locked) | The mark is set; every later cycle is fenced until a human un-halt, whatever the journal's older `HALT`/`UNHALT` history says |
  | Neither | No mark and no entry — **and no authority**: `acquireAuthority` writes the epoch store, a failed durable write is `REFUSED`, and a writer without the epoch may not mutate (S-G12-01/02). Nothing can act, so nothing needs to be recorded |
  | The process dies between the mark and the append | The mark stands, because it is written first. Fail-closed by ordering, not by hope |

  Outside the boundary, and declared: a state directory that is destroyed or
  replaced after the mark was written carries no fence, exactly as it carries
  no journal. The manual un-halt refuses when it cannot clear the mark, so a
  release is never half-applied.
- **S-G14-05** Liveness and trading readiness are two signals (A31, #78, #79).
  Every scheduled invocation reports **liveness** — that the scheduler fired,
  the wrapper ran and the process reached its end — independently of what the
  cycle decided; its absence is the S-G14 dead-man condition and means the
  machine, the scheduler or the process is gone. Separately, every cycle
  reports **readiness**: a success signal only when no halt, no fence and no
  alarm condition stands, and a failure signal naming the impediment
  otherwise. A standing halt therefore re-reports itself on every cycle for as
  long as it stands; a later durable append is not permission to claim
  readiness, which is the defect this case exists to prevent — before it, a
  cycle that correctly halted on `AUTH_FAILURE` sent `success` because its
  append had landed. The readiness signal's conditions are the union of the
  cycle's alarm conditions and the effective halt state; `HALT` reasons are
  alarm conditions in their own right. Both signals are undeliverable when the
  endpoint is unset, and an unattended deployment may not begin until the path
  to the operator has been exercised against an explicit failure, a missing
  invocation and a powered-off machine.
- **S-G14-06** The trigger is wide and the calendar decides (A16, A31, #80).
  The scheduled trigger's local-time window must cover the exchange session
  under every offset the deployment will live through, including the weeks when
  the American and European clock changes have not yet met; the decision
  whether a cycle is due comes from the exchange calendar inside the run, never
  from the trigger's shape. A firing outside the session is a normal, cheap,
  journaled no-trade cycle, and the liveness expectation is stated over the
  trigger window in the scheduler's own local time, so it is stable across both
  clock changes.
---

## Traceability

Axiom → cases (spot map; the adversarial pass checks the inverse too):
A1 (S-CYC-08, S-CORE-01), A2 (S-CYC-04/10, G10), A3 (S-CORE-02, S-CYC-02,
G5), A4 (S-CYC-01/03/09, S-J-03, S-X-08), A5 (S-CYC-06, S-J-04, S-G10-04, S-X-03), A6
(S-J-01), A7 (S-CYC-06), A8 (S-J-05), A9 (S-CYC-07, S-J-07), A10 (S-J-07/09),
A11 (G1, S-G9-03, S-G10-03, S-X-05/06), A12 (G8, S-CYC-01/11), A13 (G7,
S-CYC-05, S-G12-01/02/07, S-J-08), A14 (G1–G4, S-G8-06), A15 (§7), A16 (G6),
A17 (G9, G11, S-X-06/07), A18 (S-G14-02/03/05/06, S-CYC-11), A19 (S-G12-03/04/06,
G13), A20 (S-CYC-08/09), A21 (S-J-02), A22 (G11), A23 (G2 counting,
S-G14-04, S-X-06), A24 (S-ARM-01, S-J-06, S-CYC-11), A25 (S-CYC-09,
S-J-03/06/09), A26
(`SUBMISSION-SPEC.md` acceptance gates), A27 (S-CYC-12, S-J-03/09 and
`SUBMISSION-SPEC.md` criterion contract), A28 (S-ARM-01, S-CYC-11, G8), A29 (S-X-07), A30 (S-G12-08), A31 (S-G14-05/06).
