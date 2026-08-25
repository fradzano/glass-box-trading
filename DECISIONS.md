# DECISIONS

Owner = Felix. Format: date — decision — rationale (one line each; this repo is
small, no ADR split).

- **2026-08-24 — Enter the hackathon; framing: compete on the skill axes, treat
  P&L as declared variance.** Five sessions of P&L are noise; the honesty IS the
  creativity claim. (CONCEPT §1)
- **2026-08-24 — Strategy: two-sleeve barbell (Option C), defined-risk only.**
  Serves both P&L outcomes, gives the agent real decisions to journal; chosen
  over pure-income and pure-convex. (CONCEPT §2)
- **2026-08-24 — Architecture: "AI proposes, gates dispose"** — LLM analyst
  read-only via MCP, deterministic pure core owns every order. (CONCEPT §3)
- **2026-08-24 — Constraints: agent must run autonomously; budget 3 build
  evenings + 1 close-out; own throwaway repo; own Alpaca accounts (the
  pre-existing account is out of bounds).**
- **2026-08-24 — CLAUDE.md committed openly**, not hidden via exclude — the
  build rules are part of the exhibit.
- **2026-08-24 — Social track (O4): NO for now.** Revisit only if development
  shows presentable results.
- **2026-08-24 — Pre-kickoff build pulled forward.** The rule book bans
  plagiarism, not preparation; timeline stays transparent in the history.
  Replaces the earlier self-imposed "scaffold only before kickoff" policy (O3).
- **2026-08-24 — Build ladder before code: Szenario → Axiom → Spec → Code, with
  a CAPPED adversarial pass on the spec (2–3 rounds, not the full bis-0 end
  condition).** Deliberate, named deviation: paper money, schedule is the
  scarce resource; a non-zero end state is declared to the owner, not hidden.
- **2026-08-24 — Calendar corrected: Sep 4 2026 is a Friday** (five sessions;
  flatten Thu Sep 3 close). Caught by the cold scenario derivation, not by two
  prior reviews — recorded as evidence for the ladder's value. (SCENARIOS.md #38)
- **2026-08-24 — Analyst auth: Claude subscription via `claude setup-token`
  (1-year OAuth), API key only as deliberately-injected fallback** — never both
  in the same environment (precedence). (CONCEPT §9 O2)
- **2026-08-24 — Journal lives on a dedicated `journal` branch** (Vercel prod
  branch); humans never commit there. (CONCEPT §5)
- **2026-08-25 — Axiom distillation reviewed (owner-directed blind/gate pass,
  explicitly NOT a terminated bis-0 run).** Findings fixed before the spec:
  A finding — no axiom bound the executor to the permitted account (→ new
  A24); B findings — A23 ignored fillable/confirmation-unclear entry orders,
  A11's "never leg-wise" forbade risk-reducing recovery after assignment or
  orphan fills, missing pre-submit revalidation under concurrent human action
  (→ A13), missing working-order ownership across trading halts (→ A16),
  missing concrete "why" per fill (→ A5). Distillation declared load-bearing
  after these fixes. (docs/AXIOMS.md)
- **2026-08-25 — Owner call A (A23): unattended worst case accepted as max
  $12k income + $8k convex against the initial $100k paper capital.**
  Counting rule: exactly once per exposure-lifecycle identity — filled
  position plus fillable or confirmation-unclear entry remainder or INTENT;
  partial fills split into filled portion and remaining reservation; exit
  orders not counted additionally. $20k is the declared constructive paper
  worst case, not a guarantee against broker/assignment/liquidation
  mechanics.
- **2026-08-25 — Owner call B (A22): Friday is journaling-only.** Thursday
  close = zero positions and zero non-terminal orders, so Friday broker
  mutations are technically excluded. 17:00 CEST: dedicated
  `DEADLINE_RECONCILIATION` cycle with full broker snapshot and a reference
  to the submitted revision. US close: final snapshot, durable terminal
  state, controlled end of scheduler and dead-man expectation. Account and
  published artifacts stay unchanged and available at least through judging.
- **2026-08-25 — Owner call C (A18): silence SLA is 45–60 minutes ABSOLUTE**
  (not "two missed cycles"). healthchecks.io check: pre-activated, finite,
  cron/OnCalendar on `America/New_York` and the actual session slots; ping
  only after a durable local journal append; mail plus one concretely named
  push channel, both tested in practice; ping URL stays secret. SaaS
  blindness is declared as an A23 residual — two delivery paths of one
  service are not two detectors.
- **2026-08-25 — Owner call D (A19): panic path is NOT key regeneration
  alone** — it is a credential fence, not an atomic stop (accepted/working
  orders survive; cancellation is a separate operation). Halt flag = calm
  stop. Key rotation qualifies as broker-side panic fence only after a
  dev-account drill proving a single order-capable credential, and is always
  followed by a working-order check/cancellation in the broker dashboard.
  Re-arm exclusively under halt after full reconciliation.
