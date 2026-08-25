# Evidence debt — trigger paths the red-first tests MUST execute

Owner ruling 2026-08-25 (spec-pass D16, "executable: yes"): findings from
the adversarial pass that were closed only argumentatively do not count as
proven. Each row below names the trigger path a test must actually drive;
a green suite that skips these paths has not discharged the debt. Source of
record for the full finding texts: the spec-pass run store (machine-local);
this file is the tracked, clone-portable register. Check a row off by
citing the test ID next to it in the same commit that adds the test.

## From spec-pass R1 (closed RESOLVED by argumentative counter-verification)

| ID | SPEC case(s) | Trigger path to execute |
|---|---|---|
| AUS-1 | S-CYC-09 | first run ever: empty journal + virgin account → BOOTSTRAP; empty journal + non-empty account → GAP + halt |
| AUS-2 | S-X-03/04, S-G2-07 | sync and async broker rejection → OUTCOME rejected + reservation released on every terminal path |
| AUS-3 | S-G12-06 | 401/403 mid-run → AUTH_FAILURE (≠ WORLD_UNREACHABLE), all orders blocked |
| AUS-4 | S-J-08 | journal writer configured with non-journal ref → refusal, journaled |
| BEQ-1 | S-G9-02, S-X-05 | eviction close vetoed/rejected → re-enters ladder every cycle until terminal |
| BEQ-2 | S-CYC-10 | CONFIRMATION_UNCLEAR + broker still down next cycle → entries stay blocked |
| BEQ-3 | S-CYC-05 | manual trade elsewhere in account between approval and submit → REVALIDATION_VOID |
| BEQ-4 | S-G6-05(b) | frozen price+size with advancing timestamps → veto without any stale-age signal |
| BEQ-5 | S-G12-02, S-CYC-11 | config violating the bound inequalities → refuses to arm |
| BEQ-6 | S-J-06 | broker-reported account ID ≠ EXPECTED_ACCOUNT_ID → refuse all orders |
| BEQ-7 | S-J-04 | boilerplate rationale / missing snapshot ref → INTENT non-conforming |
| BEQ-8/DOM-1 | S-G8-06 | credit condor tagged convex (and debit tagged income) → SLEEVE_MISMATCH |
| BEQ-9 | S-G10-02 | residue unresolved past RESIDUE_MAX_SESSIONS → fail-ping while halt + attempts continue |
| BEQ-10 | S-X-01, §0 | limit price uses LIMIT_TOLERANCE from config, not a constant |
| DOM-2 | S-G8-01/03 | structural failure drops whole output; semantic violation drops only the candidate |
| DOM-3 | S-G11-01/02 | illiquid leg on FLATTEN_DATE → ladder walks it across the spread; Thursday-fail → Friday closes still run |

## From spec-pass R2 (argumentative closures + text-fixed-unverified)

| ID | SPEC case(s) | Trigger path to execute |
|---|---|---|
| GV-1 | S-CYC-09 | lost journal + non-empty account → NOT adopted as baseline (GAP + G10 halt) |
| GV-5 | S-CYC-11, S-J-06 | unset/empty EXPECTED_ACCOUNT_ID → never arms; empty-vs-empty never matches |
| UNF-2 | S-J-07 | build interrupted mid-render → previous page fully intact; page names its journal revision |
| NUT-1/R-NUT-1a | §0.5 | every case ID appears in exactly one tier (partition test over the spec text) |
| UNF-1 | preamble/§0.5 | count check: 90 test cases + 1 declared limit; S-G14-04 carries no test |
| GV-6b | S-G8-06 | mis-declared structure type with contradicting leg premium signature → economics from legs win |

## From the owner-ruling seams (R3 cold verification, fixed in text 2026-08-25)

| ID | SPEC case(s) | Trigger path to execute |
|---|---|---|
| KGV-1/2 | S-G12-07, S-G12-01 | fenced writer: every authoritative mutation rejected, exactly one FENCED_OUT witness line lands |
| KGV-3 | S-G12-07 | two concurrent takeover attempts → exactly one winner (atomic compare-and-increment) |
| KGV-4 | S-G12-07 | absent/reset epoch store + non-virgin account → GAP path, no silent re-seed; virgin re-seed is journaled; STATE_DIR misconfig never arms (residual: two deliberate STATE_DIRs = declared limit) |
| KGV-1-REG | S-J-03, S-G12-07 | FENCED_OUT passes schema validation as a closed-set type and as a primary substitute; witness-class membership has exactly one source |
| KGV-5 | S-CYC-05 | equity crosses kill threshold between snapshot and submit → KILL flatten+halt SAME cycle |
| KGV-6 | S-CYC-05 | REVALIDATION_VOID entry carries claimset + violated claim |
| KGV-7 | S-X-06 | worthless orphan long reaches expiry-hold only with fresh long-only/OTM/non-exercise/zero-liability proof and remains visibly not-flat |
| KGV-8 | S-CYC-11 | short-capable whitelist without S-X-06 capability flag → never arms |
| KGV-9/12 | §1, S-G6-05 | history missing/over-age for ONE underlying → entries blocked only there; over-age prior sample never satisfies signal (b) |
| KGV-11 | S-J-03 | SKIP-with-snapshot carries quote samples; SUPPRESSED leaves a hole the age rule handles |
| KGV-14 | S-G14-03 | every case prescribing a fail-ping actually pings (incl. S-X-06, S-G9-02, S-G11-04) |
| KGV-15 | S-CYC-11 | SNAPSHOT_STALENESS_BOUND outside its coupling → never arms |
| KGV-17 | §0, watchdog | DEAD_MAN_BOUND + ALERT_DELIVERY_BUDGET ≤ 60 min asserted in config validation |

