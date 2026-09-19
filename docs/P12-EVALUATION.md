# P12 — what the three-month paper run will be judged by

Fixed **before** the run starts, on 2026-09-05, so the questions cannot be
chosen after the answers are known. The run's purpose is two things and not a
third: **operational reliability** and **economic plausibility**. It is not a
claim about live profitability, and nothing derived from it may be presented as
one.

## The measurement period

One period, from the first regular approved cycle — **the anchor**, whichever day it
turns out to be — to the `TERMINAL` entry after the US close of the trading day following
`FLATTEN_DATE`.

**Its length is reported as measured, never as intended.** The title of this document says
"three-month" because that was the intention when the run was designed for a 2026-09-09
anchor: 92 calendar days and 64 trading days to a flatten on 2026-12-09. `FLATTEN_DATE` has
since been fixed at **2026-12-15** by the owner's ruling of 2026-09-11, which makes it an
end date rather than a duration: a later anchor shortens the run instead of moving the end.
From an anchor on **2026-09-22** the period is **85 calendar days and 59 trading days** —
about 8% shorter than three calendar months, and 5 trading days fewer.

Two consequences, both of which belong in the report rather than in a footnote:

- Every rate this document defines is computed over the **actual** number of trading days
  and cycles, and the report names that number beside every one of them. A period that is
  five trading days shorter is not a smaller version of the same measurement; it has fewer
  independent observations, and the reliability figures in particular are weaker for it.
- If the run is to be a true three calendar months from its anchor, `FLATTEN_DATE` has to
  move, and that is a decision with a mechanical consequence: it lives in
  `config/policy.json`, which is runtime-digest material, so changing it changes the policy
  digest and **voids any certificate issued before the change**. It is therefore free until
  the certificate run and expensive afterwards.

The original single-sentence definition, kept because it is what the first version of this
document promised: *one period, from the first regular approved cycle (Wed 2026-09-09) to
the `TERMINAL` entry after the Thu 2026-12-10 US close.* Neither of those dates is the
plan any more, and the sentence stands here as the intention it was, not as a schedule.
Strategy parameters and risk limits stay constant for its whole length: the
sleeve budgets, the per-position and per-underlying caps, the structure
whitelist, the expiry bounds, the cycle cadence, the analyst model. If any of
them changes, the period **ends** and a new one begins, labelled as such, and
the two are never summed. A defect fix that does not touch decision parameters
does not end the period, but it is listed in the operations section with its
commit.

## What gets reported

Everything below comes from the journal, through the same projection the
dashboard uses. No figure is typed by hand.

### Result

| Item | Definition |
|---|---|
| Result per sleeve | Realised profit and loss per sleeve (`income`, `convex`), in cents, from closed exposure lifecycles only |
| Open at period end | Unrealised value per sleeve at the flatten cutoff, stated separately and never merged into the realised figure |
| Unattributed | Every cent the reconciliation could not attribute to a lifecycle, as its own line. It is not an error term to be absorbed |
| Drawdown | Maximum peak-to-trough decline of the equity series, and its dates. Cycle-sampled, so it is a lower bound on the true intraday figure, and it says so |
| Risk deployed | Reserved maximum loss at entry, summed per sleeve; peak simultaneous reserved risk with its date; utilisation against the budgets |
| Completed trades | Count of exposure lifecycles reaching a terminal state, with win/loss counts, median and worst outcome. Not a "win rate" without the count beside it |

### Behaviour

| Item | Definition |
|---|---|
| No-trade reasons | Every cycle whose result was `no_trade` or `refused`, grouped by cause: the analyst proposed nothing usable, every candidate was vetoed (by which gate), or a management close was refused (with the reason) |
| Gate activity | How often each of G1–G14 vetoed something. A gate that never fired in three months is a finding, not a blank |
| Analyst | Cycles where it was skipped, timed out, or produced structurally invalid output |

### Operations — the reliability half of the question

| Item | Definition |
|---|---|
| Scheduled invocations | Expected versus actual, from the liveness record; every gap with its length |
| Interruptions | Every halt with its reason, when it was cleared and by whom; every credential fence; every watchdog takeover; every machine or scheduler outage |
| Time not able to trade | Wall-clock minutes of session time under a standing halt or fence, as a share of session time. This is the reliability number that matters most and it has no competitor |
| Alerts | Every readiness and liveness alert raised, and the delay until the operator acted |
| Recovery | For each interruption: what restored operation, and whether it needed a human |

## Cost, kept separate from the paper result

The account fills at the limit and pays almost nothing, so the journal measures
a **gross** path. That figure is reported as what it is, and beside it — never
merged into it — a small number of explicit scenarios:

| Scenario | Per contract | Slippage assumption |
|---|---|---|
| Zero | $0.00 | fills at the journaled limit |
| Retail-typical | commission + regulatory and exchange fees per contract, per leg, both ways | one tick of adverse slippage per leg on entry and on close |
| Adverse | the same fees | half the quoted spread per leg, both ways |

The per-contract figures are entered from a published broker schedule at
evaluation time and cited; they are **not** invented here, and no scenario is
labelled "real" or "net". Each scenario restates result per sleeve, drawdown
and completed-trade outcomes. If the retail-typical scenario turns a positive
gross result negative, that is the headline finding, not a footnote — the cost
side is what ended TradeScan-AI and Vigil, and this run exists partly to find
out whether it ends this one too.

## Comparison

A benchmark makes the result readable; the wrong one makes it look better than
it is. Two, both computed over the identical period from the same market data:

1. **Buy-and-hold SPY**, total return over the period. The honest reference for
   "was this worth doing at all".
2. **Cash**, i.e. zero. The reference the defined-risk framing actually implies:
   the strategy risks a bounded amount to earn premium, and the question is
   whether it earned anything after costs.

Both are stated with the period's own dates. The strategy's own risk exposure
is stated alongside rather than being folded into a ratio: with roughly sixty
trading days and a handful of positions at a time, a Sharpe-style figure would
carry more precision than the sample supports, and it is deliberately not
reported.

## What this run cannot answer

Stated here so it is not quietly forgotten at the end:

- **Real fills.** Paper fills at the limit price. Every conclusion about
  profitability is a conclusion about a gross path plus an assumed cost model.
- **Regime.** One quarter is one market regime. A result here is not evidence
  about a different one.
- **Sample.** A few dozen trades cannot separate skill from luck. The
  distribution of outcomes is the finding; a single aggregate number is not.
- **The analyst.** The model version is fixed for the period, so the run says
  nothing about how a different model would do.
