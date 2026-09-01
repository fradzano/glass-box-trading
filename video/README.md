# Video plan — SUB-04

Remotion source lives under this directory; the rendered deliverable is
`submission/glass-box-trading.mp4` — under five minutes, under 300 MB. Every
URL and number displayed on screen is injected at render time from the
single frozen presentation-cutoff dataset (the pinned presentation route's
`revisions/{{JOURNAL_REVISION}}/presentation/projection.json`, produced by
the dashboard publish pipeline at {{PRESENTATION_CUTOFF_AT}}), the same
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
   ({{PNL_ABS}}, {{PNL_PCT}}) as of {{PRESENTATION_CUTOFF_AT}}.
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
9. **Close (4:55–5:00).** Demo URL ({{DEMO_URL}}) and project name on
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
