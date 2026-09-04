# Account Evidence (SUB-08)

Plain factual record for the competition trading account, written against the
SUB-08 acceptance gate in `docs/SUBMISSION-SPEC.md` §4: "BOOTSTRAP proves
creation at/after kickoff, exact $100k cash/equity, zero positions/orders and
complete empty trading history; ID matches every order-related entry;
irreversible provenance latch remains clean."

Every figure below is labeled with the journal sequence number (`seq`) and
timestamp it was read at. Two cutoffs are in play and are not interchangeable:
the **presentation cutoff** (`2026-09-03T20:00:14.787Z`, seq 76, the frozen
dataset behind the deck/video/dashboard) and the **archived local journal**
this document was written against (seq 1–77, through the Sep 3
`DEADLINE_RECONCILIATION`).

## 1. Account identity

- Account ID: `PA376WIK2ATL`
- Type: Alpaca paper trading account, options level 3
- Role in this project: the **competition** profile, selected via the
  `ALPACA_PROFILE` environment variable in `.env` (never hardcoded — see
  `AGENTS.md` invariants). The competition credentials and account ID are
  bound under the `ALPACA_COMP_ACCOUNT_ID` / `ALPACA_COMP_KEY_ID` /
  `ALPACA_COMP_SECRET_KEY` variables in the same file; the sandbox/dev
  account uses the parallel `ALPACA_DEV_*` variables. Only variable *names*
  are reported here — no key material, secret, or account-ID value copied
  from `.env` beyond the public account ID `PA376WIK2ATL`, which is public
  by design (see §7).
- The account ID appearing in the public dataset (`accountId` field of
  `video/public/dataset/projection.json`) and the account ID served by the
  pinned host both read `PA376WIK2ATL`, matching the `.env`-bound competition
  account.

## 2. Creation and virginity

