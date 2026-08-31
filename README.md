# Glass Box Trading

Glass Box Trading is a paper-only options agent whose deterministic core records why every candidate passed or failed each entry gate. P1 contains the pure TypeScript entry-decision core for `S-CORE-01..03` and G1–G8. P2 adds the durable journal and the single-writer mutation authority: an append-only JSONL journal with closed entry schemas, secret redaction, account binding, the persisted halt flag, the epoch store, and the one mutation gateway through which every journal append and every future broker mutation passes (`S-J-01..06`, `S-G12-01..05`, `S-G12-07`). The only broker port is `NO_BROKER_PORT`, which refuses every mutation; nothing in the repository can reach Alpaca.

## Prerequisites

- Node `24.9.0`
- npm `11.11.1`
- Python 3 for the phase-partition check

The Node version is pinned in `.nvmrc` and `.node-version`; dependencies are pinned by `package-lock.json`.

## Verify P1 and P2

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run verify
```

`verify` runs the typechecker, ESLint, the 49 allocated SPEC cases of P1 and P2 (76 tests) plus the fixture acceptance test, the `src/core/**` architecture boundary (static provenance allow-list with self-test), a clean build, the local fixture render, the sandbox gate (the compiled core — decision, order identity, journal, and authority — executed inside a `node:vm` realm with no clock, randomness, environment, locale, or code generation; `npm.cmd run sandbox` after a build), and the 90-case phase-partition check. The test run compiles `src/**` once into a scratch directory (`tests/global-setup.ts`) so that the fencing and append tests can race real OS processes through `src/shell/gateway-cli.ts` against one temporary `STATE_DIR`. On shells that do not block PowerShell script shims, `npm` is equivalent to `npm.cmd`.

The rendered local evidence is `artifacts/p1-decision-view.html`. It is generated from one pure `decide(...)` result containing a complete pass and a reasoned veto. The pass produces an `ENTRY_ACTION_PLAN`; no code in P1 or P2 can submit it.

## Journal and authority (P2)

All durable state lives in one absolute `STATE_DIR`: `journal.jsonl` (append-only, one validated entry per line, `seq` assigned by the gateway under the writer mutex, fsynced), `epoch.json` (the control epoch, written atomically, with two persisted obligations: `seedPending` until the first `BOOTSTRAP` lands and `resetPending` until a reset's `GAP`/`HALT` pair is durable — under either, the epoch authorizes nothing), `holder.json` (writer heartbeat, a scheduling signal only), `halt.json` (the persisted halt flag, a projection of the last `HALT`/`UNHALT` entry), and `quarantine/` (the bytes of a torn last line, preserved before the journal is cut back to its last complete line). Authority is the epoch, held by the gateway instance that acquired it in this process: a request carrying a stale, absent, unreadable, pending, or merely observed epoch — or one whose entry claims a different epoch — is rejected at the gateway even while the requester holds the mutex or the persisted holder record. Witness entries (`SUPPRESSED`, `FENCED_OUT`) carry no authority, may not touch the broker, and do not advance the staleness clock. The halt flag is cleared by `src/shell/manual-unhalt.ts` alone; the gateway refuses `UNHALT` from any other path.

## Focused commands

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run architecture
npm.cmd run fixture
npm.cmd run build
python tools/check_implementation_phases.py
```

Production behavior is defined only by [`docs/SPEC.md`](docs/SPEC.md). Test-only values for thresholds still owned by O5 are conspicuously named `TEST_ONLY_*`; they are not production defaults.
