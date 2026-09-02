# Glass Box Trading

Glass Box Trading is a paper-only options agent whose deterministic core records why every candidate passed or failed each entry gate. P1–P3 established the pure decision core, append-only journal, fenced single-writer mutation gateway, lifecycle reconciliation, kill handling, and deterministic fake broker. P4–P6 added the broker-independent analyst boundary, session lifecycle, and public evidence pipeline. P7 adds a real Alpaca **paper** adapter and a supervised dev-certificate driver. The real adapter is reachable only through explicit `ALPACA_PROFILE=dev`, canonical paper-origin and bound-account checks, current writer authority, the journal-authoritative halt veto, and the account-bound mutation wrapper. The competition arming gate (`src/shell/arming-gate.ts`), its provenance wiring, the watchdog's real-broker composition, and the scheduled-task installer (`tools/install-scheduled-task.ps1`) now exist; the real git and Vercel publication ports still arrive with P8.

P6 adds the public evidence pipeline: a pure performance projection over one committed journal revision at an explicit cutoff (`src/core/projection.ts`, S-J-09), the S-CYC-12 qualification state and its window vetoes (`src/core/qualification.ts`), the anonymous probe contract with promotion, rollback, push-retry, and branch-isolation rules (`src/core/publish.ts`, S-J-07/S-J-08/S-CYC-07), a static dashboard renderer, an atomic render-aside-then-swap site build with immutable revision routes, and a publisher that drives fake git/deploy ports (`src/shell/render-dashboard.ts`, `dashboard-build.ts`, `publisher.ts`). `npm run dashboard` builds `artifacts/dashboard/` from the recorded `fixtures/golden-journal.jsonl` — the deterministic golden path of `docs/SUBMISSION-SPEC.md` §3, navigable with markets closed. No GitHub or Vercel mutation exists in the repository; the real git and Vercel ports arrive with the kickoff release (P8).

## Prerequisites

- Node `24.9.0`
- npm `11.11.1`
- Python 3 for the phase-partition check

The Node version is pinned in `.nvmrc` and `.node-version`; dependencies are pinned by `package-lock.json`.

