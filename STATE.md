# STATE — live cursor

> Owns only the cursor (done / now / next) and open threads. Facts live in
> their owning docs: design = [`CONCEPT.md`](CONCEPT.md), decisions =
> [`DECISIONS.md`](DECISIONS.md), scenario standard =
> [`docs/SCENARIOS.md`](docs/SCENARIOS.md). Update on every session close and
> every decision.

**Last updated:** 2026-09-01 ~03:15 CEST (P6 merged; P7 built and verified off-hours on `p7/dev-live-certificate`; the market-hours run is the next action — see the P7 paragraph under "Next")
**Branch:** `p7/dev-live-certificate` from the P6 merge `bce890a` on local `main`; no GitHub remote yet
**Last accepted phase artifact:** P6 — merge commit `bce890a` on local `main` (2026-09-01; owner acceptance of the declared reduced depth, see DECISIONS.md). `npm run verify` exit 0 on the merge plus the lint erratum fix `3c82d89` (250 tests); the erratum is recorded in DECISIONS.md.
**P0 release baseline:** local `main` at `598f43e`
**Current implementation phase:** P7 — supervised dev live certificate
([`docs/IMPLEMENTATION-PLAN.md`](docs/IMPLEMENTATION-PLAN.md#p7--supervised-dev-live-certificate)) — implemented at `9777c05`, `npm run verify` exit 0 (272 tests), preflight and two off-hours smoke cycles green against the dev account; **next action:** the market-hours certificate run (`npm run certificate`, from 15:30 CEST, owner go given 2026-09-01 ~02:10 CEST), then the mutation probe and the blind gate, then the P7 closing state

## Done

- Hackathon registered (lablab.ai, user `fradzano`, team **Glass Box Trading**,
  solo, closed). Discord joined.
- Dev paper account `PA349COOGKZ1` live; keys + `CLAUDE_CODE_OAUTH_TOKEN` in
  local `.env` (gitignored).
- Tooling verified against the dev account: REST (options level 3, mleg order
  accept/cancel, indicative feed), MCP server (72 tools, read-only via
  `ALPACA_TOOLSETS`), CLI v0.0.13 (`~/tools/alpaca-cli/`, mleg + client-order-id
  + dry-run). CONCEPT §10.
- CONCEPT baseline → single-round cold read (6A/6B/3C, all folded in,
  `docs/cold-read-2026-08-24.md`) → initial 48-scenario catalog derived cold,
  since extended to 71 (`docs/SCENARIOS.md`).
- **External contract frozen:** `docs/HACKATHON-FACTS.md` records the rendered
  event page, source authority rules, account rules, judging criteria, deliverables,
  and the one-time kickoff form/P&L clarification.
- **Calendar corrected again from the official kickoff:** the event touches six
  US market dates (partial Fridays Aug 28 and Sep 4; full Mon–Thu). Canonical
  arming is the later of kickoff and a successful dev live test. Thursday Sep
  3 close remains the last risk moment; Friday is reconciliation-only.
- **Submission boundary specified:** `docs/SUBMISSION-SPEC.md` owns the four
  criterion evidence paths, public golden demo, dashboard performance payload,
  video, deck, one-pager, cover, form copy, account evidence, preflight, and
  anonymous acceptance of post-submit dashboard revisions.
- **Pre-kickoff implementation boundary decided:** published Alpaca rules permit
  a head start. Pre-event commits remain visible and are tagged as the baseline
  at kickoff; competition account creation and activity remain kickoff-gated.
- **Implementation is partitioned into proof-gated phases P1–P10:**
  `docs/IMPLEMENTATION-PLAN.md` assigns all 90 runtime test cases exactly once
  across P1–P7, then owns the release, operation, and submission stage gates.
- **P0 release branch established:** local `main` points at `598f43e`; P1 work
  starts on `p1/pure-entry-core`. `concept` remains as the historical planning
  ref; no remote exists.

## Now

**Calendar pressure governs the order of work now** (owner ruling
2026-08-31): P2–P6 must be complete before Tuesday 2026-09-01 15:30 CEST (US
open) so that P7's dev live certificate and P8's kickoff release can run in
that same market session; Wednesday 2026-09-02 15:30 CEST is the abort point
for competition arming, Wednesday 22:00 CEST the last qualification entry,
Thursday 22:00 CEST flat, Friday 12:00 CEST internal submission (17:00 external).
One phase per session; every session ends with the handoff protocol in
`docs/IMPLEMENTATION-PLAN.md` and an ahoy note for the next phase.

- **P1 accepted and merged (2026-08-31).** Pure entry-decision core, exact
  integer risk from one expiry-payoff evaluation, 37 allocated SPEC cases (45
  tests), static provenance gate (69-mutant self-test) and runtime sandbox
  gate (19 calibration mutants, export surface restricted to ordinary shapes
  by prototype identity), local glass-box fixture. Verification green at the
  merged tree (`npm run verify`, exit 0). Adversarial run R1–R5 in the store
  `C:\Users\felix\verify-runs\fradzano\glass-box-trading\p1-pure-entry-core`,
  **paused, not terminated** (criteria 1, 5 met; 2, 3, 4, 6 open; `R4-F5`
  carries the owner's countersignature only). Inherited obligations:
  `RES-P1-01a..d` in `docs/EVIDENCE-DEBT.md` (every adapter validates snapshot
  shape and unit brands before `decide`), WIN-11 (P3), SES/`lockdown` backlog.
- **P2 — durable journal and mutation authority — implemented at `d8281e5`
  (2026-08-31).** All 12 allocated cases (S-J-01..06, S-G12-01..05/07) have
  red-first tests (31 tests, 5 files); `npm run verify` exit 0 (76 tests,
  static gate, sandbox gate now executing the journal and authority core,
  partition check). Delivered: pure `src/core/journal.ts` (closed schemas,
  UTC timestamps, line codec with torn-tail detection, redaction, halt
  transition, journal folds) and `src/core/authority.ts` (epoch acquisition,
  compare-and-increment, the single authorization rule, scheduling bounds,
  account binding); shell `state-dir`, `epoch-store` (atomic writes, holder
  heartbeat, `wx` mutex), `journal-store` (fsynced append, quarantine),
  `halt-state`, `mutation-gateway` (the one path for appends and future
  broker mutations; `NO_BROKER_PORT` is the only port), `manual-unhalt`,
  `gateway-cli` (real-process races in tests). Torn append, concurrent
  append (25 in-process, 5×8 across processes), stale writer holding and
  reacquiring the lock, unreadable epoch, takeover race (2 in-process, 6
  processes), witness append, and non-virgin epoch reset all execute in
  temporary `STATE_DIR`s. Evidence-debt rows discharged: BEQ-7, KGV-1/2,
  KGV-3, KGV-1-REG, KGV-11, WIN-16 (✅); in part BEQ-5, BEQ-6, GV-5, KGV-4,
  WIN-9 (◐, the S-CYC-11 halves belong to P4). Verification record: store
  `C:\Users\felix\verify-runs\fradzano\glass-box-trading\p2-journal-authority`
  (`LEDGER.md`): mutation probe 9/9 caught; blind gate on the epoch/fencing
  gateway: first call `task-mth6xs72-d7lqbi` aborted by the provider content
  filter (no verdict) after naming two edges that were real and are closed
  at `0431ac9` (G1-F1 observed-but-not-acquired epoch, G1-F2 seed obligation
  in memory only; see DECISIONS.md); second call `task-mth7dgrq-6dx7ps`
  ran read-only, could execute nothing (`VERDICT: NOT ISSUED`) but found
  G2-F1 (seed obligation cleared by takeover), closed at `6677b24`; third
  call `task-mth87op3-454yk7` (`--write`) executed and returned **REFUTED**
  with three class-A findings G3-F1/F2/F3 (entry epoch unbound; persisted
  holder id treated as acquisition — reached the broker port; reset path
  persisted the store before `GAP`/`HALT`), all closed at `c13ab5e`
  (`npm run verify` exit 0, 76 tests); fourth call `task-mth9f0wj-a6cuce`
  died at the provider content filter before any probe; fifth call
  `task-mth9nyst-0i2n0y` executed: G3-F1/F2 and the witness rule
  **confirmed**, G3-F3 **rejected** as G5-F1 (reset lines under an epoch
  with no store; duplicate pair on retry) → reset path redesigned as a
  persisted pending acquisition at `e44809a` (`npm run verify` exit 0,
  76 tests); sixth call `task-mthadqew-m9cxj9`
  executed: every reset variant **held**, one adjacent path **rejected** as
  G6-F1 (manual un-halt bypassed the pending-reset guard → duplicate pair)
  → closed at `5d875ea`; seventh call `task-mthb03w7-pwxs9p`
  (`prompts/G7-fixverify-manual-unhalt.md`, `--write`) returned
  **CONFIRMED** at `5d875ea`; its reviewer also observed a Windows rename
  sharing flake in the five-process test, closed at `615dbd0` (not
  gate-verified). **P2 closing state:** `npm run verify` exit 0 at `615dbd0`
  (76 tests); the epoch/fencing gateway, the reset path, the witness rule,
  and the manual un-halt path are gate-confirmed by executed evidence;
  schemas, redaction, binding, and the halt fold rest on the repository
  gates and the 9/9 mutation probe only (declared reduced depth,
  DECISIONS.md 2026-08-31). **Next action is Felix's:** merge
  `p2/journal-authority` into local `main` (`--no-ff`), or not. P3 then
  branches from the merge.
- **P3 — broker execution under fakes — implemented at `3961d64`, breach
  halt and probe closure at `c66c3be`, gate closure at `5afb5d1` (2026-08-31, branch
  `p3/broker-execution` from the unmerged P2 head `f1ff38c`).** All 12
  allocated cases (S-CYC-01/02/04/05/06, S-G13-01..03, S-X-01..04) have tests
  (39 tests, 4 new files); `npm run verify` exit 0 (116 tests, static gate,
  sandbox gate now executing the execution core, partition check).
  Delivered: pure `src/core/execution.ts` (limit pricing from the decision's
  quotes, fill classification, broker answers onto the closed OUTCOME set,
  the eight-claim revalidation claimset, kill predicate and kill plan,
  emergency-close eligibility, the journal fold of every entry and close
  lifecycle, the validating `DecisionSnapshot` adapter, clock-free UTC
  conversion); shell `fake-broker` (fills, partials, sync/async rejection,
  lost acknowledgements, duplicates, cancel races, scripted read failures)
  and `cycle-runner` (phases 0–5, primary entry before any order, INTENT →
  revalidation → gateway → OUTCOME, kill management under the fence, the
  emergency close only with the journal down and authority valid, the
  AUDIT_GAP reconciliation on recovery). Additive changes to accepted
  phases are listed in DECISIONS.md (P1 `definedRiskAt`; P2 OUTCOME
  `brokerReason`, INTENT `action: "close"`, HALT reason
  `BROKER_PRICE_BREACH`, gateway `source: "broker_port"`). Evidence-debt rows
  discharged: AUS-2, BEQ-3, BEQ-10, KGV-5, KGV-6, WIN-11, WIN-12,
  RES-P1-01a..d (✅); in part WIN-1 (S-J-09 link is P6) and WIN-18 (emergency
  retry not driven). Verification record: store
  `C:/Users/felix/verify-runs/fradzano/glass-box-trading/p3-broker-execution`
  (`LEDGER.md`): mutation probe 12/14 caught at `3961d64`, 13/14 at
  `c66c3be` with M13 declared (defence-in-depth check unreachable by
  construction); one finding from the evidence-debt reconciliation (missing
  S-X-02 halt) closed at `c66c3be`. **Blind gate on the executor path:** first call (Codex job
  `task-mthde869-81r6p8`, `prompts/G1-executor-path.md`, `--write`) returned
  **REJECTED** on one executed variant, G1-F1 (a `cancel_order` sent while
  the journal was unavailable), closed red-first at `5afb5d1` (cancel loop
  only under a durable `HALT`; 116 tests); four of five claims held. The fix
  verification (Codex job `task-mthe6upm-hpouop`,
  `prompts/G2-fixverify-journal-down-kill.md`) returned **CONFIRMED** at
  `5afb5d1` across seven executed variants (journal writable/unavailable,
  no-structure case, fill during outage, adopted close, recovery order
  `AUDIT_GAP` → durable `HALT` → cancel → `KILL`, unreadable epoch store →
  zero mutations). **P3 closing state:** the executor path is
  gate-confirmed by executed evidence; pricing arithmetic, snapshot
  adapter, fold, and fake broker rest on the repository gates and the
  13/14 probe (declared reduced depth, DECISIONS.md 2026-08-31).
  Declared reduced depth (DECISIONS.md 2026-08-31): red-first is weaker than
  P2's here (core and tests written together), the probe carries the
  tests-bite evidence, no bis-0 criterion is claimed. **Merged to `main` as
  `a737a80` (2026-08-31, after P2 as `9e380fc`; owner acceptance).**
- **P4 — fail-closed startup and analyst boundary — implemented at
  `43ce65f` (2026-08-31, branch `p4/fail-closed-startup` from the P3 merge
  `a737a80`).** Both allocated cases (S-CYC-11, S-G12-06) have tests (44
  new tests, 3 new files plus one extended P2 guard); `npm run verify` exit
  0 (160 tests, static gate, sandbox gate now executing the startup core,
  partition check). Delivered: pure `src/core/startup.ts` (closed-set
  validation of the whole §0 symbol table — unknown fields rejected,
  missing indistinguishable from wrong; byte-exact canonical-origin rule;
  S-G12-02, staleness, and 60-min-SLA couplings; short-capable-whitelist
  capability gate; qualification ordering and strict cap;
  `validateKillThreshold` as an arming check; manifest and runtime-lock
  schemas with identity agreement; pre-spawn MCP launch verifier and exact
  post-start inventory; constructed child environment with secret-pattern
  rejection; 401/403 credential-fence classification); shell `runStartup`
  (CONFIG_INVALID halt over a journalable store, OS-sink fallback
  `CONFIG_INVALID_UNJOURNALABLE` on a virgin install with zero store side
  effects, the narrow `CONFIG_INVALID_STATE_DIR` path before any broker
  access, diagnostic import on repair), `launchVerifiedAnalystChild`
  (remove bytecode → verify → spawn → inventory; nothing released before
  acceptance), file-backed diagnostic sink, `BrokerHttpError` transport,
  and the credential fence in the cycle runner (durable non-sticky
  `AUTH_FAILURE` halt; world failures never fence). Design decisions and
  additive changes in DECISIONS.md (2026-08-31: virgin-install refusal
  yields to the seed rule; shell-supplied expectations; certificate
  presence only, content is P7). Evidence-debt rows discharged: AUS-3,
  BEQ-5, BEQ-6, GV-5, KGV-4, KGV-8, KGV-15, KGV-17, WIN-4, WIN-5, WIN-6,
  WIN-9, WIN-19 (✅); in part KGV-14, WIN-7, WIN-10, WIN-17 (◐ — the
  remainders are P5/P7). Verification record: store
  `C:/Users/felix/verify-runs/fradzano/glass-box-trading/p4-fail-closed-startup`
  (`LEDGER.md`): mutation probe **15/15 caught** at `43ce65f` (each mutant
  compiled before its run). **Blind gate on the startup/launch boundary:**
  first call Codex job `task-mthi2xj7-ae4fpy`
  (`prompts/G1-startup-boundary.md`, `--write`, no filter abort, 16
  executed variants) returned **REJECTED** on one variant, G1-F1 (a 401
  first seen on the phase-4 re-check fetch after a durable INTENT left no
  `AUTH_FAILURE` record, and the recovered next cycle submitted an order),
  closed red-first at `2aa30fc` (the re-check fetch fences through the
  same halt path; 161 tests, `npm run verify` exit 0); every other claim
  held, two observations declared without fix (ledger). Fix verification:
  Codex job `task-mthjmppo-yaet07`
  (`prompts/G2-fixverify-recheck-fence.md`) returned **CONFIRMED** at
  `2aa30fc` across eight executed variants (401 and 403 on the re-check
  seam, the snapshot and phase-0 seams, 500/plain errors never fencing, a
  two-plan cycle leaving the second plan `NOT_SENT: AUTH_FAILURE`, no
  stacked halts). **P4 closing state:** the startup refusal paths, the
  launcher's no-release-before-acceptance rule, and the credential fence
  on all three seams are gate-confirmed by executed evidence; the pure
  validator's individual bound checks and the manifest/lock schemas rest
  on the repository gates and the 15/15 probe (declared reduced depth,
  DECISIONS.md 2026-08-31). **Merged to `main` as `43e7170` (2026-08-31,
  owner acceptance; `npm run verify` exit 0 on the merged `main`).**
- Verification depth for P2–P6 under the calendar: red-first tests for every
  allocated case, the repository gates, one mutation probe per phase, and
  one blind counter-verification of the phase's riskiest mechanism. A full
  bis-0 run per phase does not fit before Tuesday; this reduction is now
  recorded in DECISIONS.md (entry of 2026-08-31, "Verification depth for
  P2–P6 is reduced by declaration").

## Next (after P4)

- **P5 — recovery and lifecycle — implemented at `c4d055c` (2026-08-31,
  branch `p5/recovery-lifecycle` from the P4 merge `43e7170`).** All 21
  allocated test cases (S-CYC-03/08/09/10, G9, G10, G11, S-G14-01..03,
  S-X-05/06; S-G14-04 stays the displayed declared limit) have tests (55
  new tests, 7 new files plus S-CYC-11 additions); `npm run verify` exit 0
  (216 tests, static gate, sandbox gate now executing the lifecycle core,
  partition check). Delivered: pure `src/core/lifecycle.ts` (deadline
  regime and EXPIRY/DEADLINE entry vetoes, G10 book classification with
  the documented discrimination rule, bootstrap-versus-gap planning, the
  competition provenance proof, the S-X-05 escalation ladder with
  width-cap/zero-floor and the S-X-06 uncapped marketable policy, the
  declared-expiry-hold proof, watchdog staleness, the ping plan, the P5
  journal drafts); shell: the cycle runner grew the lifecycle layer
  (classification + durable halts, eviction/flatten/residue ladder closes
  as management actions under halt, GAP/BOOTSTRAP primaries, ping),
  `src/shell/watchdog.ts` + `watchdog-cli.ts` (separate process entry
  over the same epoch store, fence-first recovery), `src/shell/deadline.ts`
  (S-G11-03/04 entries). Design decisions and additive changes in
  DECISIONS.md (2026-08-31, six P5 entries). Evidence-debt rows: AUS-1,
  BEQ-1, BEQ-2, BEQ-9, DOM-3, GV-1, KGV-7, KGV-14, WIN-3, WIN-8 ✅; WIN-2
  ◐ (SUB-08 half is P6+). Verification record: store
  `C:/Users/felix/verify-runs/fradzano/glass-box-trading/p5-recovery-lifecycle`
  (`LEDGER.md`): mutation probe **15/15 caught** (two equivalent mutants
  declared and replaced by real ones at the same sites, both caught; every
  mutant compiled before its run). **Blind gate on the watchdog/ladder
  boundary:** first call Codex job `task-mtho7bkg-yg3zi8`
  (`prompts/G1-watchdog-ladder.md`, `--write`, 20m17s, no filter abort)
  returned **CONFIRMED** at `18eeab1` (implementation `c4d055c`; the
  intervening commit is docs-only, noted by the reviewer) across all five
  executed claims: submitted close limits 200/500/500 with one
  non-stacked `CLOSE_LADDER_CAPPED` halt and attempts continuing AT the
  cap; a lost cancel acknowledgement never spawns a parallel close child
  and a fill-during-cancel reduces exposure via the journaled OUTCOME
  only; the watchdog fences first (old writer `STALE_EPOCH`), closes the
  intact structure whole and both unbounded residues leg-wise with no
  duplicate, and stays quiet against a live writer and on immediate
  re-invocation; the bounded long floors at 1 cent while the short-stock
  buy-back escalates uncapped; zero analyst calls and zero entry
  submissions on every recovery path. No bounded change required; no
  observations declared. **P5 closing state:** the escalation ladder and
  its caps, the watchdog takeover, the residue discrimination, and the
  recovery/entry separation are gate-confirmed by executed evidence; the
  classification details, provenance proof, ping plan, and deadline
  entries rest on the repository gates and the 15/15 probe (declared
  reduced depth, DECISIONS.md 2026-08-31). **Merged to `main` as
  `4e20de8` (2026-09-01, owner acceptance; `npm run verify` exit 0 on the
  merged `main`).**
- **P6 — public evidence pipeline — implemented (2026-09-01, branch
  `p6/public-evidence` from the P5 merge `4e20de8`).** All 5 allocated
  cases (S-CYC-07, S-CYC-12, S-J-07..09) have tests (4 new files, 34 new
  tests); `npm run verify` exit 0 (250 tests, static gate, sandbox gate
  now executing the projection/qualification/publication core, golden
  dashboard render, partition check). Delivered: pure
  `src/core/projection.ts` (S-J-09 fold over one revision at an explicit
  cutoff: cutoff rejection, BOOTSTRAP start equity against
  INITIAL_CAPITAL, realized/unrealized joined to INTENT lifecycles,
  `UNATTRIBUTED` remainder with discrepancies, peak/drawdown, sleeve
  attribution, positions/orders, milestones null until observed, cycle
  views with gate vectors, emergency close linked only to its AUDIT_GAP
  reconciliation, freshness assessment), `src/core/qualification.ts`
  (S-CYC-12 state NOT_DUE/AT_RISK/FAILED/QUALIFIED, the window's one-lot /
  cap / one-live vetoes, the analyst brief, reason codes),
  `src/core/publish.ts` (probe contract over `glass-box-*` meta tags,
  promotion/rejection receipts, stable-origin rollback plan, exact-ref
  push check, push retry state, degradation statement); shell
  `render-dashboard.ts` (static page with the six-step golden-path anchor
  chain), `dashboard-build.ts` (render aside then swap; immutable
  `revisions/<rev>/<kind>/` routes carried forward, never overwritten),
  `publisher.ts` (fake git/deploy ports, sidecar receipts outside the
  journal, S-J-08 refusal journaled via the gateway),
  `render-golden-dashboard.ts` (`npm run dashboard` →
  `artifacts/dashboard/`), the cycle runner's S-CYC-12 layer (brief to the
  analyst, window vetoes after the gates, reason codes in CYCLE, alarm →
  fail ping), the recorded deterministic `fixtures/golden-journal.jsonl`
  (`GBT_UPDATE_GOLDEN=1` re-records), and the submission skeletons
  (`submission/ONE-PAGER.md`, `slides/deck.md`, `COPY.md`, `PREFLIGHT.md`,
  `COVER.md`, `video/README.md`, placeholders injected from the pinned
  presentation projection). Design decisions and additive changes in
  DECISIONS.md (2026-09-01, seven P6 entries). Evidence-debt rows: AUS-4,
  UNF-2, WIN-1, WIN-13 ✅; WIN-2 ◐ (the Sep 4 final snapshot is P10).
  Deferred, tracked: real git port and Vercel deploy port (P8), the
  analyst prompt carrying the qualification brief (P7), the presentation
  cutoff freeze and artifact renders (P10). Verification record: store
  `C:/Users/felix/verify-runs/fradzano/glass-box-trading/p6-public-evidence`
  (`LEDGER.md`): mutation probe **17/17 caught** (run in a detached
  worktree so the gate's checkout stayed untouched; one CRLF anchor
  mismatch rerun and caught). **Blind gate on the publication acceptance
  and projection reconciliation:** first call Codex job
  `task-mthvvug0-w9rmn2` (`prompts/G1-publication-projection.md`,
  `--write`, ~12 min, no filter abort) returned **CONFIRMED** at `802b335`
  (implementation `10a8e66`; the two later commits are the LF pin and CSS)
  across every executed claim: candidate acceptance and all six rejection
  classes, stable-origin rollback to the prior accepted deployment,
  push-failure retry and the refused ref, atomic build and immutable
  routes, projection reconciliation with the cutoff boundary and the
  emergency-close link, and the S-CYC-12 window under the runner at the
  exact cap. No bounded change required; no observations. **P6 closing
  state:** publication acceptance, push retry/refusal, atomic build,
  projection reconciliation, and the qualification window are
  gate-confirmed by executed evidence; the renderer's prose/anchor chain,
  freshness thresholds, sleeve details, and milestone rules rest on the
  repository gates and the 17/17 probe (declared reduced depth,
  DECISIONS.md 2026-08-31). **Next action is Felix's:** merge
  `p6/public-evidence` into local `main` (`--no-ff`), or not. P7 then
  branches from the merge.
- Deferred out of P5, tracked: real scheduler wiring of the lifecycle
  dependency record (`finalCycleOfSession`, `nextTradingDay`,
  provenance/exercise-protection ports — P7's dev certificate wires
  them), the healthchecks.io ping adapter behind the `PingPort` shape.
- Deferred out of P4, tracked: real analyst/market adapters for the runner
  (the MCP child exists behind ports; the Claude analyst call itself and
  live market data are wired at P7's dev certificate), the Windows
  event-log diagnostic sink (pre-arming), S-ARM-01 certificate content
  validation (P7; WIN-7/WIN-10/WIN-17 remainders).
- **P7 — supervised dev live certificate — implemented (2026-09-01, branch
  `p7/dev-live-certificate` from the P6 merge `bce890a`; code at `9777c05`).**
  Pure core: `src/core/certificate.ts` (versioned field classification with
  the new `deployment` class, `policyDigest`, `runtimeDigest`, evidence
  extraction from the journal plus broker observations, PASS/FAIL
  evaluation, `validateArmingCertificate`), `src/core/alpaca-mapping.ts`
  (exact-cent money, nanosecond truncation, credit = negative net limit,
  order request bodies, pagination), `src/core/sha256.ts`. Shell: the real
  Alpaca adapter (`alpaca-broker.ts`), the exchange calendar
  (`market-calendar.ts`), the dedicated MCP environment ports
  (`mcp-environment.ts`: git-blob comparison of the installed package, lock
  coverage, interpreter digests, bytecode removal/scan, stdio child), the
  Agent SDK analyst over an in-process proxy of the verified child
  (`analyst-claude.ts`), the composition root (`agent-runtime.ts`), the
  certificate driver (`certificate-run.ts`), the CLIs (`certificate-cli.ts`
  with `--preflight` / `--smoke-cycle` / `--owner-go`, `agent-cli.ts` = one
  scheduled cycle), config assembly and `.env` loading, the healthchecks
  ping port, digests. `config/policy.json` holds the proposed O5 values
  (owner freeze pending — DECISIONS.md P7 scope notes). `npm run verify`
  exit 0 (272 tests; 22 new: `tests/arm01-certificate.spec.ts`,
  `tests/alpaca-mapping.spec.ts`); the sandbox gate executes the
  certificate core. Evidence-debt rows WIN-7, WIN-10, WIN-17 closed.
  Verified against the dev account off-hours (02:51–02:54 CEST): the
  preflight passes every S-CYC-11 check (the first attempt caught a CRLF
  clone and a name-normalization defect, both fixed), two smoke cycles
  produced BOOTSTRAP + CYCLE with a schema-valid analyst candidate vetoed
  by G5/G6 as it must be outside the session. The dev STATE_DIR
  (`glass-box-state/dev` under the user profile) carries that smoke
  journal (2 entries, epoch 3); the live run will open with an S-CYC-08 GAP
  cycle. **Next action:** `npm run certificate` inside the session (from
  15:30 CEST; owner go given), then the P7 mutation probe and blind gate,
  then the closing state. Not P7: the Scheduled Task installer, the real
  git/Vercel ports, the competition-arming wiring of the certificate into
  `runStartup` (P8 release session; `validateArmingCertificate` is ready).
- Continue P4–P7 in `docs/IMPLEMENTATION-PLAN.md`; a phase advances only after
  its shared and phase-specific gates pass. A waiver counts only where the
  owning SPEC explicitly permits it; otherwise the phase and arming stay blocked.
- Aug 26–27 target: reach the P7 market-hours dev certificate if every earlier
  phase passes; schedule pressure delays arming rather than collapsing phases.
- Fri Aug 28 kickoff 17:00 CEST: inspect the real submission form, create the
  competition account (owner), put its keys in `.env` (`ALPACA_COMP_*`),
  publish GitHub + Vercel, and arm in the partial session only if pre-arm gates
  are green.

## Open threads

- P1 adversarial run is paused at R5 of 8 (store `R5.md`, `LEDGER.md`);
  resumable from R6 (prompts staged in the store) if time allows after P8.
  Preserve the store and its errata (`E-R1-01`, `E-R2-01`, `E-R4-01..04`,
  `E-R5-01..04`); do not rewrite history.
- Harness notes (R4/R5): launch Codex companion calls from the repository
  directory (a store-directory launch registers the job under another
  workspace and `status`/`result` there return nothing); the queue can leave a
  job `queued` indefinitely (cancel via PowerShell, relaunch fresh; zombie
  entries `task-mtgioru5-beltgf`, `task-mth0zx0s-ccqad7` are never waited on);
  Sol calls can end with `model at capacity` or a provider content filter
  (`E-R5-01`) — archive the interim, relaunch, and phrase purity-gate prompts
  in neutral engineering vocabulary; a gate call with targeted commands takes
  10–20 minutes, one that runs `npm run verify` on copies 30–45.

- O5 (CONCEPT §9): remaining gate thresholds — freeze before the actual first
  arm; cycle cadence is already fixed at 15 minutes.
- Kickoff delta check: actual submission form fields and the organiser's P&L
  window/formula answer; append once to `docs/HACKATHON-FACTS.md`.
- Build the analyst MCP in its dedicated environment from the pinned official
  commit and frozen dependency lock; S-CYC-11 must verify it before dev arming.
- O4: social track = NO for now; revisit only on visible results.
- GitHub remote does not exist yet; publishing `main` remains a P8 owner gate.
- Repo maps: regenerate via pre-commit hook (`git config core.hooksPath hooks`,
  activated locally; note for fresh clones).
