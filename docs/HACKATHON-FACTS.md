# Hackathon facts — frozen event contract

This file records the external facts that the project is built and submitted
against. It prevents the event page, generic lablab guidance, and project
decisions from being blended into one remembered rule set.

**Verified:** 2026-08-25, from the rendered pages in an enrolled lablab.ai
session. The event page was application version `3.54.0`. The submission form
itself was not yet rendered before kickoff.

## Source authority

The rendered Alpaca event page and its actual submission form are complementary
event-specific authorities, not a blind first/second hierarchy:

- the event page controls the challenge, eligibility, account rules, judging
  criteria, event window, and prizes;
- the actual form controls the fields, accepted file types, size limits, and
  URL validation needed for that submission;
- an explicit dated organiser clarification controls the ambiguity it answers;
- the lablab.ai Hackathon Rule Book, generic Submission Guidelines, and generic
  *How to Win an AI Hackathon* guide follow in that order.

If the event page and actual form materially conflict, submission is blocked
until the organiser clarifies the conflict. An omission in the form does not
silently erase an event-page requirement, and a stricter form constraint is not
ignored merely because the page does not state it.

Guidance can influence our strategy but cannot create an event requirement.
The project decisions in `DECISIONS.md` may deliberately be stricter than the
external contract; they may not silently weaken it.

## Primary sources

- Event page: <https://lablab.ai/ai-hackathons/alpaca-ai-trading-agents-hackathon>
- Event live page: <https://lablab.ai/ai-hackathons/alpaca-ai-trading-agents-hackathon/live>
- Rule Book: <https://lablab.ai/hackathon-rules>
- Submission Guidelines: <https://lablab.ai/delivering-your-hackathon-solution>
- Hackathon process guide: <https://lablab.ai/ai-articles/hackathon-guidelines>
- General AI hackathon guide: <https://lablab.ai/guide/ai-hackathons>
- Winning guide: <https://lablab.ai/guide/how-to-win-an-ai-hackathon>
- Participation and prize terms: <https://lablab.ai/terms-of-use#16-participation-terms>

## Event-specific contract

| Area | Fact | Consequence for Glass Box Trading |
|---|---|---|
| Window | Kickoff is **2026-08-28 17:00 CEST**. Submissions close **2026-09-04 17:00 CEST**. The event is online and seven days long. | The competition window touches the open US market on both Fridays: about five hours after kickoff on Aug 28 and 90 minutes before the deadline on Sep 4. It therefore touches six US trading sessions, not five. |
| Main challenge | Build an autonomous AI trading agent designed to generate P&L and show how it finds opportunities, decides, manages positions, and performs during the competition. | A safe agent without visible trading performance is an incomplete entry. The account, journal, dashboard, and presentation must expose the performance story. |
| Pre-kickoff work | The Alpaca event page encourages participants to study the available technology and get a head start before kickoff. It publishes no event-specific rule that all code must be written during the event. The general lablab.ai guide says pre-existing code, open-source libraries, starter templates, and prior non-AI scaffolding are generally allowed, while noting that many events expect the core AI functionality to be built during their event window and that event-specific rules control. | Pre-kickoff implementation is allowed under the currently published Alpaca contract. Keep its commit dates visible, do not present it as event-window work, and land substantial AI/Alpaca integration and golden-path work during the event. Recheck the actual form and kickoff announcements once. |
| Required Alpaca use | The agent must use Alpaca's Trading API and use either the Alpaca MCP server or Alpaca CLI. | The submitted evidence must show real Alpaca integration and meaningful AI participation. Our design uses the MCP server for the analyst and REST/CLI for execution. |
| Options | Every strategy must incorporate options trading. | Options support is an eligibility requirement, not an optional extension. |
| Development account | Any paper account may be used for development and experiments. | The current dev account remains the only test sandbox. |
| Competition account | Final judging requires a **brand-new**, hackathon-dedicated Alpaca paper account. An existing or reused account is ineligible. Its starting balance must be **$100,000**. | Create and bind a fresh account at kickoff. Do not run experiments or manual trades on it. Never reset or reuse it. |
| Account evidence | The Alpaca paper-account ID is a required submission field. The page says it lets judges identify trading activity and evaluate P&L. | Account ID, broker snapshots, orders, fills, journal entries, and displayed P&L must reconcile. |
| One-page write-up | A one-page explanation of AI logic, risk gates, and Alpaca infrastructure is required. | Produce a dedicated one-pager rather than assuming the long description or deck substitutes for it. |
| Core submission | Required: title, short description, long description, technology/category tags, cover image, video presentation, slide presentation, public GitHub repository, demo platform, application URL, and Alpaca paper-account ID. | Every item needs a named artifact or URL and a preflight check before submission. |
| Judging | Event-specific criteria are **P&L Performance**, **Technology Implementation**, **Creativity & Originality**, and **Presentation & Execution**. | Every criterion needs direct judge-visible evidence. There is no event-specific Business Value criterion on the rendered page. |
| Scoring detail | No weights, numeric formula, minimum trade count, common first-trade timestamp, risk adjustment, or absolute-P&L leaderboard rule is published. | P&L matters, but “largest dollar gain wins” is not a supported claim. Ask for clarification at kickoff; do not redesign around an unstated formula. |
| Social | Up to five X or LinkedIn posts may be submitted. Posts should tag lablab.ai and Alpaca. Quality and engagement may be considered. | Social is optional for the main submission and competes for two separate social awards. The existing owner decision remains `NO for now`. |
| Prizes | The rendered page shows **$6,000 total**: main prizes of $2,500 / $1,500 / $1,000 plus two social awards of $500 per team. | Prize allocation is evidence for prioritisation, not guaranteed financing; terms permit changes and delayed payout. |

