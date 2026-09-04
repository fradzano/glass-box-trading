# Publish runbook — the judge-facing dashboard on Vercel

Owner runbook for SUB-02 / SUB-11 ([`SUBMISSION-SPEC.md`](SUBMISSION-SPEC.md)
§2–§4). The README section "Publish the judge-facing dashboard" states the
mechanism; this file is the click-by-click record of the first setup
(2026-09-02, 21:05–21:20 CEST) and the routine for every later snapshot. It
exists because the frozen build has no production caller for the publisher
and no git or Vercel port ([`../DECISIONS.md`](../DECISIONS.md), R35 C4):
every step below is a hand step, and none of them touches the operating
checkout's runtime digest.

## Fixed facts

| Item | Value |
|---|---|
| Stable URL (the submitted demo URL) | `https://glass-box-trading.vercel.app` |
| Vercel project | `glass-box-trading`, CLI-linked, no Git integration, framework *Other*, no build |
| Vercel team | created as `glass-box-trading` on 2026-09-02; rename pending (see below) |
| Owner publish directory | `C:\Users\felix\gbt-publish` |
| Journal copy | `C:\Users\felix\gbt-publish\journal-copy.jsonl` (a copy; the renderer refuses the live `STATE_DIR`) |
| Output | `C:\Users\felix\gbt-publish\out\{site,deploy,publish-manifest.json,probe-*.json}` |
| Render source | the worktree `C:\Users\felix\source\worktrees\gbt-publish` (its `dist/`), never the operating checkout |
| Account id shown | `PA376WIK2ATL` (passed as `-AccountId`; the projection's expectation, not read from the journal) |

The worktree is the render source on purpose: the operating checkout must
not be touched while the agent runs, and the worktree's build differs from
freeze two only in the analyst brief, which the projection never calls.

## One-time setup (done once; repeat only for a new host or account)

1. **Account.** `https://vercel.com/signup`, *Continue with GitHub* (`fradzano`), plan *Hobby*. Skip the "import a Git repository" wizard: a Git-linked project would build on every push, while we upload a finished static folder by CLI.
2. **CLI.** In any terminal outside the checkout: `npm install -g vercel`, then `vercel --version`. Never `npm install` inside the checkout — `package.json` and the lock are digest material.
3. **Login.** `vercel login` → *Continue with GitHub* → browser → back. The CLI stores the session in the user profile, not in the repository.
4. **Link the deploy folder to a new project.**
   ```
   cd C:\Users\felix\gbt-publish\out\deploy
   vercel link
   ```
   Observed prompts and answers: *Which scope?* → the team; *Which project?* → *Create a new project*; *Name?* → `glass-box-trading` (this name is the stable URL `glass-box-trading.vercel.app`); *Code directory?* → `./`; *Customize settings?* → `no` (the `vercel.json` in the folder pins framework *Other*, no build). The CLI writes `.vercel\project.json` (carried forward by the renderer on every re-render) and a `.env.local` with a `VERCEL_OIDC_TOKEN` (never uploaded; dropped on the next re-render; not a repository file).
5. **Deployment Protection.** Vercel enables it for new projects. `https://vercel.com/dashboard` → project → *Settings* → *Deployment Protection* → *Vercel Authentication* off → Save. On Hobby it would gate exactly the generated candidate URLs that the probe and step 2 of the routine rely on. Measured 2026-09-02: the candidate answered 200 anonymously.

## Routine for every snapshot

```
Copy-Item C:\Users\felix\glass-box-state\competition-2\journal.jsonl C:\Users\felix\gbt-publish\journal-copy.jsonl -Force
C:\Users\felix\source\worktrees\gbt-publish\tools\publish-dashboard.ps1 -RepoRoot C:\Users\felix\source\worktrees\gbt-publish -JournalCopy C:\Users\felix\gbt-publish\journal-copy.jsonl -OutDir C:\Users\felix\gbt-publish\out -AccountId PA376WIK2ATL [-PresentationCutoff <ISO>] [-DeadlineCutoff <ISO>]
cd C:\Users\felix\gbt-publish\out\deploy
vercel deploy --prod --skip-domain --scope team_XHvR3OjF9qbiuR0Sea514xMX
C:\Users\felix\source\worktrees\gbt-publish\tools\probe-dashboard.ps1 -BaseUrl <candidate URL> -Manifest C:\Users\felix\gbt-publish\out\publish-manifest.json
vercel promote <candidate URL> --scope team_XHvR3OjF9qbiuR0Sea514xMX
C:\Users\felix\source\worktrees\gbt-publish\tools\probe-dashboard.ps1 -BaseUrl https://glass-box-trading.vercel.app -Manifest C:\Users\felix\gbt-publish\out\publish-manifest.json
```

`--scope` names the team by id (the `orgId` in `.vercel\project.json`). Measured 2026-09-03 from a non-interactive shell: without it `vercel deploy` fails with `"reason": "deploy_failed", "message": "Not authorized"` although `vercel whoami` answers and the folder is linked; with it the same command deploys. In an interactive terminal the CLI may resolve the scope from the link on its own, so the flag is harmless there and necessary here.

1. **Render.** The wrapper prints the journal revision, the last seq, the routes and the discrepancy count. Read `out\deploy\index.html` locally once before uploading anything new.
2. **Candidate.** `vercel deploy --prod --skip-domain` prints an immutable URL of the form `https://glass-box-trading-<hash>-<team slug>.vercel.app`. The team slug is part of that hostname; the stable alias is not moved yet. (The first deployment of a new project also prints an `Aliased` line — that is Vercel's per-team production URL, not the stable alias.)
3. **Probe the candidate.** Every line `[PASS]`, final line `PROBE PASSED`. A receipt `probe-<utc>.json` lands beside the manifest. Failure modes: HTTP 404 on every route means the URL was typed with the wrong team slug (the CLI's output is authoritative); a redirect or 401 on every route means Deployment Protection is on again; a 404 only under `/revisions/...` would be a host-semantics change — stop and report, do not promote.
4. **Promote.** `vercel promote <candidate URL>`; the stable alias now serves that deployment.
5. **Probe the alias.** Same command against `https://glass-box-trading.vercel.app`; keep this receipt with the submission evidence. If it fails, `vercel rollback` (to the previously accepted deployment) and alarm — SUBMISSION-SPEC §4.
6. **Cutoffs.** After Thursday's close, once the journal is reconciled and risk-flat, pass `-PresentationCutoff <ISO of the last entry at that cutoff>`; the pinned route `/revisions/sha256-<hex>/presentation/` is then byte-stable across later runs and is the route the video, one-pager and slides cite. After the Friday cut pass `-DeadlineCutoff` as well. The first pinned publish was also the first run of the probe's nested-route pin check on the real host: measured 2026-09-03 (see below), R37 C-3 is closed there.

## Second snapshot — the presentation pin (2026-09-03, 22:00–22:04 CEST)

Run by the PM session from a non-interactive shell after the Thursday session closed flat. Journal copy at seq 76 (the 22:00 cycle), `-PresentationCutoff 2026-09-03T20:00:14.787Z`. Render: revision `sha256:7b82959a344a7c7e`, routes `/`, `/revisions/sha256-7b82959a344a7c7e/latest/`, `/revisions/sha256-7b82959a344a7c7e/presentation/`; the previous revision's route `/revisions/sha256-c1c8e14ea4035034/latest/` was carried forward into the deploy tree and answers 200 on the new deployment. One discrepancy on the page, left visible on purpose: `UNATTRIBUTED: -241 cents of the equity delta are not explained by joined fills and marks` (the same order of magnitude as the $2.10 the certificate round trip cost; a fee-shaped residual, not a fill the journal lacks). Candidate `https://glass-box-trading-36tmdc9fm-glass-box-trading.vercel.app`, probe 29/29 PASS including the nested-route pin and the percent-encoded-spelling-not-served checks on the real host; promoted (`dpl_8qBNHaMrPd9FuJ89X6PdLHXrpjvd`); alias probe 29/29 PASS, receipt `probe-20260903T200341Z.json` (copied into the verification store's `evidence/`). The `DEADLINE_RECONCILIATION` entry (seq 77) was written after the pin and references `sha256:7b82959a344a7c7e`, so the pinned route stays byte-stable and the reference resolves on the dashboard. The route the video, one-pager and slides cite is `https://glass-box-trading.vercel.app/revisions/sha256-7b82959a344a7c7e/presentation/`.

## Third snapshot — the deadline pin (2026-09-04, 22:12–22:17 CEST)

Run by the close session from a non-interactive shell after the `TERMINAL` entry landed (seq 105, `2026-09-04T20:11:48.122Z`). Journal copy at seq 105, `-PresentationCutoff 2026-09-03T20:00:14.787Z` unchanged and `-DeadlineCutoff 2026-09-04T20:11:48.122Z`. Render: revision `sha256:78af85c1c238a49d`, routes `/`, `/revisions/sha256-78af85c1c238a49d/{latest,presentation,deadline}/`, one discrepancy (`UNATTRIBUTED: -313 cents`, the same fee-shaped residual as before, now over the full week). Candidate `https://glass-box-trading-oluchhl8s-glass-box-trading.vercel.app`, promoted as `dpl_CzQg2ZSVJ4qD59KS2drZx7AmUSwV`; receipts `probe-20260904T201435Z.json` (candidate) and `probe-20260904T201634Z.json` (alias), both copied into the verification store's `evidence/`.

The route the submission cites, `/revisions/sha256-7b82959a344a7c7e/presentation/`, is byte-stable through the whole step: SHA-256 prefix `c8745e3f5dc00401` over 157,652 bytes on the live alias before the render, on the candidate, and on the alias after the promotion, equal to the local file in `outdeploy`. Its `projection.json` still names `sha256:7b82959a344a7c7e` at cutoff `2026-09-03T20:00:14.787Z`, last seq 76.

**Both probe runs came back 47 of 48, and the red line is the instrument, not the site.** The manifest's `jsonRoutes` is every `.json` in the deploy tree, and the probe expects each of them to name the manifest's current `journalRevision`; a carried-forward immutable route must name its own, older revision, so `/revisions/sha256-7b82959a344a7c7e/presentation/projection.json` fails by construction. Earlier snapshots stayed green only because no carried-forward route had a `projection.json` yet. Everything that check protects was measured by hand instead (the paragraph above), and the promotion was ruled on that basis (DECISIONS 2026-09-04); `vercel rollback` remains the way back. Until the manifest carries an expected revision per JSON route, step 3's "a failed probe means the candidate is not promoted" needs the operator to read *which* check failed.
## What the host was measured to do (2026-09-02, anonymous `curl`)

- `/` and `/data/projection.json` answer 200; the `glass-box-*` meta equal the manifest.
- `/.env.local`, `/.vercel/project.json`, `/vercel.json` answer 404: link and token files are not served.
- `/revisions/sha256%3A<hex>/latest/index.html` answers 404: the host decodes request paths, so the renderer's percent-encoded directory name would not have been reachable. The deploy tree's `sha256-<hex>` spelling is necessary, not merely cautious.
- `/revisions/sha256-<hex>/latest` (no trailing slash) redirects 308 to the slash form (`trailingSlash: true` in `vercel.json`).

## Team rename (pending owner step)

The team was created under the name `glass-box-trading`, the same as the project. Renaming the team: `https://vercel.com/dashboard` → team switcher (top left) → the team → *Settings* → *General* → *Team Name* and *Team URL* → Save. What that changes and what it does not (the second and third points are `plausibel`, verify with the probe after the rename): the Team ID is unchangeable, so `.vercel\project.json` (which stores the team by id) stays valid and no relink is needed; the stable URL derives from the project name and stays `glass-box-trading.vercel.app`; the team slug appears in future candidate hostnames (`…-<new slug>.vercel.app`), so always copy the candidate URL from the CLI output rather than typing it. After the rename run the alias probe once and keep the receipt.

## Declared limits

- No `journal` branch is pushed by this path; the page's revision is the content hash of the journal copy (`journalContentRevision`), the value the publisher's fake git port would have produced. `-JournalRevisionUrl` is shown on the page only when passed.
- The published page differs from the frozen renderer's page in exactly one `href` per page (the history pin, rewritten root-absolute and host-safe); `tests/publish-dashboard.spec.ts` pins that equality.
- SUB-11's "automatically before every post-submit promotion" is met by running the probe before every promotion by hand, not by code.