## Verify the repository

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run verify
```

`verify` runs the typechecker, ESLint, all allocated SPEC cases through P7, the `src/core/**` architecture boundary, a clean build, both fixture/dashboard renders, the sandbox gate, and the 90-case phase-partition check. The test run compiles `src/**` once into a scratch directory (`tests/global-setup.ts`) so fencing and append tests can race real OS processes against one temporary `STATE_DIR`. The sandbox executes the compiled core in a `node:vm` realm without clock, randomness, environment, locale, or code generation. On shells that do not block PowerShell script shims, `npm` is equivalent to `npm.cmd`.

The rendered local evidence is `artifacts/p1-decision-view.html`. It is generated from one pure `decide(...)` result containing a complete pass and a reasoned veto. In tests, the deterministic fake broker exercises execution and recovery. The P7 composition root can instead use Alpaca paper endpoints, subject to the gates below.

## P7 supervised paper certificate

`npm run certificate` builds the current tree and starts `certificate-cli` with `--owner-go`. It is a real paper-broker mutation command, not a demo alias. Do not run it until all of these are true:

- `ALPACA_PROFILE=dev` resolves to the disposable dev paper account, and the broker-reported account ID equals the configured binding.
- Felix has frozen the proposed O5 values in `config/policy.json`.
- The market-hours preflight and the current clean-commit verification gate pass.
- A human is present for the credential-fence un-halt prompt and can monitor reconciliation to a stable flat account.

A successful command is not itself P7 acceptance. Acceptance requires a generated `PASS` certificate and a stably flat bound dev account. `validateArmingCertificate` (`src/core/certificate.ts`), wired through `src/shell/arming-gate.ts`, checks that certificate at competition startup, not during this P7 command; the competition account is never used by this P7 command.

## Execution model

The cycle runner (`src/shell/cycle-runner.ts`) drives CONCEPT §3's phases against ports: phase 0 re-reads every non-terminal order lifecycle from the broker by client order ID before any new order; phase 1 takes one snapshot (a half-answering broker yields a `SKIP` with `WORLD_PARTIAL`, never a confident action); phase 2 calls the analyst at most once and treats an error or timeout as a management-only cycle (`ANALYST_SKIP` in the `CYCLE` entry); phase 3 prices every candidate from the snapshot's quotes at mid ± `LIMIT_TOLERANCE` and hands the priced candidate to the pure core, so G1–G4 reserve from the very limit the executor submits; the primary `CYCLE` entry lands before any order; phase 4 executes each approved plan as `INTENT` → eight-claim revalidation against a fresh broker fetch (account, kill predicate, positions, open orders, control epoch, halt, limit and reserve, G1–G4) → `submit_order` through the P2 gateway → `OUTCOME` from the broker's answer (a rejection carries the broker's reason verbatim; a lost acknowledgement is `confirmation_unclear` and keeps its reservation; a working order yields no `OUTCOME` until its terminal status is seen). A kill (`equity < KILL_EQUITY_THRESHOLD`, strict) sets a sticky `HALT`, cancels risk-increasing working orders, reconciles the cancel/fill races by broker record, adopts risk-reducing orders, flattens intact structures whole through close `INTENT`s, and journals `KILL` only when broker truth is flat. If the journal cannot be appended, no entry is sent; the sole permitted mutation is a mechanically risk-reducing close of existing exposure under the deterministic close-attempt ID, and the next writable cycle journals it as `AUDIT_GAP_EMERGENCY_CLOSE`. The pure decisions behind all of this live in `src/core/execution.ts`; the fake broker (`src/shell/fake-broker.ts`) models fills, partial fills, synchronous and asynchronous rejection, lost acknowledgements, duplicates, and cancel races.

## Journal and authority (P2)

All durable state lives in one absolute `STATE_DIR`: `journal.jsonl` (append-only, one validated entry per line, `seq` assigned by the gateway under the writer mutex, fsynced), `epoch.json` (the control epoch, written atomically, with two persisted obligations: `seedPending` until the first `BOOTSTRAP` lands and `resetPending` until a reset's `GAP`/`HALT` pair is durable — under either, the epoch authorizes nothing), `holder.json` (writer heartbeat, a scheduling signal only), `halt.json` (the persisted halt flag, a projection of the last `HALT`/`UNHALT` entry), and `quarantine/` (the bytes of a torn last line, preserved before the journal is cut back to its last complete line). Authority is the epoch, held by the gateway instance that acquired it in this process: a request carrying a stale, absent, unreadable, pending, or merely observed epoch — or one whose entry claims a different epoch — is rejected at the gateway even while the requester holds the mutex or the persisted holder record. Witness entries (`SUPPRESSED`, `FENCED_OUT`) carry no authority, may not touch the broker, and do not advance the staleness clock. The halt flag is cleared by `src/shell/manual-unhalt.ts` alone; the gateway refuses `UNHALT` from any other path.

## Focused commands

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run architecture
npm.cmd run fixture
npm.cmd run dashboard
npm.cmd run build
npm.cmd run sandbox
npm.cmd run clean
python tools/check_implementation_phases.py
```

`sandbox` re-executes the compiled core inside the `node:vm` realm described above, standalone. `clean` removes `dist/` and `artifacts/`.

Production behavior is defined only by [`docs/SPEC.md`](docs/SPEC.md). Test-only values for thresholds still owned by O5 are conspicuously named `TEST_ONLY_*`; they are not production defaults.

## Competition operation (P8)

The owner runbook from a passed P7 certificate to unattended competition operation ([`docs/IMPLEMENTATION-PLAN.md`](docs/IMPLEMENTATION-PLAN.md) P8/P9). Every step is manual and sequential; none of it is automated by this repository.

1. **Freeze policy.** Rule on the final O5 values in `config/policy.json`; no further edits to that file once the certificate run below starts.
2. **Verify.** `npm.cmd ci --ignore-scripts && npm.cmd run verify` exits 0 on a clean commit.
3. **Tag the baseline.** `git tag pre-kickoff-baseline` on that clean commit.
4. **Run the certificate during market hours.** `npm run certificate` (see "P7 supervised paper certificate" above); require a `PASS` verdict in `evidence/pre-arm/` and a stably flat dev account before moving on. `npm run certificate` itself builds immediately before running (`npm run build && ...`), matching the clean-commit build `npm run verify` already produced in step 2.
5. **Do not rebuild or restyle after the certificate run.** Never run `npm.cmd run clean` or otherwise rebuild between the certificate run and competition operation: `dist/` is inside the certificate's self-digest and is gitignored, so a later rebuild silently invalidates the certificate that steps 7–9 rely on. The same holds for `assets/` (the dashboard and decision-view stylesheets): they are bound by the runtime digest because they are what the judges see, so look at the rendered dashboard before the certificate run, not after.
6. **Create the competition account.** A new Alpaca paper account, created at or after kickoff (P8 acceptance requires provable $100k / zero positions / zero orders / empty history before its first mutation).
7. **Bind identity and a fresh deployment.** In `.env`: `ALPACA_COMP_KEY_ID`, `ALPACA_COMP_SECRET_KEY`, `ALPACA_COMP_ACCOUNT_ID`; a new absolute, **empty** `STATE_DIR` distinct from the dev journal (a reused dev `STATE_DIR` yields `GAP` + halt, never a bootstrap, S-CYC-09); a fresh `BOOTSTRAP_DIAGNOSTIC_SINK`. Keep `ANALYST_MODEL` byte-identical to the value used for the certificate run in step 4 — it is policy-classified and enters the S-ARM-01 policy digest (`src/core/certificate.ts`), so a mismatch refuses to arm.
8. **Set the certificate.** `PRE_ARM_CERTIFICATE` points at the `PASS` file from step 4.
9. **Switch the profile.** `ALPACA_PROFILE=competition`.
10. **Run the first cycle by hand.** `node dist/shell/agent-cli.js` in a terminal, with `ALPACA_PROFILE=competition`, before installing anything scheduled — and read its printed report. This is the virgin-account provenance bootstrap (S-CYC-09): on a fresh, empty `STATE_DIR` nothing can be journaled before the seed `BOOTSTRAP`, so a failed provenance proof (wrong account, non-$100k, non-empty history) leaves no journal entry at all. It is fail-closed and reaches the dead-man ping, but the *reason* is only visible in this terminal report — a declared limit, not a bug.
11. **Install the scheduled tasks.** `tools\install-scheduled-task.ps1` (preview first with `-WhatIf`); see that script's header for the S4U/Interactive login-type tradeoff and for the watchdog's scope — it fences, halts and flattens the open book, and degrades to fence-and-halt-only (with the reason in `watchdog-run.log`) when the configuration, the credentials or the account binding do not compose.
12. **Never touch the account manually while the agent operates.** Manual activity during the run breaks the reconciliation the agent depends on (S-CYC-05 in [`docs/SPEC.md`](docs/SPEC.md)) and can set the irreversible `PROVENANCE_BROKEN` latch.

## Publish the judge-facing dashboard (digest-neutral)

The click-by-click owner record (first Vercel setup, the routine per snapshot, measured host behaviour, the pending team rename) is [`docs/PUBLISH-RUNBOOK.md`](docs/PUBLISH-RUNBOOK.md); this section states the mechanism.

The frozen build has no production caller for the publisher (`src/shell/publisher.ts`) and no git or Vercel port ([`DECISIONS.md`](DECISIONS.md), R35 C4). Publication is therefore an owner runbook over two PowerShell tools and one Node script that only *read* the checkout: `dist/`, `config/policy.json` and `assets/` are read, nothing is built, `.env` is never opened, and the S-ARM-01 `runtimeDigest` of the operating checkout is unchanged (`submission/**`, `tools/*.ps1` and `tests/` are outside `enumerateRuntimeFiles` in `src/shell/digests.ts`). A separate worktree with its own `dist/` may serve as `-RepoRoot` when the operating checkout must not be touched at all.

1. **Copy the journal.** `Copy-Item <STATE_DIR>\journal.jsonl <work>\journal-copy.jsonl`. The renderer refuses a journal that still sits beside a live `STATE_DIR` marker (`epoch.json`, `pings.log`, `halt.json`, `quarantine\`); it never reads the original.
2. **Render.** `tools\publish-dashboard.ps1 -JournalCopy <work>\journal-copy.jsonl -OutDir <work>\out -AccountId <competition account id> [-PresentationCutoff <ISO>] [-DeadlineCutoff <ISO>] [-JournalRevisionUrl <url>]`. This runs `node submission/publish/render-site.mjs`, which calls the built `sitePagesFor` and `buildSiteAtomically` with the projection expectations taken from `config/policy.json` (initial capital, flatten date, qualification window) and the account id you pass. Output:
   - `<out>\site\` — the renderer's page set, byte-for-byte, with the immutable-route carry-forward intact (`revisions/sha256%3A<hex>/<kind>/index.html`);
   - `<out>\deploy\` — the tree to upload: every segment under `revisions/` is percent-decoded and re-spelled in `[A-Za-z0-9._-]` (`sha256:<hex>` becomes `sha256-<hex>`), the history pin's `href` on every page is rewritten to the root-absolute form of that route, and a `vercel.json` pins the static framework with trailing-slash routes. This is the R37 C-3 remedy: the renderer's site-root-relative pin resolves wrongly from a nested route, and a literal `%3A` in a directory name depends on the host not decoding request paths. Apart from that one `href`, every deployed page equals the renderer's page (`tests/publish-dashboard.spec.ts` pins this);
   - `<out>\publish-manifest.json` — the routes with the `glass-box-*` meta an anonymous probe must find on each of them.
3. **Read the page as a judge would.** Open `<out>\deploy\index.html` locally before anything is uploaded.
4. **Create the Vercel project once (owner step).** `vercel login`; in `<out>\deploy`: `vercel link` (new project, framework preset *Other*, no build command, output directory `.`). In the project's settings switch **Deployment Protection off** for production and preview: a judge and the probe must reach the page with no login.
5. **Deploy a candidate.** In `<out>\deploy`: `vercel deploy --prod --skip-domain`. The printed generated URL is an immutable candidate; the stable alias is not moved yet (SUBMISSION-SPEC §4, "staged production deployment").
6. **Probe the candidate anonymously.** `tools\probe-dashboard.ps1 -BaseUrl <candidate URL> -Manifest <out>\publish-manifest.json`. Every HTML route must answer 200 without credentials and carry exactly the expected meta; every JSON route must parse and name the same revision; no served page may carry a relative `revisions/` href, every root-absolute pin must resolve (checked on the nested route too), and the renderer's percent-encoded spelling must not be what is served. A redirect (an auth wall) fails. A receipt `probe-<utc>.json` lands beside the manifest; a failed probe means the candidate is not promoted.
7. **Promote and re-probe.** `vercel promote <candidate URL>`, then the same probe against the stable alias. Keep both receipts with the submission evidence; if the stable probe fails, `vercel rollback` to the previous accepted deployment and alarm.
8. **Later snapshots.** Re-run steps 1–2 and 5–7 with the same `-OutDir`: the immutable routes already built are carried forward untouched, so the presentation-cutoff route a video names stays byte-stable while `index.html` advances. Pass `-PresentationCutoff` once the Sep 3 post-close journal is reconciled and risk-flat, and `-DeadlineCutoff` after the Friday cut (SUBMISSION-SPEC §4.1).

Declared limits: the journal is not pushed to a `journal` branch by this path (`-JournalRevisionUrl` is shown only when you pass one); the page's revision is the content hash of the journal copy (`journalContentRevision`), the same value the publisher's fake git port would have produced; deployment and promotion are hand steps, so the SUB-11 "automatically before every post-submit promotion" wording is met by running step 6 before every promotion, not by code.
