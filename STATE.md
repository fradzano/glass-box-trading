# STATE — live cursor

> Owns only the cursor (done / now / next) and open threads. Facts live in
> their owning docs: design = [`CONCEPT.md`](CONCEPT.md), decisions =
> [`DECISIONS.md`](DECISIONS.md), scenario standard =
> [`docs/SCENARIOS.md`](docs/SCENARIOS.md). Update on every session close and
> every decision.

**Last updated:** 2026-09-06 03:20 CEST (**P12 PREPARED AND HARDENED — NOT ACTIVATED; NOTHING IS LIVE ON THE HOST**. Branch `p7/dev-live-certificate` at `9c01f55`, pushed; `npm run verify` exit 0 at **48 files / 654 tests**; the mutation probe catches **12 of 12**. The three states stay apart: *prepared* = committed; *proven by test* = a test or an executed probe demonstrates it here; *live on the host* = registered, enabled and observed on the real machine with the alert received on Felix's own device. **Nothing is in the third state, and no scheduled task is enabled.** **Six adversarial passes have now run on this preparation:** R43 (`ab70440`, NO-GO, 12 B + an owner-filed A), R44 (`cf956e2`, NO-GO, A=2 B=15 C=1), R45 (died, two real findings), R46 (`fa2ebad`, NO-GO, A=3 B=9), R47 (`ae85249`, died at 48 min but wrote as it went: A=2 B=8, and it refuted two of its own findings), plus an owner-relayed review of `88a6a54` (six findings, all confirmed) and **two cold reads** of the operator documents by agents with no project context. **One rule accounts for every class-A finding in all six: a stop that cannot be recorded must still stop.** It was found missing at the startup reads (R43-B3), at the ACCOUNT_BINDING_MISMATCH reason (R44-A1), at the account-bound port's halt inside a dispatch (R45-A1), at every halt that is not one of those two reasons — `KILL` above all (R46-A2) — and finally at the case where the journal was not unwritable but **unreadable**, because the mark was set after the journal read (R47-A1). The framing was the generator each time: the rule said *credential* rejection, then it said *reasons the safety entry point accepts*, then it depended on a second file being available. It now has one implementation, `markFenceBeforeHalt`, called before the journal is touched, for every halt, and the mark carries a `fenceReason` so a kill-switch reports as KILL. R47 also caught the defect R46's own fix created: a marker-only KILL was mapped as non-sticky, so a softer halt could land on top and an ordinary release cleared both. **The operator documents went through the same treatment.** The first cold read found the activation drill arithmetically impossible; the owner's review found the Friday emergency path telling him to sell options at an hour when the option market has been shut for one, and a rejected account described as a journaled halt that the test proves cannot exist. The answer was a shared model rather than another round of corrected times: the runbook's **Reading the clock** states the detection formula once, keeps delivery as its own budget, requires every drill to be measured from an **observed ping**, records that the log is UTC while every instruction is local — `tools/show-run-log.ps1` prints both — and **derives** every date from the anchor and the trading calendar. The second cold read then found the rebuilt clock still off by one drill (drill (a) needed 35 minutes and had 30) and three things nothing had said: the cron window ends at 23:45, the two ping sources have different T values, and an anchor may not land in the clock-change week. All closed. **Two measurements were corrected rather than quietly replaced:** the journal read in `standingImpediment` costs 1.5 s and 1.2 GiB on 150 MiB of valid entries, not the 162 ms / 500 MiB first published from a fixture whose entries failed validation and stopped the parser at line one; and the hard-coded scheduler check count was wrong three times running (35, 43, 49) and is gone — the verifier prints it. **Executed on this host, not claimed:** both wrapper refusal signals and the invalid-node-image signal against a real endpoint; the un-halt CLI refusing a release without `--expect-halt-seq`; the installer preview printing IANA `Europe/Berlin` and exact crons from an **unelevated** shell; and every scheduler probe the gates wrote now failing on exactly the line it should. **Dates:** certificate Tue 2026-09-08 from 15:30; drills Tue 22:10 → 00:45; cold-start proof and gate Wed 13:50 → 14:45; first regular cycle the **Wed 2026-09-09 15:15** firing (the anchor); `FLATTEN_DATE` **2026-12-09**; journaling-only 2026-12-10, which is also the installer's coverage date; TERMINAL after that close. **Open:** the owner steps — a fresh paper account created at or after Sun 06.09.2026 02:00, secrets and a new `STATE_DIR` in the local `.env`, three named healthchecks with receipt and one recurring reminder confirmed on his own device, certificate run four. Three proofs can only be produced on the host and are declared as such in the runbook: clean reboot, signed-out S4U execution, powered-off machine.) Previous cursor, 2026-09-06 01:10 CEST (**P12 PREPARED AND HARDENED — NOT ACTIVATED; NOTHING IS LIVE ON THE HOST**. Branch `p7/dev-live-certificate` at `adca01a`, pushed; `npm run verify` exit 0 at **48 files / 651 tests**. Keep the three states apart: *prepared* = committed; *proven by test* = a test or an executed probe demonstrates it here; *live on the host* = registered, enabled and observed on the real machine with the alert received on Felix's own device. Nothing is in the third. **Five adversarial rounds have now run on this preparation** — R43 (`ab70440`, NO-GO, 12 B plus an owner-filed A), R44 (`cf956e2`, NO-GO, A=2 B=15 C=1), R45 (died mid-run with two real findings), R46 (`fa2ebad`, NO-GO, A=3 B=9), and R47 is running on `ae85249`. Plus a **cold read** of the operator documents by an agent with no project context. **Every class-A finding in all five rounds has been one rule missing somewhere: a stop that cannot be recorded must still stop.** Found missing at the startup reads (R43-B3), at the ACCOUNT_BINDING_MISMATCH reason (R44-A1), at the account-bound port's halt inside a dispatch (R45-A1), and finally — R46-A2 — at every halt that is *not* one of those two reasons: `KILL` above all, which reaches the journal through the ordinary authoritative append. The gate drove it: equity below the kill threshold, journal read-only, nothing durable anywhere, and after recovery and a new epoch the next cycle opened a position with no human release. **The framing was the generator.** The rule said *credential* rejection; it is now every halt, marked through one helper, and the mark carries a `fenceReason` so a kill-switch is reported as KILL rather than handing the operator the credential-fence procedure. R46 also showed the journal must outrank its own projection (a real HALT KILL whose projection write failed reported readiness *success*), and that the runner's emergency-close probe swallowed a 403 and then opened a position. **The cold read found the activation drill arithmetically impossible** — 25 minutes of machine-off cannot fell checks with 30- and 50-minute graces, and the drill collided with the signed-out proof over the same 15:00 firing. The signed-out proof moved into Tuesday's window; Wednesday keeps the machine-off drill alone, 45 minutes, with readiness explicitly not waited for and the reason written down. It also found that “the anchor moves” was a sentence and not a procedure, and that its *next trading day* was wrong — it is **two** trading days, with seven steps now written out. And that “tell me”, “report” and “run the fence procedure”, the three sentences carrying the weight in an emergency, all pointed nowhere. **Instruments:** the mutation probe catches **10 of 10** — and its first run earned its keep by exposing a test that passed for the wrong reason. **Executed on this host, not claimed:** both wrapper refusal signals against a real endpoint, the un-halt CLI refusing a release without `--expect-halt-seq`, the installer preview printing IANA `Europe/Berlin` and exact crons from an unelevated shell, and all three of R46's scheduler probes now failing on exactly the lines they should (43 checks). **Dates:** certificate Tue 2026-09-08; drills Tue 22:10 → Wed 15:05; first regular cycle the **Wed 2026-09-09 15:15 CEST** firing (the anchor); `FLATTEN_DATE` **2026-12-09**; journaling-only 2026-12-10 (which is also the coverage date the installer must be given); TERMINAL after that close. **Open:** the R47 verdict; then the owner steps — fresh paper account created at or after Sun 06.09.2026 02:00 Europe/Berlin, secrets and a new `STATE_DIR` in the local `.env`, three named healthchecks with receipt confirmed on his own device, certificate run four. Three proofs can only be produced on the host and are declared as such: clean reboot, signed-out S4U execution, powered-off machine.) Previous cursor, 2026-09-05 22:40 CEST (**P12 PREPARED AND HARDENED — NOT ACTIVATED, AND NOTHING IS LIVE ON THE HOST**. Branch `p7/dev-live-certificate` at `a811bbd`, pushed; `npm run verify` exit 0 at **47 files / 642 tests**. Three keep the states apart and must stay apart: *prepared* = the code exists and is committed; *proven by test* = a test or an executed probe demonstrates it here; *live on the host* = registered, enabled and observed on the real machine with the alert received on Felix's own device. Nothing is in the third state. **Three blind gate rounds** have now run on the P12 preparation: R43 at `ab70440` (NO-GO, 12 B plus an owner-filed A), R44 at `cf956e2` on the R43 fix set (**NO-GO, A=2 B=15 C=1**), and R45 on the R44 fix set is running as of this cursor (job `task-mtolstwm-23ntld`). **R44's two blockers were both in code R43 had just touched.** The fence's last exit was an argument about naming: `dispatchSafetyHalt` marked only on AUTH_FAILURE because a foreign account answering “is not a credential rejection” — with the journal read-only the refused ACCOUNT_BINDING_MISMATCH halt left nothing behind, and the same epoch then submitted a risk-increasing order with no human release. Both accepted reasons mark now. The second blocker was in the runbook: the activation drills enabled the **cycle** task during a session on Tuesday, which lets a competition cycle trade a day before the anchor and starts the measurement period on the wrong date. The drills need the tasks running, not the agent trading, so they moved to 22:10 CEST — after the US close, where every firing skips the cycle and still reports both signals — which also unwound the circular ordering in which the enable step stood after the drills that needed it. **Fence, at two further seams:** the deadline one-shot built its credential recorder after the calendar read (a 401 on the first authenticated read of the invocation fenced nothing), and the watchdog folded a 401 on its own close into `acknowledgement_lost`. **Signals:** an unreadable epoch store and a corrupt journal both reported readiness *success*; a startup refusal sent two POSTs under two names; the cycle wrapper threw before its liveness sender existed, so a missing STATE_DIR was reported nowhere at all. The durability probe measured permissions rather than room and returned ok against ENOSPC — the byte-level probe moved into `epoch-store.ts`, a declared writer, so the S-G12-07 boundary is untouched rather than widened. **Scheduler tools:** the verifier read only `Actions[0]`/`Triggers[0]` and passed a second `cmd.exe` action (now 35 exact checks); the installer printed `*/7` for an interval no cron states exactly, died on elevation before printing the crons the runbook tells the owner to copy, and printed a Windows timezone id healthchecks.io rejects. **Executed on this host, not claimed:** the wrapper refusal producing exactly one `POST /liveness/fail :: wrapper refused: …` against a real endpoint; the un-halt CLI refusing a release without `--expect-halt-seq` and naming the number to use; the installer preview printing IANA `Europe/Berlin` and three exact crons from an **unelevated** shell; the installer refusing a 7-minute watchdog interval. **New:** `docs/P12-INCIDENT-PATHS.md` answers, for four cases (machine off, process erroring or hung, halt or fence standing, watchdog alone), who detects it, which signal appears or goes missing, after how long — 20 / 45 / 65 minutes worst case from the schedules the installer actually printed, delivery stated separately — and what closes automatically. Two limits are written there rather than smoothed over: outside 14:00–23:45 Berlin on weekdays silence never alerts, so a Friday-night incident is found on Monday; and the recurring “down” reminder is an account setting that must be switched on and received once. **Dates, fixed by the rule:** certificate Tue 2026-09-08, drills Tue 22:10 → Wed 15:05, first regular cycle the **Wed 2026-09-09 15:15 CEST** firing (the anchor — 15:15, not 15:30, because the lead-in starts 20 minutes before the US open), `FLATTEN_DATE` **2026-12-09**, journaling-only 2026-12-10, TERMINAL after that close. Any slip moves the flatten date, changes the policy digest and voids the certificate. **Open:** the R45 verdict; then the owner steps — fresh paper account created at or after Sun 06.09.2026 02:00 Europe/Berlin, secrets and a new `STATE_DIR` in the local `.env`, three healthchecks with receipt confirmed on his own device, certificate run four. Three proofs can only be produced on the host and are declared as such in the runbook: clean reboot, signed-out S4U execution, powered-off machine.) Previous cursor, 2026-09-05 20:30 CEST (**P12 PREPARED AND HARDENED — NOT ACTIVATED**. Branch `p7/dev-live-certificate`, `npm run verify` exit 0 at 46 files / 632 tests. Two gate rounds ran on the P12 preparation: **R43** at `ab70440` returned NO-GO with twelve B findings, and the owner plus an independent checker filed a thirteenth as class A. All are closed except three declared limits. **The fence** had four ways out sharing one cause — the mark was written and read but preserved nowhere — so `writeEpochStore` now inherits an omitted `fencePending` and no caller can forget it; the manual release appends the UNHALT before clearing the mark (a refused or undurable release used to free the deployment); `dispatchSafetyHalt` marks on AUTH_FAILURE so startup 401s fence too; and a pre-flight durability probe blocks entries — not management, which broke S-CYC-06 in its first draft — when the state cannot be written. **Readiness** was healable by the deadline one-shots, silent on startup refusals, and incomplete in the watchdog; one shared `standingImpediment` reader now serves all three runtimes. **The qualification window** reopened on the journaling-only day and is moved to 2027-06-01; its test now loads the real policy instead of copying it. **`unhalt-cli.ts` exists** — the runbook had been pointing at a module with no entry point, so running it changed nothing. **The scheduler**: the verifier certified cmd.exe, 01:00 triggers and weekends-only schedules and now reports 30 exact checks; readiness reports on every firing so one cron fits the whole run; the installer prints the exact cron, timezone and grace per check and registers **disabled** unless `-Activate` is passed. **The watchdog has its own heartbeat** — both other checks stayed green while it alone was dead. Executed here, not claimed: a watchdog takeover on scratch state (stale 60 min, epoch fenced, `HALT WATCHDOG_TAKEOVER` journaled, fail ping, readiness then red), all six alert signals against a real endpoint, and Codex's own reproduction probe now green. **Dates fixed by the rule, in order:** certificate Tue 2026-09-08, first regular cycle Wed **2026-09-09** (the anchor), `FLATTEN_DATE` **2026-12-09**, journaling-only 2026-12-10, TERMINAL after that close; any slip moves the flatten date, changes the policy digest and voids the certificate. **Open:** the R44 counter-gate on the fix set; then the owner steps — fresh paper account created at or after Sun 06.09.2026 02:00 Europe/Berlin, secrets and a new `STATE_DIR` in the local `.env`, three healthchecks with receipt confirmed on his own device, certificate run four. Three proofs can only be produced on the host and are declared as such: clean reboot, signed-out S4U execution, powered-off machine.) Previous cursor, 2026-09-05 17:30 CEST (**P12 PREPARED, NOT STARTED** — the owner commissioned a three-month paper run to measure operational reliability and economic plausibility, and everything that did not need him is built, tested and pushed on `p7/dev-live-certificate` (head `ab70440`+). `npm run verify` exit 0 at 46 files / 619 tests. **R42-B2 is closed:** the credential fence now lives in the epoch store, is written before the HALT append, is inherited by every acquisition and is cleared only by the human un-halt; the guaranteed boundary is a table in S-G12-08 and each row is a test, including the one where nothing durable can be written — there `acquireAuthority` is REFUSED, so nothing can act. Building it exposed that acquisition rewrote the epoch store without the mark, so every restart would have cleared the fence. **Alerting is two signals now** (S-G14-05/06): liveness from the wrapper on every firing, readiness from the runtime, and a standing halt outranks a landed append — previously a cycle that correctly halted reported *success*. Measuring the path against a real HTTP endpoint found the alert body arriving **empty**; fixed and pinned. `HEALTHCHECK_PING_URL` had been absent for the entire competition, so nothing ever left the machine. **Scheduler:** measured across the run — the local session start moves an hour on 2026-10-26 and back on 2026-11-02, the window is padded 90 min, and the installer refuses to register without proof; `verify-scheduled-tasks.ps1` immediately caught that the *currently registered* cycle task still invokes node directly. **Scale:** 2,000 entries = 173 MB journal, render 23 ms, but a 5.2 MiB page — detail blocks bounded to 200, table still complete, now 1.2 MiB. **Qualification decoupled by configuration alone**, so the certificate gate and account binding stay. Config is final: `FLATTEN_DATE` 2026-12-08, `COMPETITION_START` 2026-09-06T00:00:00Z, both qualification instants past the end. `docs/P12-EVALUATION.md` fixes the questions before the answers; `docs/P12-RUNBOOK.md` carries the owner steps. **Open:** the R43 readiness gate (Codex, worktree `gbt-r43` at `ab70440`), then the four owner steps — fresh paper account created on or after 2026-09-06, secrets and a new `STATE_DIR` in the local `.env`, two healthchecks with receipt confirmed on his own device, and certificate run four on the dev account Tuesday 2026-09-08 from 15:30 CEST. Tasks are prepared but NOT activated; activation waits on the gate, the certificate, a confirmed alarm and a supervised first cycle.) Previous cursor, 2026-09-05 12:20 CEST (**P11 CLOSED AND MERGED** — the post-competition hardening is on `main` as merge `ca084b7`, tag `p11-post-competition`, pushed; branch head `p7/dev-live-certificate` is the same tree. `npm run verify` exit 0 on `main`: 44 files, 601 tests. Landed: the parked resolver fix; S-X-07 (one shared market-window builder, and the cycle, the watchdog and the deadline entry each quote every contract their own book holds *by identity* — a deliberate deviation from the recorded backlog, which asked for the watchdog's zero-session window; that window costs ~25 chain requests and thousands of journaled quotes per cycle and still misses a drifted strike, reasoning in DECISIONS); S-X-08 (a refused management close is its own `MANAGEMENT_REFUSAL` entry and is named with its reason on the dashboard); `tools/cycle-run.ps1` keeping the printed report; the publish manifest's per-route expected revision, canonical-spelling-only acceptance and collision refusal, measured read-only against the live alias at **48 of 48**; and the S-G12-06 fence extended to the observation's own authenticated read, to a response whose body fails, and to the deadline one-shot. **Two blind gate rounds ran** (R41 at `c27179c`: A=0 B=3 C=2; R42 at `4eb900e`: A=0 B=4 C=1), both archived with their reports and mutation probes in the verification store; the fix rounds' own probes report 17/17 and 8/8 caught on green baselines. **This is explicitly NOT a bis-0 termination:** one B is declared open — R42-B2, a credential fence that does not survive an unwritable journal, pre-existing since before the competition, whose honest fix is a `fencePending` marker in the epoch store; it is prerequisite zero for P12 and is written up in DECISIONS and the plan. Also declared: three one-line composition-root bindings that no test measures. Earlier in the session: the two gated source files restored to the branch head (the running digest is deliberately no longer certificate two), the dev journal un-halted (`UNHALT` seq 70) after a read-only probe showed `PA349COOGKZ1` flat, the release tag `competition-close` set on the competition state, and P11/P12 written into the implementation plan — including the window decision for the long run, which is smaller than feared: G11 wants a single `FLATTEN_DATE` at the deployment's own end, not a rolling one, and what actually needs an owner ruling is the qualification window (three options, costs, recommendation in the plan). The competition journal was never opened for writing and still reads 105 entries. **Next:** certificate run four on the dev account with the dev tasks disabled, earliest Tuesday 2026-09-08 from 15:30 CEST because Monday is Labor Day; then R42-B2 before anything runs unattended.) Previous cursor, 2026-09-05 08:45 CEST (**RELEASE SESSION — the post-competition fix set is landed**: the build lock in the operating checkout has fallen, verified first — both scheduled tasks read back `Disabled`, the competition journal closes at 105 entries with `TERMINAL` seq 105, and the only working-tree change was the two known files at their `f464a66` content. Those two were restored to the branch head with `git checkout --`, so from here the running digest is deliberately no longer certificate two. `npm ci --ignore-scripts && npm run verify` exit 0 at 44 files / 576 tests. Branch head `9fcbccd`, pushed. `main` needed no merge — `bccdf72` already contained `fdb5e4b` and its tree is identical to the branch's — so the release marker is the annotated tag `competition-close` on `bccdf72`, pushed: the submitted and operated state, account `PA376WIK2ATL` flat at $100,582.87, dashboard revision `sha256:78af85c1c238a49d`. The dev journal is out of its `MANUAL` halt: `UNHALT` seq 70, operator `felix`, after a read-only probe through the real adapter showed `PA349COOGKZ1` flat (0 positions, 0 open orders, cash = equity $99,997.59); the competition journal was not touched and still reads 105. Landed on the branch: the resolver fix `f5c6ab4` (cherry-picked from `9b2e155`, R40 GO); the A-class backlog `c5601a8` — one shared market-window builder, every held contract quoted by identity, refused management closes journaled as `MANAGEMENT_REFUSAL` entries, and the cycle task keeping its printed report through `tools/cycle-run.ps1`; the B-class publish fix `e567aab` — an expected journal revision per JSON route and a probe that names its failed checks, measured read-only against the live alias at **48 of 48**, the route that was red on 2026-09-04 now passing against its own revision; and `9fcbccd`, which moves the new SPEC cases off the phase key `P8` (already the kickoff release) onto `P11` and writes up P12, the three-month run. **Open:** the R41 gate on the change set (Codex, job `task-mto08ygf-mbu4a5`, launched from the worktree `gbt-r33` at `e567aab`; the first attempt returned NO-GO for harness reasons only — the sandbox could not write in the worktree — with A=0 B=0 C=0 and nothing verified); after it, the merge to `main`, worktree hygiene, and certificate run four, earliest Tuesday 2026-09-08 15:30 CEST because Monday is Labor Day.) Previous cursor, 2026-09-04 22:40 CEST (**COMPETITION CLOSED**: the `TERMINAL` entry stands — seq 105 at `2026-09-04T20:11:48.122Z`, written by `node dist/shell/deadline-cli.js terminal` from the operating checkout (exit 0, epoch 68 WON, `appended: true`, `remainder: null`, `holdVisible: false`, ping success) after the last scheduled cycle of the event at 22:00 CEST (seq 104); both task triggers end their window at 22:00 local, so the one-shot could not meet a live writer and nothing fires again before Monday 2026-09-07 15:30. The dashboard carries the deadline pin: revision `sha256:78af85c1c238a49d`, four routes, equity $100,582.87 with zero positions, QUALIFIED on six fills, candidate promoted as `dpl_CzQg2ZSVJ4qD59KS2drZx7AmUSwV`; the submission-cited route `/revisions/sha256-7b82959a344a7c7e/presentation/` is byte-identical before and after the publication (SHA-256 prefix `c8745e3f5dc00401` over 157,652 bytes, measured on the live alias, on the candidate and on the alias again). Both probe runs came back 47 of 48: the single red check asserts the current revision for a carried-forward immutable JSON route, which is false by construction — a B-class instrument defect, verified by hand, ruled promotable, fix and reasoning in DECISIONS 2026-09-04. Journal, pings, watchdog log and both receipts are archived in the verification store's `evidence/`. Both scheduled tasks were disabled by the owner from an elevated shell at 22:37 CEST; `Get-ScheduledTask` reads back `Disabled` for each, so the competition deployment is quiet. Previous cursor, 2026-09-04 14:15 CEST: **SUBMITTED**: the owner filed the lablab form at about 14:05 CEST, project page <https://lablab.ai/ai-hackathons/alpaca-ai-trading-agents-hackathon/glass-box-trading/glass-box-trading>; the uploaded video and deck downloaded back byte-identical, the cover is served as a 1920×1080 JPG, the one-pager is linked from the form's Additional Information field because the form has no upload for it; `main` at `fe9953b` carries the submitted state; preflight form rows closed. Remaining today: the close session after the US close (`deadline-cli.js terminal`, `-DeadlineCutoff` publish, tasks disabled by the owner). Earlier cursor, 12:20 CEST: **second cut after the owner's review**: three cold-read lenses (judge, quant, Alpaca) drove a text pass — "two sessions" instead of "one week", REST API instead of CLI, the P&L decomposed (one 4x QQQ call on an overnight gap = 61% of the result, peak reserved worst case $3,421.00, the $33.15 drawdown cycle-sampled), the cycle and G1–G8 stated in order on deck slide six and in the one-pager, hackathon footers on both PDFs; the video got a voice-over: 650-word script in `video/public/narration/script.json`, nine mp3s synthesized through ElevenLabs (voice Matilda, key in the root `.env`), caption strip and credit line in the composition, every scene checked against its slot; the narrated render replaces `submission/glass-box-trading.mp4` (see the preflight video row for the measured facts); DECISIONS 2026-09-04 second entry has the rulings. First cut, 11:00 CEST: **submission material complete, internal cut met**: the presentation dataset is frozen under `video/public/dataset/` as the byte-identical copy of the pinned route's projection (revision `sha256:7b82959a344a7c7e`, cutoff `2026-09-03T20:00:14.787Z`); `submission/render/inject.mjs` derives every figure the texts show, `submission/render/render.mjs` renders the one-pager PDF (one page), the deck PDF (ten slides) and the 1920×1080 cover; the five screen captures were recorded headless against the pinned route and the branch's GitHub blob view, and `npm run render` in `video/` produced `submission/glass-box-trading.mp4` (299.05 s, 55 MB, h264 1080p; captures and the mp4 are gitignored and archived in the verification store's `evidence/submission-2026-09-04/`); `COPY.md` is final with measured counts and the account-ID field; `ACCOUNT-EVIDENCE.md` is the SUB-08 record; `PREFLIGHT.md` carries the host-side run (probe 29/29, receipt `probe-20260904T082629Z.json`), the cross-artifact number check and the local upload facts, with the form-side rows left to the owner; the texts name both competition-week defects and the watchdog takeover (DECISIONS 2026-09-04). Known weak spot: the source-and-tests capture shows `tests/cyc-runner.spec.ts` from the top, not the S-CYC-06 block at line 552 (GitHub's virtualised blob view under zoom). **Resolved 13:25 CEST:** the owner ruled the merge; `p7/dev-live-certificate` was merged `--no-ff` into `main` from the worktree `C:/Users/felix/source/worktrees/gbt-main` (merge commit `1951a44`, pushed), so the plain repository URL shows the submitted state; the operating checkout never left the branch. Then the owner fills the lablab form by hand (well before 17:00 CEST), the close session runs after the US close (`deadline-cli.js terminal`, `-DeadlineCutoff` publish). Previous cursor, 2026-09-03 22:15 CEST: **competition day two closed, book flat**: the FLATTEN_DATE regime closed the three structures expiring 09-08 at 15:30; the three expiring 09-04 could not be priced by the runner (its quote window starts at `EXPIRY_MIN_SESSIONS`, a defect recorded in DECISIONS 2026-09-03), so on the PM's recommendation the owner stood the AgentCycle task down at 18:00 and the certified watchdog took over at 18:55 (`HALT WATCHDOG_TAKEOVER` seq 59, three whole-structure closes seq 60–62, all filled within a second); the task was re-enabled 19:19, the runner journaled the OUTCOMEs (seq 63–65), the final cycle's flatten assertion passed silently, `DEADLINE_RECONCILIATION` seq 77 references the pinned revision; account `PA376WIK2ATL` at cash = equity $100,583.59, zero positions, zero orders, non-sticky `WATCHDOG_TAKEOVER` halt standing; second finding fixed digest-neutrally: the watchdog wrapper had killed the CLI on its first stderr line since arming (`e1576fb`); **dashboard republished** with the presentation pin — revision `sha256:7b82959a344a7c7e`, route `/revisions/sha256-7b82959a344a7c7e/presentation/`, probe 29/29 on candidate and alias, R37 C-3 measured on the host; the running build is still `dist` from `f464a66` with the two source files at `f464a66` content on the working tree (uncommitted); worktree `gbt-publish` is on branch `p7/publish-dashboard` and carries a Remotion video scaffold (`637d430`, `2fa9ba5`) from a parallel session; tomorrow: `deadline-cli.js terminal` after the Friday US close, `-DeadlineCutoff` publish, submission parts, merge). Previous cursor, 2026-09-02 22:05 CEST: competition day one closed — twelve scheduled cycles on freeze two, six filled defined-risk structures, equity $100,092.15, no open orders; **judge dashboard live** at `https://glass-box-trading.vercel.app`, first revision `sha256:c1c8e14ea4035034`, published through the digest-neutral path of `docs/PUBLISH-RUNBOOK.md`. **Competition live on freeze two**: first fill 20:05 CEST — SPY 762/757 put credit vertical, one lot, filled 106 ¢, max loss $395; scheduled tasks on; the running build is `dist` from `f464a66` with the two one-lot-fix sources restored to `f464a66` on the working tree (staged, uncommitted) so runtimeDigest equals certificate two; branch head `c7c7174` and worktree `gbt-fix` `9b2e155` carry the one-lot and resolver fixes for AFTER the competition; dev journal under MANUAL halt, dev account flat; tomorrow: FLATTEN_DATE regime closes the position, Friday deadline CLIs, submission)
**Branch:** `p7/dev-live-certificate` from the P6 merge `bce890a` on local `main`; remote `origin` = `https://github.com/fradzano/glass-box-trading` (public). The operating checkout is at the branch head (rebased docs only): its digest set is byte-identical to freeze two `f464a66`, because the two one-lot-fix sources are kept at their `f464a66` content on the working tree (uncommitted) — never commit or reset those two files while the competition runs, and never rebuild `dist/`.
**Last accepted phase artifact:** P6 — merge commit `bce890a` on local `main` (2026-09-01; owner acceptance of the declared reduced depth, see DECISIONS.md). `npm run verify` exit 0 on the merge plus the lint erratum fix `3c82d89` (250 tests); the erratum is recorded in DECISIONS.md.
**P0 release baseline:** local `main` at `598f43e`
**Current implementation phase:** P7 — supervised dev live certificate
([`docs/IMPLEMENTATION-PLAN.md`](docs/IMPLEMENTATION-PLAN.md#p7--supervised-dev-live-certificate)) — base implementation at `256dc2d`; pre-live adversarial review reached R28 (history of R2–R28 in the P7 bullet under "Next"). **2026-09-02 session (Felix as owner, Claude as PM over a team of at most five agents):** Felix ruled S-CYC-05 option A — the completion of the final fresh broker read is the linearization point; manual broker mutations are prohibited while the agent operates except under a durable HALT with no writer; the limitation is stated in the submission deck (SPEC, AXIOMS A13, SCENARIOS #8, DECISIONS, `tests/cyc-runner.spec.ts` "S-CYC-05 / linearization point"). A cold P8 readiness review then showed that the certificate's `runtimeDigest` covers every file under `src/`, `dist/`, `config/`, `tools/*.mjs|*.py` and the package files, so P8 code had to land BEFORE the market-hours run (DECISIONS 2026-09-02). Landed in this session: the competition provenance port wiring in the composition root plus the account-activities read (a live read-only probe showed a virgin paper account carries the opening `JNLC` funding journal, which the proof had treated as reuse evidence — corrected in SPEC S-CYC-09/CONCEPT and the core), the arming certificate gate (`src/shell/arming-gate.ts`, competition profile only), the real broker/market composition for the watchdog CLI, the renderer split into named template functions (byte-identical output), the Scheduled Task installer and secret scanner under `tools/*.ps1`, `evidence/` gitignored, `.env.example`/README runbook completed. R29 (`prompts/R29-blind-zero-go-no-go.md`) returned NO-GO: A1 the management-close ladder planned against the stale phase-1 book (fixed `962225c`, plus phase-0 reconciliation of close attempts `f2e214d`), B1 the watchdog raised no fail ping under degraded composition (fixed `e1ee586`); the Friday deadline entries got their one-shot CLI (`6bb1bdb`), never end in silence, and stand the watchdog down after TERMINAL (`28ad934`); five unmeasured proof components now have tests (`e1aa41b`); repository cleanup `b46706e`. R30 (`f2e214d`) confirmed the fixes and found two unmeasured invariants (fixed `4259a55`); the competition account `PA376WIK2ATL` was created 09:54Z and a live read showed an empty activity ledger, so the proof now accepts an empty complete ledger at exact capital (`fb2772c`, R31 GO, conjunction test `258d4c1`); R32 GO on the watchdog seams. Felix then ruled (12:40): decouple the dashboard CSS from the digest (`assets/`, `ce63170`), clear the C-class residuals instead of declaring them (`c6804c8`, `96412e2`, `e9c3ca7`, `d45d220`, `4afec4a`; the timers-port deflake of the remaining 5 ms stall tests is the last in-flight piece), merge P7 to `main` only after the PASS (acceptance event), freeze tag on the branch before the run. Competition account `PA376WIK2ATL` created 09:54Z; read-only probes at 12:12 and 12:42 through the real adapter: virgin, verdict ok, no funding journal posted yet. `.tmp/` scratch removed. **Next action (14:41):** run the R33 freeze gate (`prompts/R33-freeze-gate.md`) in an isolated worktree on HEAD; at A=0/B=0 Felix freezes O5 (`config/policy.json` as committed) and countersigns DECISIONS; tag `p7-freeze` on the branch; repeat the competition-account probe; from 15:30 `npm run certificate --owner-go` under supervision on the dev account; after PASS merge `--no-ff` to `main`, release tag, then the owner steps in the README runbook with no `src/` edits. Felix's explicit O5 freeze of `config/policy.json` as is, `git tag pre-kickoff-baseline`, then `npm run certificate --owner-go` under supervision from 15:30 CEST; afterwards only owner steps (competition account, `.env`, GitHub, Vercel, first competition cycle by hand) — no `src/` edits after the certificate.
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
  `docs/COLD-READ-2026-08-24.md`) → initial 48-scenario catalog derived cold,
  since extended to 75 (`docs/SCENARIOS.md`).
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

## Phase record (P5–P7)

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
- **P7 — supervised dev live certificate — implemented and in the final
  pre-live zero gate (2026-09-01, branch `p7/dev-live-certificate` from the P6
  merge `bce890a`; R23 fix counterverified, clean blind gate pending).**
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
  ping port, digests. `config/policy.json` holds the proposed O5 values; Felix's
  freeze remains pending. The R28 `npm run verify` passed 33 files / 345 tests
  plus build, architecture, dashboard, sandbox, and phase gates. The sandbox
  gate executes the certificate core. Evidence-debt rows WIN-7, WIN-10, WIN-17
  are closed.
  Verified against the dev account off-hours (02:51–02:54 CEST): the
  preflight passes every S-CYC-11 check (the first attempt caught a CRLF
  clone and a name-normalization defect, both fixed), two smoke cycles
  produced BOOTSTRAP + CYCLE with a schema-valid analyst candidate vetoed
  by G5/G6 as it must be outside the session. The dev STATE_DIR
  (`glass-box-state/dev` under the user profile) carries that smoke
  journal (2 entries, epoch 3); the live run will open with an S-CYC-08 GAP
  cycle. Adversarial rounds R2–R14 closed account binding, fence persistence,
  journal/projection crash recovery, exact lifecycle evidence, stable broker
  snapshots, aggregate deadlines, kernel writer serialization, lost-ack abort
  recovery, physical state identity, and exact MCP child-environment isolation.
  The R14 cold-read found four B defects; R15 now binds PASS to the exact final
  halt transition, releases the holder even if MCP shutdown fails, uses one
  effective terminal OUTCOME for lifecycle selection, and repairs operative
  documentation. R16 independently anchors the MCP dependency site and closes
  the certificate end instant; R17 binds fill evidence to its exact terminal
  OUTCOME; R18 refuses any unresolved sibling entry and requires unchanged
  journal truth across every flat-snapshot bracket; R19 blocks all same-batch
  siblings after a lost acknowledgement and gives MCP lifecycle operations a
  hard bound while releasing the holder independently; R20 keeps every
  negative lost-ack lookup reserved and repeatedly reconciled, and makes MCP
  evidence scans/hashes/Git reads asynchronous and deadline-aware; R21 keeps a
  lost-ack order entry-blocking even after it appears as working, while a
  normal acknowledgement is durably recorded separately; R22 rejects any
  out-of-order acknowledgement or broker-order identity change; R23 enforces
  monotonicity across duplicate INTENT, VOID, OUTCOME, and evidence shapes;
  R24 binds every long certificate snapshot to a deadline below writer
  takeover and makes the human un-halt an exact authority/journal CAS; R25
  owns MCP attempt cleanup before connect waiting so a late handle cannot
  leak a child; R26 rejects cycle results observed after the absolute
  walltime; R27 keeps the first sticky halt cause stable; R28 applies the
  credential fence to the startup calendar too. The remaining release question
  is the unavoidable interval between the final S-CYC-05 broker read and the
  submit: accept the read as the explicit linearization point with no manual
  account activity during the supervised run, or keep the gate closed pending
  broker-side atomic conditional submission. **Next action:** record Felix's
  ruling, align the spec and tests, complete a fresh clean A/B-zero gate, obtain
  Felix's explicit O5 freeze, then run
  `npm run certificate` during the session under supervision. The command may
  reach only the bound dev paper account. P7 acceptance requires its real PASS
  certificate and a stably flat account. The Scheduled Task installer, real
  git/Vercel ports, and competition-arming wiring are P8; the
  `validateArmingCertificate` core is ready.
- Continue P4–P7 in `docs/IMPLEMENTATION-PLAN.md`; a phase advances only after
  its shared and phase-specific gates pass. A waiver counts only where the
  owning SPEC explicitly permits it; otherwise the phase and arming stay blocked.
- Aug 26–27 target: reach the P7 market-hours dev certificate if every earlier
  phase passes; schedule pressure delays arming rather than collapsing phases.
  **Superseded:** the certificate run is today, 2026-09-02 from 15:30 CEST.
- Fri Aug 28 kickoff 17:00 CEST: inspect the real submission form, create the
  competition account (owner), put its keys in `.env` (`ALPACA_COMP_*`),
  publish GitHub + Vercel, and arm in the partial session only if pre-arm gates
  are green.
  **Superseded:** kickoff happened on 2026-08-28; owner steps now live in the
  README competition runbook.

## Open threads

### Remaining work after competition day two (2026-09-03 22:15 CEST), in due order

- **Done today (details in DECISIONS 2026-09-03 and `docs/PUBLISH-RUNBOOK.md`
  "Second snapshot"):** book flat at 18:55 through the owner-invoked watchdog
  takeover after the runner's flatten path could not price the 09-04
  structures; the wrapper defect that had kept the dead-man inert since
  arming fixed (`e1576fb`); final-cycle flatten assertion passed;
  `DEADLINE_RECONCILIATION` seq 77 referencing `sha256:7b82959a344a7c7e`;
  dashboard republished with the presentation pin, both probes 29/29, the
  nested-route pin check measured on the real host (R37 C-3 closed);
  journal, watchdog log, pings, alias receipt and the quote-gap simulation
  archived in the verification store's `evidence/`. Scheduled tasks are
  both enabled; the watchdog stays quiet outside sessions. The
  `WATCHDOG_TAKEOVER` halt (non-sticky) stands; Friday is journaling-only
  either way, a manual un-halt with the stand-down reason is the owner's
  choice (`dist/shell/manual-unhalt.js`).
- **Friday 2026-09-04 — session plan (PM ruling 2026-09-03 22:50 CEST, owner
  to confirm by starting the sessions):**
  1. *Submission session — DONE 11:00 CEST (see the cursor above and DECISIONS
     2026-09-04; the form itself and the default-branch decision are the
     owner's steps).* Original plan: *Submission session, 09:00–12:00 CEST*, PM with at most five agents
     (ahoy `Desktop/ahoys/2026-09-04-glass-box-trading-submission.md`):
     freeze the video dataset from the pinned presentation route, record
     the five captures, render `submission/glass-box-trading.mp4`
     (`video/README.md`); one-pager PDF; final form copy; account evidence;
     cover and deck check; preflight `submission/PREFLIGHT.md` executed
     against the host. Internal cut 12:00, the owner reviews, then submits
     the lablab form by hand well before 17:00. The spec's nominal Friday
     17:00 `DEADLINE_RECONCILIATION` slot (S-G11-03) is already covered by
     seq 77 (written Thursday after the pin, before the submission,
     referencing the submitted revision); a second entry would only
     duplicate it and is not planned.
  2. *Close session — DONE 2026-09-04 22:20 CEST; see the cursor above and
     DECISIONS 2026-09-04. Only the two scheduled tasks are left, an owner
     step.* Original plan: *Close session, after the US close 22:00 CEST* (ahoy
     `…-2026-09-04-glass-box-trading-close.md`), digest-neutral:
     `node dist/shell/deadline-cli.js terminal` from the operating checkout
     (exit 0 only when the entry landed; the watchdog stands down after
     TERMINAL by design), then the `-DeadlineCutoff` publish per runbook
     (with `--scope`), probe, promote, probe; archive the journal in the
     verification store; DECISIONS/STATE; the owner disables both scheduled
     tasks from an elevated shell (`Disable-ScheduledTask`, the PM lacks the
     elevation). Never `npm run …` variants that rebuild. The 09-04 expiry
     is moot: nothing is held.
  3. *Release session, weekend* (ahoy `…-2026-09-05-glass-box-trading-release.md`):
     see "After the competition" below; the certificate run four needs
     market hours and Monday 2026-09-07 is Labor Day, so the earliest live
     run is Tuesday 2026-09-08.
- **Video (SUB-04) — Remotion scaffold landed 2026-09-02 22:30 CEST** under
  `video/` as its own package (root `package.json` is digest material):
  nine scenes along the SPEC section 5 table, every figure and URL read
  from `video/public/dataset/{meta,projection}.json`, a dataset gate that
  refuses placeholders, an unfrozen dataset and missing captures for the
  deliverable render, a DEV watermark meanwhile. Stills of every scene were
  rendered and reviewed. Open: after Thursday's close produce the frozen
  dataset (README in `video/`), record the five captures against the pinned
  presentation route, `npm run render` to `submission/glass-box-trading.mp4`.
- **Submission (SUBMISSION-SPEC), Friday 12:00 CEST internal, 17:00
  external:** the route to cite is
  `https://glass-box-trading.vercel.app/revisions/sha256-7b82959a344a7c7e/presentation/`;
  still open: one-pager, Remotion video (scaffold on worktree `gbt-publish`,
  branch `p7/publish-dashboard`, `637d430`/`2fa9ba5` from a parallel session,
  merged into this branch 2026-09-03 22:30 CEST), form copy (`submission/COPY.md` draft), account
  evidence (creation instant 2026-09-02T09:54:41Z, $100k bootstrap seq 1,
  journal revision), the golden demo link, preflight `submission/PREFLIGHT.md`
  on the host; the Vercel team is still named `glass-box-trading` (rename is
  the owner's choice; the runbook says what to re-probe).
- **After the competition — DONE 2026-09-05 (release session), except where
  marked open.** The two `f464a66` source files were restored to the branch
  head first, so the running digest is deliberately no longer certificate two.
  Landed: the resolver fix (`f5c6ab4`, cherry-picked from `9b2e155`), the
  A-class backlog of 2026-09-03 (`c5601a8`: one shared window builder, held
  contracts quoted by identity, `MANAGEMENT_REFUSAL` entries, the cycle task's
  printed report kept by `tools/cycle-run.ps1`), the B-class publish fix
  (`e567aab`), and the plan's P11/P12 sections (`9fcbccd`). The dev journal is
  un-halted (`UNHALT` seq 70). `main` needed no merge — it already contained
  the branch head with an identical tree — and carries the annotated release
  tag `competition-close`. **Still open:** the R41 gate verdict on the change
  set; the merge of these four commits into `main`; certificate run four on
  the dev account with the dev tasks disabled (R40 C-2), earliest Tuesday
  2026-09-08 from 15:30 CEST because Monday 2026-09-07 is Labor Day.
- **Open B-class finding, declared not fixed (R42-B2, DECISIONS 2026-09-05):**
  a credential rejection that coincides with an unwritable journal never
  persists its fence, so the next cycle arms and opens a position with no human
  un-halt. Pre-existing — the competition ran on it — and deliberately not
  patched at the tail of a long session: the quick fix does not hold, because
  `reconcileHaltProjection` lets the journal win whenever it carries any halt
  transition. The shape that holds is a `fencePending` marker in the epoch
  store, which is a change to the authority core and needs its own spec case
  and gate round. It is prerequisite zero for P12.
- **Worktree hygiene — done, with one leftover.** `gbt-fix` and
  `gbt-r33-scratch` are removed (their commits are preserved under the tag
  `parked-fixes`), and so is `gbt-main`, whose job ended with the merge.
  `gbt-publish` was **not** removed: `docs/PUBLISH-RUNBOOK.md` names its
  `dist/` as the render source precisely so the operating checkout is never
  touched while the agent runs, and that reason survives into the long run. It
  now carries `main` instead of the merged `p7/publish-dashboard` (branch
  deleted; it had never been pushed) and is rebuilt, so it is both the render
  source and the place `main` is merged. **Leftover:** the review worktree
  `gbt-r33` could not be deleted — a file handle from the gate sandbox still
  holds it. Nothing depends on it and its commit is on the branch; remove it
  with `git worktree remove --force` plus `git worktree prune` once the handle
  is gone. The Vercel team rename remains the owner's choice (the runbook says
  what to re-probe).
- **Backlog recorded today (C class, DECISIONS 2026-09-02):** driver
  reconciliation cycle after un-halt; `Object.hasOwn` on the tooltip table;
  composition-root virgin bootstrap (`SEED_BOOTSTRAP` for an absent store
  with an empty journal and virginity `unknown`) plus a test through
  `buildRuntime`; prompt-builder unit test; timing-sensitive wall-clock
  test; the `analyst-claude.ts` comment still saying "~190".


- The verification store paths cited in this file (`C:/Users/felix/verify-runs/...`
  and its `prompts/`) are a local, unpublished record; a public reader of this
  repository cannot resolve them.
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