## Strict submission envelope

The generic Rule Book and Submission Guidelines add file and form constraints.
Where their language differs, the stricter compatible form is our acceptance
target:

| Artifact | Acceptance envelope |
|---|---|
| Title | At most 50 characters. |
| Short description | At most 255 characters. |
| Long description | At least 100 words. |
| Cover | PNG or JPG, 16:9. |
| Video | MP4, at most five minutes and below 300 MB. |
| Slides | PDF. The winning guide recommends no more than 8–10 slides. |
| Repository | Public GitHub repository, MIT-licensed and accessible without authentication. |
| Demo | Public interactive URL. Vercel is explicitly named as an accepted host. |

The generic Submission Guidelines currently contain an IBM Bob report clause
that is unrelated to the Alpaca event page. Under the authority rules above it is
**not** treated as an Alpaca requirement unless the event-specific submission
form asks for it after kickoff.

## Guidance, not rules

The winning guide recommends a working, clickable core loop within 24 hours,
an opening screen understandable in roughly 30 seconds, a single reliable demo
path, a deployed URL, genuine AI integration, and real commits spread across
the event window. It recommends recording early and spending most of a
five-minute video on the working demo.

Its generic Business Value advice — target user, market size, revenue model,
and why AI is necessary — can strengthen the pitch. It does not replace this
event's four published judging criteria.

## Known ambiguities and one-time recheck

The public material does not state:

- the exact P&L calculation or its judging weight;
- whether all eligible accounts must place their first trade at the same time;
- whether the competition account may be created before kickoff;
- whether a kickoff announcement adds a stricter code-origin boundary than the
  currently published event page;
- the judging end date;
- whether the submission form adds event-specific fields not visible on the
  event page.

At kickoff, perform one deliberate recheck: inspect the event-specific
submission form for added, changed, stricter, or contradictory requirements and
ask the organisers for the P&L window/formula. Record the observed form version
and any answer by appending a dated correction here and a project decision in
`DECISIONS.md`. A material page/form conflict blocks submission until clarified.
Do not repeatedly re-research unchanged generic pages.

## Observed on the live page, 2026-09-04 12:30 CEST (read-only scan before the form)

- The `/live` page lists 207 submissions from 1,236 teams, ranked by community
  votes; 174 of them sit in a track named **"Options Alpha Agents"**. The
  track is a form-time choice to check for (SUB-09 delta row): if the form
  asks for a track, this project belongs there.
- Titles cluster on "Autonomous", "Options", "AI Trading Agent"; one entry
  ("VegaGuard: Auditable AI Options Agent") claims auditability in the
  title. None names a mechanism. Individual pitch texts were not readable
  through a plain fetch, so nothing beyond titles is recorded here.
- The vote ranking is not the jury; O4 (no social solicitation, DECISIONS
  2026-08-24) stands unless the owner reopens it.

## Actual submission form, read 2026-09-04 13:55 CEST (step 1 of 3, logged in)

- Fields and limits: Submission Title 5–50 characters; Short Description 50–255
  characters; Long Description **600–2000 characters** (the page text also
  says "100 words min"); Categories (required, predefined list — `Finance`,
  `Investment` fit; there is no trading category); Event Tracks (optional,
  single option `Options Alpha Agents`); Technologies Used (required,
  predefined list — present: `Alpaca`, `Anthropic Claude`, `Claude Code`,
  `Vercel`; absent: TypeScript, Node, React, Remotion, a generic MCP entry);
  five optional Social Media Post Link fields. Steps 2 and 3 (uploads, URLs,
  account ID) were not opened by the agent.
- Delta against the register: the long-description ceiling of 2000
  characters was not in the earlier facts; COPY.md was cut to fit.
