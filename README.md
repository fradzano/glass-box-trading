# Glass Box Trading

Glass Box Trading is a paper-only options agent whose deterministic core records why every candidate passed or failed each entry gate. P1 contains the pure TypeScript entry-decision core for `S-CORE-01..03` and G1–G8. It does not contain a broker-capable adapter.

## Prerequisites

- Node `24.9.0`
- npm `11.11.1`
- Python 3 for the phase-partition check

The Node version is pinned in `.nvmrc` and `.node-version`; dependencies are pinned by `package-lock.json`.

## Verify P1

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run verify
```

`verify` runs the typechecker, ESLint, 37 allocated SPEC cases plus the fixture acceptance test, the `src/core/**` architecture boundary, a clean build, the local fixture render, and the 90-case phase-partition check. On shells that do not block PowerShell script shims, `npm` is equivalent to `npm.cmd`.

The rendered local evidence is `artifacts/p1-decision-view.html`. It is generated from one pure `decide(...)` result containing a complete pass and a reasoned veto. The pass produces an `ENTRY_ACTION_PLAN`; no code in P1 can submit it.

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
