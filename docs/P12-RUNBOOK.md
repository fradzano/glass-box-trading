# P12 runbook — the three-month paper run

Prepared 2026-09-05. Everything here that could be done without the owner has
been done and is committed; what remains needs an account, a secret, a
notification channel or a supervised market-hours slot, and is listed under
**Owner steps** with the latest sensible time for each.

**Purpose, from the owner's brief:** operational reliability and economic
plausibility of the concept over a quarter. What it cannot answer is written
down in [`P12-EVALUATION.md`](P12-EVALUATION.md) and stays written down.

---

## What is already true

| Piece | State | Evidence |
|---|---|---|
| Credential fence survives an unwritable journal | done | S-G12-08, `tests/g12-08-durable-fence.spec.ts` (12 cases incl. restart, prior UNHALT, unwritable epoch store) |
| Readiness never reports healthy under a standing halt | done | S-G14-05, same file |
| Liveness is a separate signal | done | `tools/cycle-run.ps1`, measured against a real HTTP endpoint |
| Alert path is exercisable end to end | done | `tools/check-alert-path.ps1` — delivery proven locally; **receipt is an owner step** |
| Trigger survives both clock changes | done | `tools/check-schedule-coverage.mjs`; installer refuses to register without proof |
| Long-run scale is measured | done | `tools/measure-longrun-scale.mjs`: 2,000 entries = 173 MB journal, render 23 ms, page 1.2 MiB after bounding detail blocks |
| Qualification window decoupled | done | config only; `tests/p12-qualification-decoupling.spec.ts` |
| Config for the run | done | `config/policy.json`, four values, validated fail-closed |
| Evaluation fixed before the run | done | [`P12-EVALUATION.md`](P12-EVALUATION.md) |

## The dates

| | |
|---|---|
| First regular cycle | Tuesday **2026-09-08**, from 15:30 CEST, supervised |
| `FLATTEN_DATE` | **2026-12-08** (a Tuesday) — three calendar months |
| Journaling-only day | Wednesday 2026-12-09 |
| `TERMINAL` and shutdown | after the 2026-12-09 US close |

**If the start slips.** `FLATTEN_DATE` is three calendar months from the first
regular cycle, so a later start moves it. Changing it edits `config/policy.json`,
which changes the **policy digest**, which **voids the certificate** — the
arming gate compares the deployment's policy digest with the certificate's. So a
slipped start means: change the date first, then run the certificate again, then
arm. Never the other way round. A slip inside the same week that keeps
2026-12-08 needs no config change and no new certificate.

## Owner steps

Each one needs you. The latest time assumes a Tuesday 2026-09-08 start.

### 1. Create the fresh paper account — by Monday 2026-09-07 evening

A new Alpaca **paper** account used by nothing but this agent. It must be
created **on or after 2026-09-06T00:00:00Z**: the S-CYC-09 provenance proof
requires the creation instant to be at or after `COMPETITION_START`, and an
older account makes the bootstrap refuse. That refusal is the fail-closed
direction — if it happens, tell me rather than editing the date, because
editing it voids the certificate.

Enable options level 3 (multi-leg). Do not trade on it by hand, ever: a manual
mutation while the agent operates is detectable only one cycle later (owner
ruling 2026-09-02, S-CYC-05).

### 2. Put the secrets in the local `.env` — with step 1

Never in chat, never in the repo. `.env` is gitignored; `.env.example`
documents the shape. Set, in the repository root `.env`:

```
ALPACA_PROFILE=competition
ALPACA_COMP_KEY_ID=<the new account's key>
ALPACA_COMP_SECRET_KEY=<the new account's secret>
ALPACA_COMP_ACCOUNT_ID=<the new account number, e.g. PA........>
STATE_DIR=C:\Users\felix\glass-box-state\longrun-1
BOOTSTRAP_DIAGNOSTIC_SINK=C:\Users\felix\glass-box-state\longrun-1-bootstrap.log
```

`STATE_DIR` **must** be a new directory. The competition journal at
`glass-box-state\competition-2` is a closed archive with `TERMINAL` as its last
entry; it is never reopened, and the long run must not inherit it. Create the
directory empty; the bootstrap seeds it.

Leave `PRE_ARM_CERTIFICATE` pointing at whatever certificate run four produces
(step 5 prints the path).

### 3. Create the two notification checks — by Monday 2026-09-07 evening

At healthchecks.io (the free tier is enough), two separate checks:

| Check | Period | Grace | What its silence means |
|---|---|---|---|
| **liveness** | 15 min | 30 min | the machine, the scheduler or the process is gone |
| **readiness** | 15 min | 50 min | the agent has not completed a cycle able to trade |

Both must be scheduled to expect pings only **Mon–Fri inside the trigger
window in this machine's local time** — use a cron schedule with the
`Europe/Berlin` timezone, roughly `*/15 14-23 * * 1-5`, so a quiet Sunday is not
an alert. Holidays and early closes still ping: the wrapper runs and reports
liveness even when it skips.