- Kickoff: 2026-08-28 17:00 CEST.
- Broker-reported account creation instant: `2026-09-02T09:54:41Z` — after
  kickoff, as SUB-08 requires. This instant is **not** carried as a field
  inside the journal; the journal's BOOTSTRAP entry (seq 1, checked below)
  has no `createdAt`/`created_at` key at the top level or inside its
  `snapshot` object (the `created_at` strings that do occur later in the
  journal are per-order broker timestamps under `brokerTimestamps`, unrelated
  to account creation). The creation instant is recorded narratively in
  `DECISIONS.md`, entry dated 2026-09-02 ("The competition account exists;
  an empty activity ledger is virgin evidence"): Felix created the dedicated
  paper account `PA376WIK2ATL` at `2026-09-02T09:54:41Z`; a read-only probe
  through the real adapter minutes later showed cash and equity at exactly
  $100,000 and an activity ledger with **no entry at all**. `docs/SPEC.md`
  (§ around S-CYC-09) records the same fact as the general rule: "a virgin
  paper account carries exactly one such activity (recorded from the dev
  account 2026-09-02) ... 'empty' means 'no activity other than the opening
  funding'" — and for the competition account, even that one funding-journal
  entry had not yet posted at probe time, so its ledger was flatly empty,
  which the same ruling accepts as virgin evidence (a complete, empty ledger
  with cash/equity exactly equal to `INITIAL_CAPITAL` and empty order/fill
  history).
- **BOOTSTRAP entry, journal seq 1** (`competition-2-journal-2026-09-03-close.jsonl`,
  line 1):
  - `at`: `2026-09-02T16:42:14.658Z` (journal-local write time, after
    creation and after kickoff)
  - `type`: `BOOTSTRAP`
  - `epoch`: `2`, `epochSeeded`: `true`
  - `snapshot.accountId`: `PA376WIK2ATL`
  - `snapshot.snapshotAt`: `2026-09-02T16:42:12.822Z`
  - `snapshot.cashCents`: `10000000` ($100,000.00 exactly)
  - `snapshot.equityCents`: `10000000` ($100,000.00 exactly)
  - `snapshot.positions`: `[]`
  - `snapshot.openOrders`: `[]`
  - (the entry also carries `snapshot.quoteSamples`, market-data context
    unrelated to account state)
  - Top-level keys present on this entry, exhaustively: `seq`, `at`, `epoch`,
    `type`, `snapshot`, `epochSeeded`. No `provenance`, `latch`, or ledger
    field is journaled on the entry itself.
- **Where the provenance/latch verdict actually lives:** the S-CYC-09
  provenance bundle (paper role, `EXPECTED_ACCOUNT_ID` match, creation ≥
  `COMPETITION_START`, exact opening cash/equity, empty positions/orders,
  empty order+fill history, and the activity-ledger emptiness check) is
  re-derived live against the broker at bootstrap time and is a **gate on
  whether BOOTSTRAP is ever journaled at all**, not a value stored inside
  the entry: per `DECISIONS.md` (2026-08-31, "P5 design: competition
  provenance failure over a seed-pending store"), a failing proof cannot
  journal anything — "the virgin-seeded store accepts only the BOOTSTRAP
  entry ... and appending one would adopt the unproven baseline," so the
  refusal is carried by an out-of-journal failure ping
  (`COMPETITION_PROVENANCE_FAILED`), not a journal entry. The presence of
  seq 1 as a `BOOTSTRAP` with `epochSeeded: true` is therefore itself the
  positive proof that the provenance check passed; there is no separate
  file in the evidence directory carrying a distinct "latch" verdict field
  (searched `evidence/*` for `provenance`, `latch`, `createdAt`,
  `created_at`, `activityLedger`, `09:54:41` — the only structural hits were
  per-order `brokerTimestamps.created_at` values in the two competition
  journals and the word `provenance` in a code comment in
  `evidence/seed-virgin-epoch.mjs`, neither of which is an account-creation
  or latch record). The full narrative trail for the creation instant and
  the empty-ledger finding is `DECISIONS.md`, not the journal.
- `docs/SPEC.md` (S-J-06, around line 1088) states the enforcement rule this
  latch rides on: "the broker itself reports for the active credentials must
  equal `EXPECTED_ACCOUNT_ID`. Before every mutation the gateway binds the
  closed triplet `{ALPACA_PROFILE, verified canonical paper trading origin,
  EXPECTED_ACCOUNT_ID}` ... A role, origin, or account mismatch → refuse all
  orders, journal, halt." This is the irreversibility mechanism: once a
  non-virgin or mismatched account is detected, the code path refuses to
  proceed rather than silently reconciling — SUB-08's "irreversible
  provenance latch remains clean" reads as "this refusal path was never
  triggered," which the unbroken 1–77 seq run below evidences by absence of
  any `PROVENANCE`-class halt or `GAP` against a foreign book.

## 3. Every order-related entry carries the account ID `PA376WIK2ATL`

Assertion run directly over the archived journal
`evidence/competition-2-journal-2026-09-03-close.jsonl` (77 lines, seq
1–77, cutoff at seq 77's `DEADLINE_RECONCILIATION`), a one-off `node -e`
script reading every line, taking `accountId` from the entry's top level,
`snapshot.accountId`, or `binding.accountId` (whichever is present), and
comparing it against `PA376WIK2ATL`:

Entry-type counts (all 77 entries):

| type | count |
|---|---|
| BOOTSTRAP | 1 |
| CYCLE | 31 |
| HALT | 2 |
| UNHALT | 1 |
| GAP | 3 |
| INTENT | 17 |
| OUTCOME | 13 |
| RECONCILIATION | 8 |
| DEADLINE_RECONCILIATION | 1 |
| **total** | **77** |

Of these, the types that carry an `accountId` (directly, via `snapshot`, or
via `binding`) are `BOOTSTRAP` (1), `CYCLE` (31), `GAP` (3), `INTENT` (17),
`OUTCOME` (13), `DEADLINE_RECONCILIATION` (1) — 66 entries in total. `HALT`,
`UNHALT`, and `RECONCILIATION` entries carry no account field (they are
control/administrative entries, not account-state or order entries).

**Result: 0 mismatches.** All 66 account-ID-bearing entries equal
`PA376WIK2ATL`. No entry references any other account.

### Six qualifying fills

From `video/public/dataset/projection.json` (`qualification.fills`, frozen at
the presentation cutoff, seq ≤ 76). Every fill is cross-referenced by
`intentSeq`/`outcomeSeq` into the same account-ID-clean journal above.

| clientOrderId | intentSeq | outcomeSeq | filledAt | qty | avg fill price | sleeve |
|---|---|---|---|---|---|---|
| `entry:2026-09-02:5:90daa0a3283b8126268c8099` | 8 | 9 | 2026-09-02T18:05:09.587Z | 1 | $1.06 | income |
| `entry:2026-09-02:6:251a2181955c8f1bfee9aa10` | 11 | 15 | 2026-09-02T18:30:12.758Z | 3 | $0.63 | income |
| `entry:2026-09-02:8:c4d5f9648c8a3087d98951d8` | 18 | 22 | 2026-09-02T19:00:13.471Z | 2 | $0.89 | income |
| `entry:2026-09-02:10:b1900aebf5240dca82f42c02` | 27 | 28 | 2026-09-02T19:15:57.872Z | 4 | $3.39 | convex |
| `entry:2026-09-02:11:722db2c5af62a49356591322` | 30 | 31 | 2026-09-02T19:30:55.231Z | 3 | $0.24 | income |
| `entry:2026-09-02:12:ab1f465e5388f05ee4b6b6e2` | 35 | 40 | 2026-09-02T20:00:19.512Z | 3 | $0.47 | income |

(`projection.qualification.fills` records 6 fills; `LIFECYCLE_COUNT` is 11
and `QUALIFYING_FILLS` is 6 per `submission/render/inject.mjs --values`,
i.e. not every opened lifecycle produced a qualifying fill — consistent
with the OUTCOME/INTENT counts above, which include rejections.)

## 4. Snapshots

| label | seq | at | equity | cash | positions | open orders |
|---|---|---|---|---|---|---|
| BOOTSTRAP (start) | 1 | 2026-09-02T16:42:14.658Z | $100,000.00 | $100,000.00 | 0 | 0 |
| Presentation cutoff | 76 | 2026-09-03T20:00:14.787Z | $100,583.59 | $100,583.59 | 0 | 0 |
| DEADLINE_RECONCILIATION | 77 | 2026-09-03T20:04:00.464Z | $100,583.59 | $100,583.59 | 0 | 0 |

The presentation-cutoff snapshot (seq 76) is the one frozen into
`video/public/dataset/projection.json` and served at the pinned route (§6).
Cash equals equity at both the start and the cutoff — the account carries no
open positions or orders at either point, consistent with SUB-08's
"complete empty trading history" only in the trivial start case; between
those points the account traded (six qualifying fills, §3) and returned
flat.

The **seq 77** entry (`DEADLINE_RECONCILIATION`, epoch 39, `at`
2026-09-03T20:04:00.464Z) is not itself a trade or account-state change; it
carries a `reference` field: `"reference": "sha256:7b82959a344a7c7e"` — the
same journal-revision hash as the frozen presentation dataset and the pinned
host route (§6), i.e. this entry records that the dataset published at that
revision was reconciled against the live account snapshot at that instant.
Its snapshot (cash/equity $100,583.59, zero positions/orders) is identical
to seq 76 — no new activity occurred between the two.

**Note:** this is not the terminal snapshot. Per the SUB-08 row in
`docs/SUBMISSION-SPEC.md`, the final snapshot is due 2026-09-04 17:00, after
the Friday US market close — later than the seq 77 read captured here. Any
number reported as "final" or "terminal" needs a later journal read than
this document uses.

## 5. Human actions and the provenance/halt latch

- `projection.humanActions`: `[]` (empty at the presentation cutoff).
- `projection.emergencyCloses`: `[]` (empty at the presentation cutoff).
- The journal's two `HALT` entries and one `UNHALT` entry are **not** human
  trading actions and are not silently omitted here: seq 59 is
  `HALT WATCHDOG_TAKEOVER` (epoch 27, `at` 2026-09-03T16:55:02.330Z,
  `sticky: false`), followed immediately by three watchdog-issued whole-
  structure close `INTENT` entries (seq 60–62, same timestamp, `route:
  "watchdog"`, each carrying `binding.accountId: "PA376WIK2ATL"`). Per
  `DECISIONS.md` (2026-09-03, the watchdog-takeover entry around "owner,
  18:00 CEST, on the PM's recommendation"): the owner deliberately disabled
  the scheduled agent-cycle task at 18:00 CEST after diagnosing that a
  PowerShell wrapper bug (`$ErrorActionPreference = 'Stop'` with `2>&1`) had
  been silently killing the writer on its first stderr line since arming;
  the journal crossed its dead-man staleness bound at 16:51:12Z, and the
  16:55:02Z watchdog firing fenced the stale writer at epoch 27, journaled
  the halt, and submitted the three closes at debit limits of 100¢, 7¢, 7¢
  — all filled within one second at 92¢, 4¢, 6¢. A read through the real
  adapter afterward (18:55 CEST) showed zero positions and cash equal to
  equity at $100,583.59. `DECISIONS.md` states explicitly: "the
  `WATCHDOG_TAKEOVER` halt records an owner-invoked stand-down, not a hung
  writer" — i.e. this was a deliberate, certified safety-net invocation by
  the account owner, not an uncontrolled or unauthorized account action, and
  it is part of the record rather than excluded from it.
- No entry in the 1–77 range represents a manual/human order submission,
  a manual position adjustment, or any account mutation outside the agent's
  and watchdog's own code paths — consistent with `humanActions: []` and
  `emergencyCloses: []` above.

## 6. Where a judge can verify each item without credentials

- **Pinned presentation route** (public, anonymous, no auth required):
  `https://glass-box-trading.vercel.app/revisions/sha256-7b82959a344a7c7e/presentation/`
  — confirmed reachable (`HTTP 200`) at read time (2026-09-04). Response
  headers carry `Etag`, `Last-Modified: Thu, 03 Sep 2026 20:03:01 GMT`, and
  the page's own meta tags:
  `glass-box-journal-revision=sha256:7b82959a344a7c7e`,
  `glass-box-evidence-cutoff=2026-09-03T20:00:14.787Z`,
  `glass-box-evidence-cutoff-kind=presentation`,
  `glass-box-last-seq=76`, `glass-box-freshness=fresh`,
  `glass-box-publish-degraded=false`. The page body states: "Submitted
  Alpaca paper account `PA376WIK2ATL`. Flat: zero broker positions."
- **The same route's `projection.json`** (linked from the page, and at
  `video/public/dataset/projection.json` in the repository) carries every
  figure in §2–§5 above in machine-readable form: `accountId`, `profile`,
  `startEquityCents`/`initialCapitalCents` (and the boolean
  `startEquityMatchesInitialCapital`), `currentEquityCents`/
  `currentCashCents`, `positions`, `openOrders`, `qualification.fills`,
  `humanActions`, `emergencyCloses`, `journalRevision`, `cutoff`, `lastSeq`.
- **The repository**: `docs/SPEC.md` (S-CYC-09 and the surrounding
  provenance rules), `DECISIONS.md` (dated entries 2026-09-02 for account
  creation/virginity, 2026-09-03 for the watchdog takeover), and this file.
- **The raw journal is not public.** `evidence/` is listed in `.gitignore`
  ("`# broker evidence the public repository does not need`") and the file
  this document was written against
  (`competition-2-journal-2026-09-03-close.jsonl`) lives only in the local
  verification store
  (`C:\Users\felix\verify-runs\fradzano\glass-box-trading\p7-dev-live-certificate\evidence\`),
  not in the repository or on the host. The public, judge-verifiable form of
  the journal is the folded `projection.json` served at the pinned route
  above — a judge without repository or filesystem access can verify every
  claim in this document against that URL alone.

## 7. Redaction statement

This document contains no API keys, no broker secrets, and no credential
material. `.env` variable *names* referenced in §1
(`ALPACA_PROFILE`, `ALPACA_COMP_ACCOUNT_ID`, `ALPACA_COMP_KEY_ID`,
`ALPACA_COMP_SECRET_KEY`, `ALPACA_DEV_*`) are structural — none of their
*values* appear anywhere in this file. The account ID `PA376WIK2ATL` is not
a secret: it is the public identifier Alpaca paper accounts expose by
design, it already appears in the publicly hosted dataset and on the pinned
presentation page (§6), and disclosing it does not grant any access.
