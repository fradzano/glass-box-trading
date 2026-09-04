# Video plan — SUB-04

Remotion source lives under this directory; the rendered deliverable is
`submission/glass-box-trading.mp4` — under five minutes, under 300 MB. Every
URL and number displayed on screen is injected at render time from the
single frozen presentation-cutoff dataset (the pinned presentation route's
`revisions/sha256:7b82959a344a7c7e/presentation/projection.json`, produced by
the dashboard publish pipeline at 2026-09-03T20:00:14.787Z), the same
dataset that feeds `submission/ONE-PAGER.md`, `submission/slides/deck.md`,
and `submission/COPY.md`. No on-screen figure is typed by hand; a scene that
needs a number reads it from that dataset, and the render step fails loudly
if a placeholder resolves to nothing.

Most of the runtime is the working demo, not narration over slides — per
`docs/SUBMISSION-SPEC.md` §5, the golden demo path (§3) occupies the largest
single block of the timeline.

## Timing table (from `docs/SUBMISSION-SPEC.md` §5)

| Time | Content |
|---|---|
| 0:00–0:30 | The problem: autonomous trading is easy to claim and hard to audit. State the glass-box answer and current paper result. |
| 0:30–2:45 | Run the golden demo path: decision, rationale, veto, approved order/fill, reconciliation. |
| 2:45–3:40 | Show the architecture boundary and why the LLM cannot place an order. |
| 3:40–4:25 | Explain P&L, both sleeves, maximum-loss budgets, drawdown, and what one week cannot prove. |
| 4:25–4:55 | Show repository/tests and the public evidence that remains after judging. |
| 4:55–5:00 | End on the demo URL and project name. |

## Scene list (following the golden demo path, §3)

1. **Cold open (0:00–0:30).** Title card: "Glass Box Trading." One-line
   framing of the auditability problem, then the control model — "AI
   proposes; deterministic gates dispose" — with the headline result
   ($583.59, 0.58%) as of 2026-09-03T20:00:14.787Z.
2. **Dashboard open, no auth (0:30–~1:00).** Screen-record the public
   dashboard loading with no login. First viewport: $100k paper-account
   result, current exposure, control-model line.
3. **One decision cycle (~1:00–~1:40).** Select one completed cycle. Show
   Alpaca-derived market context, the analyst candidate, and its
   candidate-specific rationale.
4. **Gate vector and a veto (~1:40–2:15).** Show the complete deterministic
   gate vector for that cycle or a neighboring one, including at least one
   vetoed candidate, so safety is observed on screen rather than asserted in
   narration.
5. **Order to outcome (2:15–2:45).** Follow one approved intent to its
   Alpaca order, fill/outcome, and back to its P&L contribution.
6. **Architecture boundary (2:45–3:40).** Diagram or annotated source view:
   LLM analyst → schema-validated candidates only; pure decision core owns
   every gate; executor is the only path to an order. State plainly why the
   LLM cannot place one.
7. **P&L and limitations (3:40–4:25).** Both sleeves, maximum-loss budgets,
   drawdown behavior, and the explicit statement that one week of paper
   trading cannot prove a strategy has edge.
8. **Source and tests (4:25–4:55).** Open the public repository at the pure
   core and the test that executes one named evidence-debt path.
9. **Close (4:55–5:00).** Demo URL (https://glass-box-trading.vercel.app) and project name on
   screen.

## Constraints

- Recording uses existing immutable journal data where possible so recording
  itself cannot perturb the competition account; a manual demo trigger, if
  used, is a normal fenced and journaled cycle (SPEC A13).
- During recording, the dashboard scenes point at the immutable
  presentation-cutoff snapshot, not the advancing latest route, so the video
  stays reproducible after publication even as later snapshots accrue.
- Output target: `submission/glass-box-trading.mp4`, under five minutes and
  under 300 MB.

## Scaffold (2026-09-02) — how this package works

`video/` is its own npm package on purpose: the repository root
`package.json` is S-ARM-01 digest material, so Remotion and React live here,
installed with `npm install` inside `video/` (the root `eslint .` ignores
`video/**`; this package type-checks with its own `tsconfig.json`).

- `src/timeline.ts` — the §5 timing table as frame slots (total 299 s).
- `src/dataset.ts` — the dataset types, the loader (`calculateMetadata`
  fetches `public/dataset/{meta,projection}.json` once), the validation, and
  the pure selectors that decide which journal facts the scenes show
  (featured lifecycle, its cycle, a vetoed candidate).
- `src/scenes/*.tsx` — one component per scene of the list above; every
  figure and URL on screen is read from the dataset. Scenes 2–5 and 8 have a
  capture slot: with `meta.captures.<scene>` naming a file under
  `public/captures/`, the recording plays; with `null`, a data-driven
  stand-in renders behind a red "capture pending" border.
- `scripts/record-captures.mjs` — the recorder that produced the five
  captures on 2026-09-04 (playwright-core, headless Chrome, scripted scrolls;
  header comment says how to run it outside this package).
- `scripts/check-dataset.mjs` — the gate before the bundler: no `{{`
  placeholder, presentation cutoff kind, cutoff and account equal between
  meta and projection, route URL names the pinned revision, finite result
  figures; with `--frozen` additionally `meta.frozen === true`, a risk-flat
  projection and a recording in every capture slot.

Commands (inside `video/`): `npm run studio` (Remotion Studio),
`npm run dataset:check`, `npm run render:dev` (writes `out/dev-preview.mp4`,
DEV watermark burned in while `meta.frozen` is false), `npm run render`
(the deliverable `submission/glass-box-trading.mp4`; refuses an unfrozen
dataset).

Producing the frozen dataset after the Sep 3 close: publish with
`-PresentationCutoff` (docs/PUBLISH-RUNBOOK.md), copy the pinned route's
`projection.json` from `<out>\site\revisions\sha256%3A<hex>\presentation\`
to `public/dataset/projection.json`, set `presentationCutoffAt`,
`presentationRouteUrl` (safe spelling `sha256-<hex>`) and `frozen: true` in
`meta.json`, record the five captures against the pinned route in a clean
browser (1920×1080, no audio needed), name them in `meta.captures`, then
`npm run render`.