Point both at the channel you will actually see at night. Then add to `.env`:

```
HEALTHCHECK_PING_URL=<the readiness check's ping URL>
HEALTHCHECK_LIVENESS_URL=<the liveness check's ping URL>
```

Then run, and **confirm on your own device**:

```powershell
.\tools\check-alert-path.ps1          # sends 4 signals, ends both checks failing
# ... confirm two alerts arrived ...
.\tools\check-alert-path.ps1 -ResolveOnly
```

The third case no script can send is silence. Before arming, stop both tasks
during a session (or disconnect the machine) and let the liveness check expire.
An alert path that has never carried an alert is not a safety net — during the
competition it was not connected at all, and seventy pings went into a file on
the machine most likely to have died.

### 4. Certificate run four — Tuesday 2026-09-08, US market hours, supervised

On the **dev** account, with the dev scheduled tasks disabled for its duration
(R40 C-2). It runs against the final config, so nothing in `config/` may change
afterwards.

```powershell
# dev credentials and dev STATE_DIR in the environment for this run only
$env:ALPACA_PROFILE = 'dev'
$env:STATE_DIR = 'C:\Users\felix\glass-box-state\dev'
npm run certificate -- --owner-go
```

It must end `verdict: PASS` with the dev account flat. Note the certificate
path it prints and set `PRE_ARM_CERTIFICATE` to it.

### 5. Install the tasks — after step 4 passes

```powershell
.\tools\install-scheduled-task.ps1 -CoverageThroughDate 2026-12-08
```

It refuses to register unless the trigger window provably contains every
exchange session through that date. Then, from an elevated shell:

```powershell
.\tools\verify-scheduled-tasks.ps1 -ExpectEnabled
```

Every check must pass. It will fail today against the tasks currently
registered, correctly: they still invoke `node` directly, from before
`cycle-run.ps1` existed.

### 6. The supervised first cycle — Tuesday 2026-09-08

Watch one full cycle end to end with the tasks enabled. Confirm, in order:

1. `cycle-run.log` in the new `STATE_DIR` shows the invocation and the full
   printed report.
2. The journal has a `BOOTSTRAP` entry and the provenance proof passed.
3. The liveness check went green.
4. The readiness check went green.
5. `.\tools\verify-scheduled-tasks.ps1 -ExpectEnabled` still passes.

Only then is the run started. This is the moment the deployment becomes
unattended, and it is the last one that is free.

---

## During the run

**Weekly, and after any alert:** publish the dashboard through the
digest-neutral path in [`PUBLISH-RUNBOOK.md`](PUBLISH-RUNBOOK.md), from the
`gbt-publish` worktree, and check the probe comes back clean.

**On a readiness alert:** the body names the impediment. `HALT_STANDING:<reason>`
means the deployment stopped and needs a decision; `CREDENTIAL_FENCE_UNRELEASED`
means a credential rejection stands and the fence procedure has to be run —
check and cancel working orders in the broker dashboard **before** the un-halt,
because the whole point of the fence is that we do not know what is resting
there. The release is `dist/shell/manual-unhalt.js` and it is the only thing
that clears the mark.

**On a liveness alert:** the machine, the scheduler or the process. The journal
and `cycle-run.log` say which. Recovery is normally just letting the schedule
resume — `StartWhenAvailable` is set — but a killed writer holds the epoch until
`LOCK_TAKEOVER_BOUND_MS` (6.7 min) elapses, so expect at most one lost cycle
after a hard stop.

**Never during the run:** change a strategy parameter or a risk limit. If one
must change, the measurement period **ends** and a new one begins
([`P12-EVALUATION.md`](P12-EVALUATION.md)); the two are never summed.

**Disk:** budget about 200 MB for the journal, plus the publish tree. Measured:
69.4 KiB per entry, roughly 2,000 entries.

## Ending it

1. **2026-12-08**, `FLATTEN_DATE`: every cycle closes the book through the
   ladder; by the close the assertion is zero risk-bearing positions and zero
   non-terminal orders (S-G11-01).
2. **2026-12-09**, journaling-only: no entries; if anything is still open the
   failure path keeps closing it (S-G11-02).
3. After the 2026-12-09 US close: `node dist/shell/deadline-cli.js terminal`
   from the operating checkout, exit 0 only when the entry landed (S-G11-04).
4. Publish the final revision and probe it.
5. **Disable both scheduled tasks** from an elevated shell and read the state
   back as `Disabled` — the same step that closed the competition.
6. Archive the journal, the logs and both receipts in the verification store,
   then write the evaluation from [`P12-EVALUATION.md`](P12-EVALUATION.md).

The journal is then a closed archive, exactly like the competition's.