## From the winning-path reverse read (R5, fixed in text 2026-08-25)

| ID | SPEC case(s) | Trigger path to execute |
|---|---|---|
| WIN-1 | S-CYC-06, S-J-09 | journal-only failure with open exposure → deterministic risk-reducing emergency close, explicit audit-gap reconciliation, no invented INTENT; authority-store failure → no mutation |
| WIN-2 | S-CYC-09, SUB-08 | old/reset flat $100k account with reused history → competition BOOTSTRAP and submission both fail; later manual activity sets irreversible provenance latch |
| WIN-3 | S-G9-02, S-G11-01/04, S-X-06 | bid-zero long residue exercises the narrow expiry-hold exception only with complete proof and is never rendered flat |
| WIN-4 | S-CYC-11, S-G14-03 | unopenable STATE_DIR → zero broker calls, redacted OS diagnostic, failure-only ping, no success ping, later journal import |
| WIN-5 | S-G8-03, S-CYC-11 | expiry/strike/qty equality passes; one session/basis-point/contract beyond fails; missing or contradictory bounds never arm |
| WIN-6 | S-CYC-11, S-G12-07 | actual MCP inventory includes any capability outside positive manifest or child sees competition/executor env → never arms |
| WIN-7 | S-ARM-01, S-CYC-11 | incomplete, manual, wrong-account, digest-mismatched, or asynchronously rejected credit evidence → never arms; only positive credit acceptance plus full broker-backed certificate passes |
| WIN-8 | S-G14-02, S-G10-03, S-X-06 | watchdog takeover with intact spread + orphan short + assigned short stock → one fence, correct mleg/residue dispatch, no duplicate, halt, journal, fail-ping |

## From the second winning-path blind pass (R6, fixed in text 2026-08-25)

| ID | SPEC case(s) | Trigger path to execute |
|---|---|---|
| WIN-9 | S-CYC-11, S-J-06 | live/redirect/lookalike trading origin with matching account ID, or unknown profile → fail before mutation; valid paper origin + wrong ID still fails; valid market-data origin remains usable |
| WIN-10 | S-CYC-11 | identical 32-tool inventory from wrong/missing/ambiguous MCP distribution or different checked/launched interpreter → fail before spawn; manifest or launch-artifact drift invalidates pre-arm certificate |
| WIN-11 | S-G1-01..04, G2–G4, S-X-01/02 | target/mid premium passes but least-favourable submitted limit exceeds sleeve/open-risk budget → veto; re-price recomputes atomically; partial/price-improved fills release only reconciled excess; impossible worse-than-limit broker record halts visibly |
| WIN-12 | S-G13-01 | resting entry during kill: cancel-before-close, full/partial fill race becomes reconciled exposure and is flattened; lost ack never reports flat; existing protective close is neither canceled nor duplicated |
| WIN-13 | S-CYC-12, submission gate | no candidate/all safe non-fills through Sep 1 → visible competitiveness alarm; qualification attempt remains one-lot, capped, and inside every normal gate; no fill by Sep 2 → internal failure/owner waiver, not invented external ineligibility |
| WIN-14 | SUB-03, SUB-09 | canonical one-pager reproducibly renders exactly one page and passes the actual form's MIME/size/upload-or-link validation; rejected type causes one recorded target change, not drifting variants |
| WIN-15 | SUB-03/04/05/09 | pre-close draft cannot pass final acceptance; one post-close reconciled dataset drives every mutable number and the immutable route before canonical render/preflight |
| WIN-16 | S-G12-07 | old writer still holding/reacquiring OS lock after epoch takeover → every authoritative request rejected at final gateway, exactly one witness allowed; unreadable epoch never authorizes mutation |
| WIN-17 | S-ARM-01, S-CYC-11 | dev→competition identity-only switch preserves runtime/policy proof; policy/origin/lock/code change or unknown field invalidates; secrets never enter public digest material |
| WIN-18 | S-CYC-06, S-G7-01/02 | existing full/partial/unclear ordinary close during journal failure is adopted or residualized under one lifecycle; cancel/fill race and emergency retry never create a parallel child or reverse exposure |
| WIN-19 | S-CYC-11 | same package metadata/tool inventory with patched files or valid-header malicious `.pyc`, different interpreter, unpinned dependencies, or self-learned expected hash → bytecode is removed/blocked and the launch fails before spawn; pinned-source rebuild with bytecode absent/disabled plus exact inventory passes |

C-class backlog (no debt, tracked for hygiene): KGV-16 wording (fixed),
KGV-18 traceability (fixed), push channel naming (NUT-3), dashboard deploy
path (UNF-2 side note), fees outside maxLoss arithmetic, frozen-process
fencing drill note (covered by KGV-1 test), GV-1 rest observations.
