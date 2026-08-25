# Scenario Catalog — the external standard for the spec

Provenance: derived 2026-08-24 by a COLD agent (no access to CONCEPT.md, the
gate catalog, or any repo file — world-brief only), per the house build order
Szenario → Axiom → Spec → Code. This file is the measure the spec is checked
against; it must not be edited to fit the spec. Corrections go in dated notes.

Note on #38: the deriving agent flagged a date inconsistency in the brief it
was given — correctly. Resolution: Sep 4 2026 is a FRIDAY and the submission
deadline is 17:00 CEST (90 minutes after US open).

**Correction, 2026-08-25 — official event window:** the rendered event page
later established kickoff at Fri Aug 28 17:00 CEST. The event therefore
touches six US market dates: partial sessions on both Fridays plus four full
Mon–Thu sessions. The earlier “Mon Aug 31 – Fri Sep 4 (five sessions)” premise,
scenario #1's fixed Monday arming, and #41's implication that all Friday build
time occurs while markets are closed are superseded. The competition account
may arm after kickoff only when the pre-arm gates have passed; a failed gate
delays arming rather than weakening it. The original cold walks remain below
as evidence of the earlier brief; scenarios #49–#52 add the missing external
contract rather than rewriting the cold derivation to fit the later spec.

---

## A. FORWARD — normal life

