# Glass Box Trading

Glass Box Trading is a paper-only options agent whose deterministic core records why every candidate passed or failed each entry gate. P1–P3 established the pure decision core, append-only journal, fenced single-writer mutation gateway, lifecycle reconciliation, kill handling, and deterministic fake broker. P4–P6 added the broker-independent analyst boundary, session lifecycle, and public evidence pipeline. P7 adds a real Alpaca **paper** adapter and a supervised dev-certificate driver. The real adapter is reachable only through explicit `ALPACA_PROFILE=dev`, canonical paper-origin and bound-account checks, current writer authority, the journal-authoritative halt veto, and the account-bound mutation wrapper. Competition arming and scheduled operation remain P8 work.

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

A successful command is not itself P7 acceptance. Acceptance requires a generated `PASS` certificate and a stably flat bound dev account. `validateArmingCertificate` exists for P8; the competition account is never used by this P7 command.

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
python tools/check_implementation_phases.py
```

Production behavior is defined only by [`docs/SPEC.md`](docs/SPEC.md). Test-only values for thresholds still owned by O5 are conspicuously named `TEST_ONLY_*`; they are not production defaults.