**1. HISTORICAL — superseded first-arming walk (formerly Monday morning; use #49)**
Actors: developer, scheduled task, broker API. Trigger: first market open with the agent armed, Mon 15:30 CEST. The developer is at his day job when the task fires for the first time against a live (paper) market. The account holds $100k cash and zero positions; the LLM sees an empty portfolio and proposes its first candidates; deterministic code executes the first-ever real orders. Nothing about this path has ever run outside of tests — first contact with real fill behavior, real option chains, real journal-append under production timing. The developer cannot watch; he learns what happened only that evening.
What must hold: the very first unattended cycle either works or fails *visibly and safely* — a broken first cycle must not silently burn the whole trading day before anyone notices.

**2. A full normal trading day**
Actors: scheduled task, LLM, broker. Trigger: any mid-week day, everything healthy. The task fires every 15–30 minutes from open to close: ~15–25 cycles. Each cycle fetches account state, quotes, and open positions; the LLM proposes; code accepts or rejects; some cycles trade, most do not. Positions opened in the morning drift in value; the afternoon cycles see them and may close or roll them. At 22:00 CEST the market closes; cycles after the close (if the task still fires) find the market shut. The journal accumulates 15–25 entries and the dashboard rebuilds each time.
What must hold: every cycle leaves a decision record — including "did nothing, because X" — so the day is reconstructible cycle by cycle without gaps.

**3. Quiet no-trade day**
Actors: same. Trigger: a day where the LLM proposes nothing acceptable, or proposes and every proposal is rejected by the deterministic layer. The account shows zero activity for six and a half hours. A judge later looking at the broker account sees a blank day; the dashboard is the only place the day's reasoning lives. The developer comes home and wonders whether the agent was alive at all or silently dead.
What must hold: "alive but chose not to trade" is distinguishable — at a glance, per cycle — from "dead", both on the dashboard and to the developer.

**4. Mid-market decision on an already-open book**
Actors: LLM, deterministic layer. Trigger: any cycle after the first trade. The LLM's proposals must now be judged against existing positions: it may propose something duplicating, offsetting, or over-concentrating the book, or propose closing a leg of an existing spread as if it were a standalone position. The deterministic layer decides with the real, current position state — which it must fetch, not remember.
What must hold: decisions are made against the broker's actual current state, not against what a previous cycle believed the state to be.

**5. The open and the close (edge cycles)**
Actors: scheduler, market clock. Trigger: cycles landing at 15:30 and near 22:00 CEST. The first cycle of the day may fire during the opening auction with garbage-wide option spreads and stale quotes; the last cycle may fire with 5 minutes to the close, when a placed spread has no time to fill and rests overnight as a working or partially-worked order. Overnight, unfilled orders may be cancelled by the broker or remain queued for the next open.
What must hold: cycles near session boundaries cannot leave the account in a state the next morning's first cycle misinterprets (resting orders, cancelled-overnight orders, gap-opened positions).

**6. Submission day trading (Friday)**
Actors: developer, agent, judges' deadline. Trigger: Fri, submission 17:00 CEST — 90 minutes after the US open. The write-up, video, and repo must describe an account that is still changing, or the agent must be wound down before the deadline. The developer records the video the day before against a dashboard whose "final" numbers are not final. After 17:00, the agent either keeps trading (judges see post-deadline activity) or is stopped (who stops it while the developer scrambles with submission?).
What must hold: there is a defensible, journal-visible moment at which "what was submitted" and "what the account shows" are reconciled — activity after that moment must be explainable to a judge, not confusing.

**7. Weekly-expiry positions opened early in the week**
Actors: agent, options calendar. Trigger: Monday/Tuesday cycles open spreads expiring Friday Sep 4. These positions live 3–4 days across nights and the developer's absences, decaying daily. By Thursday they are near-expiry instruments with pin risk and exploding gamma — and Thursday evening/Friday is deliverable and submission time, so the developer's attention is elsewhere exactly when the book is at its most sensitive.
What must hold: positions whose risk profile changes as expiry approaches are handled by the *unattended* cycles, not implicitly deferred to a human who is provably busy that day.

**8. Evening overlap — developer watches it trade live**
Actors: developer at terminal, running agent. Trigger: any weekday ~20:00–22:00 CEST. The developer is home while cycles still fire. He opens logs/dashboard while a cycle is mid-flight, possibly runs a manual command (query, close a position by hand in the Alpaca UI) concurrently with the agent's own cycle. His manual close and the agent's next cycle now both act on the same position.
What must hold: manual intervention and an autonomous cycle acting on the same account concurrently cannot corrupt state or double-act on the same position; the journal must reflect that a human acted, or the judge later sees agent-inexplicable trades.

## B. DEGRADED — things break mid-flight

**9. Windows Update reboots the machine overnight**
Actors: Windows, scheduled task. Trigger: patch-Tuesday-style forced reboot at 03:00 CEST. The machine comes back; pending: does the scheduled task re-register, does it fire at next interval or wait for the next trigger boundary, does any wake-up state (in-memory position cache, run lock, last-cycle marker) survive? If the agent kept state in memory or in a temp file, the first post-reboot cycle starts amnesiac against an account with open positions.
What must hold: a cold machine restart, unattended, resumes correct operation from durable state — open positions and working orders are re-learned from the broker, not assumed.

**10. Machine sleeps / hibernates mid-day**
Actors: Windows power management. Trigger: consumer power settings put the box to sleep during a quiet stretch; scheduled tasks may or may not wake it. Cycles silently stop firing at 17:40 CEST; the dashboard's last entry ages; open positions drift for hours with no supervision. The developer, at work, has no signal unless something actively tells him.
What must hold: "cycles have stopped firing" becomes knowable — to the developer within a bounded time, and to a later reader as an explicit gap, not an unexplained silence.

**11. Home internet drops**
Actors: ISP, router. Trigger: residential outage 14:00–16:30 CEST. The task fires on schedule but every API call fails: broker unreachable, LLM unreachable, git push fails. Depending on ordering, a cycle may have placed an order just before the drop and never received the ack — order state unknown. When connectivity returns, several missed cycles' worth of market movement has happened, and possibly an order filled during the blackout.
What must hold: an order whose acknowledgment was lost is reconciled against broker truth before any new order is placed; connectivity failure produces journal-visible "cycle attempted, could not reach world" entries once possible.

**12. Broker API outage or degraded data**
Actors: Alpaca. Trigger: broker returns 5xx, times out, or — worse — returns stale/partial data (empty option chain, quotes from 20 minutes ago, positions endpoint succeeding while orders endpoint fails). The dangerous variant is not the clean outage but the *half-truth*: the agent sees positions but not working orders and concludes it has no exposure pending.
What must hold: decisions are only made on data the system has reason to believe is current and complete; a half-answering broker leads to inaction, not confident wrong action.

**13. LLM API rate-limited, down, or slow**
Actors: LLM provider. Trigger: 429s, an outage, or a 4-minute response inside a 15-minute cycle. Cycles must complete without proposals, and a slow LLM response can collide with the next scheduled fire. A degraded-but-responding LLM (truncated output, refusal text, malformed JSON) is the nastier sibling: it returns *something*, and that something must not be executed on charity.
What must hold: no proposal ever executes unless it parsed into the exact expected structure; LLM unavailability degrades the agent to a position-managing (or at minimum inert-but-journaling) mode, never to a crash-loop.

**14. LLM proposes garbage that is syntactically valid**
Actors: LLM. Trigger: any cycle. Proposals reference a non-existent strike, an expired contract, an option symbol with a typo, a 40-lot position on a $100k account, a "spread" whose legs are the same contract, or a ticker that doesn't exist. All well-formed JSON. This will happen at least once in ~80 cycles.
What must hold: deterministic validation, not the LLM's plausibility, is the last word — an invalid or account-breaking proposal is rejected and the rejection journaled with reason.

**15. Multi-leg order: one leg fills, the other doesn't**
Actors: broker, market. Trigger: legs submitted separately (or the broker legs a marketable combo) and the short leg fills while the long leg sits unfilled as the market moves away. The account now carries a naked short option position — a risk profile nobody chose — possibly across a cycle boundary or overnight. The next cycle's LLM sees a position that matches no strategy it was told about.
What must hold: a half-executed spread is detected as such within the same or next cycle and driven to a resolved state (completed or unwound); the account is never *knowingly left* in an unchosen risk profile without a journaled decision about it.

**16. Partial fill on a single order**
Actors: broker. Trigger: 10-lot spread fills 4 lots, remainder rests. The position exists at unexpected size; the working remainder may fill an hour later, at a worse price, or after the agent has already reacted to the partial. Position-size accounting that assumed order quantity == position quantity now silently disagrees with the broker.
What must hold: position accounting derives from fills, not from orders sent; a resting remainder is a tracked object, not a surprise.

**17. Order rejected**
Actors: broker. Trigger: rejection for buying power, options approval level, unsupported multi-leg type on paper API, unmarketable price, or halted underlying. Some rejections arrive synchronously, some as an async status change after an accepted-then-rejected dance. The LLM proposed it, the code approved it, the broker said no — three layers now disagree about what happened.
What must hold: the journal's account of a cycle matches the broker's account of the same cycle — a rejected order is journaled as rejected with the broker's reason, never as an executed trade.

**18. Early assignment on a short American option**
Actors: options clearing, dividend/deep-ITM mechanics. Trigger: overnight, a short call/put in a spread is assigned. Morning: the account holds hundreds of shares of the underlying (possibly a large negative cash balance or a short stock position), plus an orphaned long leg. The LLM has never been told this is possible; the position bears no resemblance to any journaled decision. On paper accounts, assignment handling may itself be quirky.
What must hold: the first cycle after assignment recognizes "the account contains things no decision created" and treats it as an event to resolve and journal, not as noise to reason around.

**19. Expiry day (Friday-weeklies expiring during the live week)**
Actors: OCC-style expiry processing, broker. Trigger: open weekly positions on their expiry day. ITM legs auto-exercise/assign at settlement; OTM legs vanish; a spread ITM on one leg only converts into a share position over the weekend of judging. If the agent's last cycle is before the close and it holds pennies-from-the-money positions, settlement decides, not the agent.
What must hold: no position reaches expiry close without a deliberate, journaled decision to hold it there — "expiry happened to us" must never be the honest description.

**20. Fast market between decision and execution**
Actors: market, vol spike (news, 20:00 CEST Fed-style event). Trigger: the LLM saw quotes at T, code decides at T+30s, order lands at T+45s — and the underlying moved 2% in between. Limit orders miss entirely; market orders on options fill at grotesque widths. A cycle built on 30-second-old option quotes is normal; on a fast day it is a different regime.
What must hold: execution price is bounded relative to the decision's assumptions — a fill materially worse than what was decided upon is either prevented or journaled as a deviation, not silently absorbed.

**21. Git / dashboard pipeline breaks while trading continues**
Actors: git remote, pages/build pipeline. Trigger: push rejected (auth token expired, remote conflict from a manual edit, GitHub outage), or the dashboard build fails while journal commits keep landing. Trading and journaling diverge from *publishing*: the account changes for hours while the public dashboard shows Tuesday morning. Judges may inspect during exactly such a window.
What must hold: the journal (source of truth) and the rendered dashboard can diverge only in freshness, never in content — and a stale dashboard is visibly stale (last-updated), not silently wrong.

**22. Journal write succeeds, trade fails — or vice versa**
Actors: agent internals. Trigger: crash or exception between "order placed" and "journal appended" (either order). One world exists where the broker shows a trade the journal doesn't, another where the journal claims a trade the broker never saw. This is the reconciliation scenario judges will actually hit if it ever occurs.
What must hold: for every trade, exactly one of the orderings is possible and the recovery path closes the gap — the account and the journal must be re-reconcilable to a consistent story after any single-point crash.

**23. Scheduled task double-start**
Actors: Windows Task Scheduler. Trigger: a slow cycle overruns the interval and the scheduler fires the next instance; or "run task now" by the developer overlaps the scheduled run; or post-reboot catch-up fires missed instances back-to-back. Two agent processes now read the same account and may both decide to "add the position we're missing" — doubling exposure — and both append to the journal, interleaved.
What must hold: at most one decision-making instance acts on the account at a time; a suppressed or skipped instance is itself a journaled fact.

**24. Scheduled task silently doesn't start**
Actors: Task Scheduler. Trigger: task disabled after error threshold, "run only when user is logged on" misconfiguration, battery/AC condition, wrong trigger timezone, or the task ran under a session that ended. Distinct from sleep (#10) because the machine is awake and healthy — only the agent never runs. The failure mode is pure silence.
What must hold: same demand as #10, sharpened — the *absence* of cycles is detectable without anyone thinking to look, because "healthy machine, dead agent" produces no error anywhere by default.

**25. Clock skew / timezone confusion**
Actors: system clock, DST arithmetic. Trigger: CMOS drift after power loss, or code mixing local CEST with US-Eastern market hours. Symptoms: agent trades into the closed market (orders rejected or queued), stops 6 hours early believing the market closed, or timestamps in the journal disagree with broker timestamps by hours — wrecking the judge's reconciliation.
What must hold: all market-hours logic and all journal timestamps rest on one explicit timezone discipline, and journal times must be mappable 1:1 onto broker times by a third party.

**26. Power loss at home**
Actors: grid, consumer PSU. Trigger: brief blackout at 18:00 CEST, machine powers off hard (no graceful shutdown), comes back only if BIOS is set to power-on-after-loss — which consumer machines usually are not. The machine may sit dark until the developer comes home. Files being written at cut moment (journal, state) may be truncated/corrupt.
What must hold: hard power cuts corrupt at most the in-flight record, never the recoverable history; and the "machine dark for hours" case reduces to the detectable-silence demand (#10/#24), which must cover it.

**27. Disk full / journal repo grows or locks**
Actors: filesystem, git. Trigger: verbose logs or LLM transcripts appended every 15 minutes for days; or a stale `index.lock` from a killed git process blocks every subsequent commit. Trading continues, journaling dies quietly — the inverse of #21.
What must hold: a failure to *record* is treated as seriously as a failure to *trade* — the agent must not keep making unjournaled decisions for hours.

**28. Broker paper-account quirks**
Actors: Alpaca paper environment. Trigger: paper fills behave unlike live (instant fills at mid, no partial fills all week — then one; simulated assignment done oddly or not at all; paper account reset windows; option data entitlements differing from live). The agent's whole week of "experience" comes from a simulator with its own physics, and judges will inspect that simulator's ledger.
What must hold: the system's claims (dashboard, write-up) about what happened remain true *of the paper environment as it actually behaved*, including its quirks — nothing asserts live-market semantics the paper ledger won't back.

**29. API keys expire, are rate-capped, or leak**
Actors: broker/LLM credential systems, public repo. Trigger: an Alpaca key regenerated mid-week invalidates the running agent's copy; LLM daily spend cap hits at 19:00 CEST; or — the public-journal special — a key or account secret lands in a journal entry / LLM prompt dump pushed to the public repo. The journal is public by design, which makes every logged request/response a potential leak channel.
What must hold: nothing secret can transit the public journal path even in error/debug output; and auth failure is a distinguishable, journaled degradation, not generic crash noise.

**30. Trading halt or market-wide circuit breaker**
Actors: exchanges. Trigger: an underlying is halted (news) or a market-wide halt fires. Quotes freeze or vanish; open orders sit; the agent's cycle sees a market that is "open" by the clock but dead by behavior. Proposals against halted names get rejected or, worse, queue and execute violently at reopen.
What must hold: "clock says open" is not sufficient evidence of a tradable market — untradable conditions lead to abstention, and orders never sit unowned through a reopen.

## C. REVERSE — someone looks at or acts on the system

**31. Judge reconciles account against dashboard**
Actors: judge, Alpaca account (by ID), public dashboard. Trigger: judging, days after the deadline. The judge pulls the account's order/position history and walks the dashboard side by side. Every broker fill needs a matching journaled decision with a *why*; every journaled decision needs its broker outcome. Any unexplained delta — a manual intervention (#8), a lost-ack order (#11), assignment shares (#18), post-deadline trades (#6) — reads as either dishonesty or chaos.
What must hold: a stranger with only the account ID and the dashboard URL can map every account event to a journaled decision and back, with discrepancies themselves explained in the journal.

**32. Developer's evening debrief**
Actors: developer, dashboard/journal/logs. Trigger: home at 19:30 CEST, market still open, wants to know in five minutes: what happened today, what's open now, what did it decide and why, did anything go wrong. He must get this without grepping raw logs or replaying LLM transcripts — and while cycles keep firing under him.
What must hold: the developer can determine within minutes what the agent did and why, and what its current exposure is, without archaeology.

**33. Calm stop**
Actors: developer at terminal. Trigger: evening decision — "pause it overnight" or "stop trading, keep journaling". He needs the stop to actually take effect (not be overridden by the next scheduled fire), to know whether a cycle is currently mid-flight, and to know what happens to open positions and working orders while stopped: they keep living.
What must hold: a stop is a single, verifiable act whose scope is explicit — stopped means provably no new orders, while the fate of existing positions under stop is defined and known.

**34. Panic stop**
Actors: developer, possibly remote (phone at work, 16:45 CEST, dashboard shows something horrifying). Trigger: agent is doing damage *now*; next cycle in 9 minutes. He may not be at the machine. The blunt fallbacks — kill the task via RDP, revoke the API key at Alpaca, log into Alpaca and flatten by hand — each half-work and each confuse the agent's next act if any path stays alive.
What must hold: there exists a fastest-available action that certainly prevents the next order, and the developer knows in advance what it is and that it worked.

**35. Un-stop / resume**
Actors: developer. Trigger: the morning after a stop, he re-arms it. The world moved during the pause: positions decayed, maybe an order filled at the stop boundary, maybe he traded manually while stopped. The first resumed cycle must not treat the pause window's changes as its own doing, nor "catch up" missed cycles by trading harder.
What must hold: resumption starts from broker reality, journals the gap explicitly ("paused from/to, state then vs now"), and one resumed cycle behaves like one cycle.

**36. Restart after crash — trusting the state**
Actors: developer, post-crash system. Trigger: after #9/#22/#26 the developer must answer "can I just re-arm it?" He needs to see: what the journal last recorded, what the broker actually shows, and whether they agree — before the agent runs again. If he cannot cheaply verify agreement, he will either re-arm on faith or waste an evening in archaeology.
What must hold: journal-vs-broker agreement is checkable as a single cheap operation, and disagreement is displayed, not discovered.

**37. Stranger reads the public dashboard**
Actors: anonymous internet reader (HN link, other hackathon entrants, a scraper). Trigger: any time; the dashboard is public from day one. The reader sees strategies, prompts perhaps, P&L, an account ID. Risks: secrets in dumped payloads (#29), enough detail to spoof/copy the entry, ridicule from a visible blow-up — and the passive risk that the dashboard host is down exactly when a judge (or the stranger) first visits.
What must hold: everything on the dashboard is safe to show to an adversarial stranger, and its public claims stay accurate even mid-incident — the dashboard never says more than the journal knows.

**38. Judge (or developer) trips over the calendar itself**
Actors: judge reading the write-up; the brief's own dates. Trigger: the stated week contained an internal inconsistency (a "Thu Sep 4" that does not exist — Sep 4 2026 is a Friday). Whichever resolution is true, the write-up, the dashboard's date axis, the expiry choices, and the account history must tell one consistent calendar story.
What must hold: every artifact agrees on which real dates the market was traded and when the deadline fell — a reader must never be able to derive two different weeks from the materials.

**39. Judge inspects during a degraded window**
Actors: judge, half-broken system. Trigger: judging isn't scheduled around the system's health; the judge may load the dashboard during a stale-publish window (#21) or after a crash. First impressions are formed from whatever state happens to be visible.
What must hold: the dashboard's worst credible momentary state is still coherent — dated, self-describing, never mid-write garbage.

**40. Developer demos it live (video)**
Actors: developer recording the submission video. Trigger: Thu evening or Fri morning, he screen-records the dashboard and maybe a live cycle. The demo needs the system in a presentable state on demand — and a forced "demo cycle" outside the schedule is a manual trigger, i.e. a #23 double-start hazard and a journal event.
What must hold: demonstrating the system is itself a normal, journaled interaction that cannot perturb the account beyond what any cycle could.

## D. LIFECYCLE / CALENDAR

**41. HISTORICAL — superseded closed-weekend walk (use #49 and the dated correction above)**
Actors: developer building; markets closed. Trigger: the entire build happens when the system's world (US market hours, real option chains, live fills) does not exist. Everything is tested against closed-market responses, empty chains, and paper quirks unseen. Saturday's "it works" is a claim about a world that differs from Monday's. The scheduled task also exists all weekend — if armed early, it fires into closed markets for two days.
What must hold: closed-market firing is a defined, harmless, journaled behavior — and the gap between weekend-tested and Monday-real is consciously known, not assumed away.

**42. Market open, developer unreachable (the default state)**
Actors: agent alone; developer at day job or asleep during US hours he doesn't overlap. Trigger: most of every trading day — roughly 15:30–19:00 CEST daily, guaranteed. Anything in classes B happening in this window meets zero human response for 3–8 hours. This is not an edge case; it is the *majority operating condition*, and every degraded scenario above must be re-read under it.
What must hold: every failure mode has a bounded worst case that the developer has accepted in advance for an N-hour unattended window — no failure requires a human within the hour to stay bounded.

**43. Mid-week overnight (positions sleep, agent doesn't trade)**
Actors: open positions, overnight news. Trigger: every night Mon–Thu. Between 22:00 and 15:30 CEST the book is frozen but the world isn't: earnings, gaps, assignment (#18) happen with no cycle running. The first morning cycle inherits a repriced world and possibly a transformed account.
What must hold: the first cycle of each day re-derives the account's true state from the broker and journals overnight deltas before making any new decision.

**44. Last trading hours before the deadline**
Actors: developer under submission pressure, agent still armed. Trigger: Fri ~09:00–17:00 CEST (market opens 15:30). The developer is finalizing the submission — in the *same repo* the journal pushes to (merge conflicts between his submission commits and the agent's journal commits: #21 by his own hand). Open weeklies expire this very day (#19). His attention budget for the agent is zero at exactly its riskiest configuration.
What must hold: submission work and agent operation cannot corrupt each other's artifacts, and the book's Friday risk posture requires no Friday human attention.

**45. The deadline moment and what exists after**
Actors: hackathon clock, agent, judges-to-come. Trigger: Fri 17:00 CEST passes. Three regimes are possible afterward: agent keeps trading until Fri close (judges see extra hours — good showmanship or scope violation?), agent stops with open positions that then expire/assign unattended into the judging window, or agent flattens and stops. Whatever was submitted is now frozen while the referenced account keeps evolving under expiry mechanics even with the agent off (#19 with nobody home, ever again).
What must hold: the post-deadline evolution of the account is a *chosen and documented* trajectory — judges inspecting a week later find an account whose state since the deadline has a written explanation.

**46. Judging window (days-to-weeks after)**
Actors: judges, dormant infrastructure. Trigger: inspection happens well after Sep 4. The dashboard must still be up (host still paid/running? machine off?), the paper account still accessible and *not reset* (paper accounts can be reset/expired), the journal repo public at the submitted URL, and post-deadline expiry residue (#45) explained. The developer has mentally moved on; the artifacts stand alone.
What must hold: the submitted artifacts remain accessible and self-explanatory for weeks with zero maintenance — the system's story must survive its own author's departure.

**47. Labor Day trap check (calendar diligence)**
Actors: exchange calendar. Trigger: US Labor Day is the *first Monday of September* — in 2026 that is Sep 7, the Monday *after* the trading week, so Mon Aug 31 is a normal session. But the week sits close enough that a designer pattern-matching "early September = Labor Day" could wrongly skip Monday, and half-day/holiday handling in general (none this week) must not misfire. The scenario is the near-miss itself: calendar assumptions must come from an exchange calendar, not vibes.
What must hold: the agent's notion of open sessions matches the exchange's actual calendar for these specific dates, verified, not inferred.

**48. After the hackathon: the public artifact lives on**
Actors: future strangers, the developer's future self. Trigger: months later, the dashboard/repo still rank in search; the account ID is still public; keys referenced in the repo's history are still live unless rotated. A "temporary hackathon" journal is a permanent public record.
What must hold: nothing published during the week becomes a liability when it outlives the week — public-forever is the assumption at write time, not a cleanup task after.

**49. Kickoff opens while the US market is already trading**
Actors: developer, lablab clock, Alpaca account, agent. Trigger: Fri Aug 28
17:00 CEST. The event starts five hours before the US close. A reused account
is ineligible, while creating, configuring, and validating the fresh $100k
competition account consumes the same partial session that could establish
the first scored activity. Rushing to recover those hours can put unvalidated
code onto the judged account; waiting until Monday gives up valid competition
time and contradicts a claim that the agent ran from kickoff.
What must hold: the competition account is fresh, dedicated, and bound to its
literal account ID; arming time and any delay are explicit. Pre-arm gates are
never waived for P&L opportunity, and the published timeline reports the
actual first eligible cycle rather than an invented five-session run.

**50. A judge gives the entry thirty seconds before deciding whether to continue**
Actors: judge, submission page, public dashboard. Trigger: the judge opens the
entry among many competitors and follows the application URL without reading
the repository. If the first viewport does not state the paper result, current
exposure, and control model, the strongest implementation remains invisible.
If the demo path depends on a fresh live trade, market state or judging time
can make the entry appear broken.
What must hold: an unauthenticated stranger understands the claim from the
first viewport and can follow one immutable decision through proposal, veto or
approval, Alpaca outcome, and P&L contribution without causing a new order.

**51. The real submission form appears at kickoff**
Actors: developer, lablab submission form. Trigger: the event-specific form
becomes available and contains fields, limits, or upload behavior that generic
guides did not expose. Discovering the delta on submission morning leaves no
time to create a missing file or replace an inaccessible URL. A nominally
complete entry can also fail because the video is too long, the deck is not a
PDF, or a private/incognito browser cannot reach the repository or demo.
What must hold: the form is inspected once at kickoff and diffed against a
tracked deliverable register; added, changed, stricter, or contradictory
requirements are resolved, and every field, file constraint, account ID, and
public URL passes a clean-browser preflight before the internal cutoff.

**52. The judge evaluates P&L from the submitted account ID**
Actors: judge, Alpaca paper account, dashboard, journal. Trigger: judging uses
the required account ID to inspect trading activity and P&L. The dashboard may
show a persuasive total while omitting starting equity, drawdown, unrealized
positions, manual activity, or the mapping from broker fills to agent
decisions. A correct trading core cannot repair an unverifiable presentation.
What must hold: the account starts at $100k and has no development or manual
activity; broker snapshots support every displayed performance number; every
order and fill maps to a journaled intent/outcome and its sleeve contribution.
Every surface labels its evidence cutoff and uses the same account identity,
provenance, and reconciliation rules; immutable uploads may use the Sep 3
presentation cutoff while the public journal/dashboard later appends the Sep 4
deadline cutoff.

**53. The journal disk fails while risk is already open**
Actors: executor, broker, local state store. Trigger: an intact or broken
position needs a risk-reducing close, but the trading journal cannot durably
append. Blocking every mutation preserves audit order while leaving risk open;
closing with an ordinary unrecorded order falsifies the intent-before-order
claim. What must hold: the sole exception is a mechanically risk-reducing
emergency close tied to an existing exposure identity and deterministic client
order ID. It never opens risk or invents a prior rationale; the first successful
append records the broker outcome and the audit gap explicitly.

**54. An old reset paper account looks virgin**
Actors: owner, competition account, bootstrap gate. Trigger: a reused paper
account is currently flat and shows $100k after reset. Literal ID matching and a
flat snapshot pass even though earlier orders or the creation timestamp make the
account ineligible. What must hold: competition bootstrap verifies and records
account creation, exact opening cash/equity, empty positions/orders, and complete
paginated trading history before any order. Missing or incomplete provenance
blocks arming; later manual activity breaks provenance irreversibly.

**55. A worthless long option cannot be sold before flatten**
Actors: broker, expiry gate, dashboard. Trigger: a long-only orphan has fresh bid
zero and repeated zero-floor close attempts cannot fill. Calling the account flat
would lie; retrying forever makes a riskless residue monopolise the alarm path.
What must hold: only a freshly proven long-only, out-of-the-money,
non-exercising, zero-additional-liability residue may become a declared expiry
hold. It remains visible as a broker position until expiry and is never rendered
as flat.

**56. STATE_DIR is invalid before the journal can open**
Actors: startup validator, OS diagnostics, external dead-man. Trigger: the shared
journal/halt/epoch directory is missing, relative, or unwritable. The agent must
not call the broker, but cannot write the required failure into that same store.
What must hold: a pre-armed, independent diagnostic sink records a redacted
bootstrap error and a failure-only external ping fires without a success-append
precondition. The sink never becomes a second state authority; after repair the
error is folded into the trading journal.

**57. Two implementations choose different whitelist bounds**
Actors: analyst candidate, core, configuration. Trigger: expiry, strike, or
quantity is described only as “allowed,” so two conforming-looking builds accept
opposite candidates. What must hold: session-based expiry bounds, a spot-relative
strike bound, and an integer quantity ceiling are named configuration values,
validated before arming, and tested at equality and immediately outside each
boundary. Budget and exposure gates remain additional constraints.

**58. The analyst MCP exposes a trading tool**
Actors: analyst process, MCP server, executor. Trigger: an unset or widened
toolset exposes `place_option_order` or a future mutation tool to the LLM. Schema
validation cannot intercept a direct tool call. What must hold: one positive,
versioned capability manifest generates the MCP toolset and validates the actual
offered inventory at startup. The analyst child receives only dev data-account
credentials and no executor CLI/shell environment; any extra capability blocks
arming.

**59. A smoke test is called a successful dev live test**
Actors: owner, dev account, arming gate. Trigger: accept/cancel worked once, but
credit acceptance, a real fill/outcome path, or the liquidity inputs were never
observed. A hand-entered timestamp still unlocks the competition account. What
must hold: `successful_dev_live_test_at` is derived only from a machine-readable
certificate tied to the runtime and role-neutral policy digests, with broker evidence for
all named market-hours checks and a flat terminal dev account. Any code/config
change invalidates the certificate.

**60. The watchdog inherits a mixed intact-and-residue book**
Actors: stalled agent, watchdog, broker. Trigger: after fencing, reconciliation
finds an intact spread, an orphan short option, and assigned short stock. A
whole-structure-only flatten skips or throws on the residues. What must hold:
the watchdog dispatches matched intact structures to mleg close policy and every
residue through reconciliation recovery, including uncapped marketable-limit
S-X-06 for unbounded shorts, under one epoch and halt with immediate fail-ping.

**61. A live trading origin reports the expected account ID**
Actors: startup validator, mutation gateway, Alpaca. Trigger: the selected role
and expected account ID are internally consistent, but its configurable trading
base URL points to the live API, a redirect, or a lookalike host. ID binding
alone passes. What must hold: startup and every mutation bind the explicit role
to the exact canonical paper-trading origin plus the independently configured
account ID. Any other order-capable origin fails before broker mutation; market
data uses its own narrow allowlist.

**62. A different MCP package exposes the same 32 tools**
Actors: startup validator, MCP launch environment, analyst. Trigger: the
installed server version drifts while its offered tool names remain identical,
or validation inspects one Python environment and launches another. What must
hold: package name/version are read from the exact launch interpreter and match
the manifest before spawn; launch-artifact identity and manifest hash bind the
pre-arm certificate; exact offered inventory is still checked afterward.

**63. The executable entry limit is worse than the quoted candidate premium**
Actors: pure core, reservation ledger, broker. Trigger: a debit order may fill
up to a higher buy limit, or a credit order down to a lower sell limit, than the
candidate's mid/target premium. Reserving against the target understates loss.
What must hold: defined-risk arithmetic and every sleeve/open-risk reservation
use the least favourable fill allowed by the final tick-rounded submitted
limit. Any re-price recomputes and re-approves atomically; improvement releases
budget only after reconciliation.

**64. A resting entry fills after the drawdown kill fires**
Actors: executor, broker, kill manager. Trigger: equity crosses the threshold
while an older risk-increasing entry remains non-terminal. Flattening current
positions without cancel reconciliation lets that order fill into a halted
account. What must hold: halt and kill intent become durable, every entry is
canceled and cancel/fill races reconciled, the broker book is reloaded, and the
resulting fills are flattened. Flat requires no risk-bearing position and no
risk-increasing non-terminal order; existing protective exits are not blindly
canceled or duplicated.

**65. The safe agent reaches September with no qualifying fill**
Actors: analyst, core, broker, submission owner. Trigger: every cycle is healthy,
but candidates are correctly vetoed or bounded limits never fill. The account is
safe and provenance-clean, yet the promised P&L evidence path has no ordinary
competition options activity. What must hold: a Sep 1 US-close checkpoint
exposes the competitiveness risk. Through Sep 2 only, the analyst may prioritize
one-lot, liquid, minimal-risk candidates under a stricter loss cap, but the
ordinary schema, all deterministic gates, revalidation, and limit pricing remain
unchanged and may still decide no trade. If no ordinary broker fill exists at
window end, internal winning acceptance fails visibly; external eligibility is
left to the organiser/form clarification, not invented locally.

**66. The one-page write-up becomes a two-page Markdown export**
Actors: submission owner, renderer, actual form. Trigger: the Markdown source
contains every required topic, but font or layout changes produce two pages, or
the form rejects Markdown/PDF. What must hold: one canonical form-ready artifact
is chosen at kickoff, renders reproducibly as exactly one page, and passes the
actual form's MIME/size/upload-or-link validation. Preflight names that exact
artifact; parallel variants cannot drift.

**67. Final presentation assets are due before their own evidence exists**
Actors: broker reconciliation, dashboard publisher, video/deck renderers.
Trigger: video and deck are marked final at 20:00 CEST although Sep 3 US trading
does not close until roughly 22:00 and the promised presentation cutoff is
post-close. What must hold: content/layout freeze before close, then one
reconciled cutoff dataset and immutable dashboard route feed every mutable
number. Canonical assets render and pass a cutoff-identical preflight afterward,
with submission contingency still intact.

**68. A fenced writer still holds its old OS lock**
Actors: paused executor, watchdog, mutation gateway. Trigger: the watchdog
increments the control epoch and takes over while the paused executor retains
or later reacquires an OS lock. Treating that lock as alternate authority lets
the stale process mutate after fencing. What must hold: every authoritative
gateway request validates the carried epoch against the persisted current value
at final dispatch. The lock only serializes; stale or unreadable epoch rejects
entries, cancels/closes, management actions, and authoritative appends while the
single witness append remains allowed.

**69. The valid dev certificate dies when the role changes**
Actors: dev live-test certificate, competition bootstrap, config validator.
Trigger: a raw config hash contains the dev profile/account/credentials, which
must change at competition arm. Either the certificate always mismatches or an
implementation silently ignores an open-ended set of fields. What must hold:
versioned canonical runtime and role-neutral policy digests exclude only the
closed profile/account/credential identity set. The paper origin stays policy;
competition identity/provenance validate separately; unknown fields fail.

**70. An emergency close duplicates an ordinary resting close**
Actors: ordinary executor, journal failure route, broker. Trigger: a full-size
ordinary close remains non-terminal when append fails; the emergency path sees
the current exposure and sends another individually risk-reducing close. Both
fill and reverse the position. What must hold: all close routes share one
exposure lifecycle, adopt a sufficient existing child, subtract fillable close
quantity, and wait for terminal cancel before replacement. At most one child is
non-terminal/unclear; final dispatch rechecks fills and remaining quantity.

**71. A patched MCP install keeps the expected name, version, and tools**
Actors: dependency installer, MCP launcher, analyst boundary. Trigger: modified
package bytes — including a valid-header executable `.pyc` beside unchanged
source — advertise 2.3.0 and the same 32 names, then S-ARM records a digest of
those already-modified bytes. What must hold: expected source, dependency,
interpreter, and immutable-file identities come from a tracked lock anchored to
an official immutable upstream commit, never from the installed environment.
Before the dedicated environment is verified and spawned, all Python bytecode
is removed, its absence is checked, and bytecode writes are disabled; exact
tool inventory is checked separately.

---

## Cross-cutting observation (not a scenario)

Three demands recur so often they are effectively the catalog's spine: (1) **broker truth over remembered state** — nearly every degraded and lifecycle scenario ends in "re-derive from the broker before acting"; (2) **detectable silence** — the worst failures here produce no error, only absence (#3, #10, #24, #26, #27); (3) **journal/account bijection** — the judge scenario (#31) is the acceptance test the entire week is secretly running toward, and scenarios #8, #11, #17, #18, #22, #45 are all ways that bijection breaks. Any spec measured against this catalog should be checked against those three first.
