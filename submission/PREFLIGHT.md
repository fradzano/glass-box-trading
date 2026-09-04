# Submission preflight — SUB-09

This checklist is run from a clean browser (no session, no login, no
extensions that could mask a failure) against the actual submission form and
the frozen presentation-cutoff dataset (the pinned presentation route's
`revisions/sha256:7b82959a344a7c7e/presentation/projection.json`, produced by the
dashboard publish pipeline at 2026-09-03T20:00:14.787Z; on the host the route directory is spelled `sha256-7b82959a344a7c7e`, i.e. `sha256-<hex>`, see README "Publish the judge-facing dashboard"). Every cross-artifact
number comparison below is only valid between artifacts labelled with the
*same* cutoff; an unlabeled or cross-cutoff comparison is rejected outright,
never averaged or rounded into agreement. Results are left blank here and
filled in at run time — draft Sep 3, a cutoff-identical run by Sep 3 23:45,
and a rerun before Sep 4 12:00 per `docs/SUBMISSION-SPEC.md` §4/§6.

| Check | Surface | How verified (clean browser, no login) | Result | Timestamp |
|---|---|---|---|---|
| Title field ≤50 chars, matches `submission/COPY.md` exactly | Submission form | Open form, read rendered title field, diff against COPY.md | PASS: submitted project page shows "Glass Box Trading" (page fetched anonymously) | 2026-09-04T12:12:00Z |
| Short description ≤255 chars, matches `submission/COPY.md` exactly | Submission form | Open form, read rendered field, diff against COPY.md | PASS: the 133-character line from COPY.md appears on the project page | 2026-09-04T12:12:00Z |
| Long description ≥100 words, matches `submission/COPY.md` exactly | Submission form | Open form, read rendered field, word-count and diff against COPY.md | PASS: the 1,980-character COPY.md text appears verbatim on the project page (form ceiling 2000) | 2026-09-04T12:12:00Z |
| Tag list matches `submission/COPY.md`, respects the form's delimiter/max-count/allowed-character rules | Submission form | Open form, read rendered tags, diff against COPY.md | PASS as the form defines it: Technologies Alpaca, Anthropic Claude, Claude Code, Vercel; track Options Alpha Agents; categories Finance, Investment (the free-text tag list of the earlier COPY.md draft does not exist on this form) | 2026-09-04T12:12:00Z |
| One-pager upload: exact MIME type, byte size, renders as exactly one page | Submission form file upload | Download the uploaded file back from the form; open in a plain PDF viewer; verify page count = 1 | N/A on this form: no one-pager upload field exists; the PDF is linked from the Additional Information field to `main` (GitHub renders it, anonymous 200); local facts: 1 page, 73,702 bytes | 2026-09-04T12:12:00Z |
| One-pager upload/link: successful actual-form validation pass | Submission form file upload | Submit-time or preview-time validation message from the form itself | PASS: the form accepted the submission with the link in Additional Information; the link answers 200 anonymously | 2026-09-04T12:12:00Z |
| Video upload: MP4, under five minutes, under 300 MB | Submission form file upload | Download the uploaded file back; check duration and file size | PASS: downloaded back from the project page storage URL, byte-identical to `submission/glass-box-trading.mp4` (48,268,634 bytes, 299.03 s); plays on the project page (4:59) | 2026-09-04T12:12:00Z |
| Slide deck upload: PDF, at most 10 slides, readable without narration | Submission form file upload | Download the uploaded file back; open and count slides | PASS: downloaded back, byte-identical to `submission/glass-box-trading.pdf` (10 pages) | 2026-09-04T12:12:00Z |
| Cover image upload: PNG or JPG, exact 16:9, legible at thumbnail size | Submission form file upload | Download the uploaded file back; check dimensions and aspect ratio; view at thumbnail scale | PASS with conversion: the platform serves the cover as JPG 1920x1080 (146,373 bytes), exact 16:9, legible in the page header | 2026-09-04T12:12:00Z |
| Repository URL resolves, exact submitted revision, anonymous access | `submission/COPY.md` / form URL field | Open URL in clean browser with no auth; confirm commit SHA matches the intended submitted revision | PASS: `https://github.com/fradzano/glass-box-trading` on the project page; `main` at the form instant = merge `fe9953b` (submission-day docs merged from the branch), anonymous 200 | 2026-09-04T12:12:00Z |
| Demo URL resolves, no login, golden path completes | `submission/COPY.md` / form URL field | Open `https://glass-box-trading.vercel.app` in clean browser; walk the golden demo path end to end | PASS: `https://glass-box-trading.vercel.app` on the project page, anonymous 200, golden path walked in the video against the pinned route | 2026-09-04T12:12:00Z |
| Pinned presentation-cutoff route resolves independently of the advancing latest route | Dashboard | Open `revisions/sha256:7b82959a344a7c7e/presentation/` route directly, confirm it is not the "latest" route | PASS: pinned route meta `glass-box-evidence-cutoff-kind=presentation`, `glass-box-evidence-cutoff=2026-09-03T20:00:14.787Z`, `glass-box-journal-revision=sha256:7b82959a344a7c7e`, `glass-box-rendered-at=2026-09-03T20:01:19.753Z`; `/` carries the same revision/cutoff/rendered-at but `kind=latest` - distinct routes, the pinned one is not the latest route | 2026-09-04T08:26:35Z |
| Account ID on dashboard matches account ID in `submission/COPY.md` / form | Dashboard + form | Read both, compare literal string `PA376WIK2ATL` | PASS (shell, clean-browser equivalent): the pinned page carries the literal `PA376WIK2ATL` ("Submitted Alpaca paper account PA376WIK2ATL"); `video/public/dataset/meta.json` and `projection.json` hold the same `accountId`; `submission/COPY.md` now carries it in the long description and in its own "Alpaca paper-account ID" section (the required form field per `docs/HACKATHON-FACTS.md`); the form-side half is the owner step at form time | 2026-09-04T08:45:00Z |
| Journal revision on dashboard matches the revision cited in every uploaded artifact | Dashboard + one-pager + slides | Read revision string on each surface, compare against `sha256:7b82959a344a7c7e` | PASS: `sha256:7b82959a344a7c7e` on the pinned page (`glass-box-journal-revision`), 2x in `submission/render/out/ONE-PAGER.injected.md`, 3x in `submission/render/out/deck.injected.md`, 2x in `submission/COPY.md` (plus the safe spelling `sha256-7b82959a344a7c7e` in the route URL), and equal to `journalRevision` in `video/public/dataset/projection.json`. No unresolved `{{TOKEN}}` in any of the three sources. The PDFs are deterministic renders of the injected sources via `submission/render/render.mjs`; pypdf text extraction confirms the revision string in both PDFs directly | 2026-09-04T08:37:00Z |
| Cross-artifact number equality at equal cutoffs (P&L, equity, sleeve attribution) | One-pager, slides, dashboard pinned route | Pull the same field from each surface, confirm they cite the same cutoff before comparing values | PASS at one shared cutoff `2026-09-03T20:00:14.787Z`: P&L $583.59 / 0.58%, equity $100,583.59, realized $586.00, unrealized $0.00, unattributed -$2.41, income $230.00, convex $356.00 all present and identical in `ONE-PAGER.injected.md`, `deck.injected.md`, the pinned host page (curl, tags stripped and entities decoded) and — via pypdf extraction — in both rendered PDFs. `submission/COPY.md` carries only the prose subset ($583.59, 0.58%, $100,000.00 start) plus the cutoff 2x; every figure it does carry matches, and it omits rather than contradicts Re-run 10:20Z after the review pass (texts changed): P&L $583.59 / 0.58%, equity $100,583.59, realized $586.00, unrealized $0.00, unattributed -$2.41, income $230.00, convex $356.00, max drawdown $33.15, peak reserved worst case $3,421.00, best-lifecycle share 61% present and equal in the injected one-pager and deck sources, COPY.md carries its prose subset, the pinned host page carries the same figures; no "one week", no "CLI/API", no unresolved token | 2026-09-04T10:20:00Z |
| Unlabeled or cross-cutoff number comparison is rejected, not reconciled | All numeric surfaces | Spot-check that no surface presents a number without a cutoff label | PASS (dashboard, spot check): the figures sit under the heading "Result at this cutoff", and the evidence banner immediately above states "renders only journal revision sha256:7b82959a344a7c7e at the presentation evidence cutoff 2026-09-03T20:00:14.787Z (76 entries folded, 0 rejected as newer than the cutoff)"; the literal cutoff string appears 9 times on the page. Note: the result section inherits the label from that banner instead of repeating the timestamp inline | 2026-09-04T08:27:10Z |
| Demo host: Deployment Protection is off, no login, no redirect on the stable alias | Vercel project settings + dashboard | Open `https://glass-box-trading.vercel.app` in a clean browser; `tools\probe-dashboard.ps1` reports no redirect and HTTP 200 on every route | PASS (anonymous `curl -sI`, no cookies - clean-browser equivalent): `/` returns `HTTP/1.1 200`, no `Location` header, no auth challenge, `Server: Vercel`; `/revisions/sha256-7b82959a344a7c7e/presentation/` returns 200. The probe reports no redirect on any route | 2026-09-04T08:26:09Z |
| Anonymous probe passes against the stable alias with the manifest of the deployed render (SUB-11 receipt) | Dashboard | `tools\probe-dashboard.ps1 -BaseUrl https://glass-box-trading.vercel.app -Manifest <out>\publish-manifest.json` exits 0; keep `probe-<utc>.json` with the evidence | PASS 29/29, exit 0. Receipt `probe-20260904T082629Z.json`, copied to `C:\Users\felix\verify-runs\fradzano\glass-box-trading\p7-dev-live-certificate\evidence` | 2026-09-04T08:26:29Z |
| R37 C-3: the history pin resolves from the nested immutable route, not only from the site root | Dashboard | Open `revisions/sha256-7b82959a344a7c7e/latest/` directly, click the pin under "History"; it must open the presentation route (root-absolute href, no `revisions/revisions/` in the address bar) | PASS: `/revisions/sha256-7b82959a344a7c7e/latest/` carries exactly one `revisions` href, `href="/revisions/sha256-7b82959a344a7c7e/presentation/"` - root-absolute, 0 occurrences of `revisions/revisions`; the probe resolves that pin to HTTP 200 from the nested route | 2026-09-04T08:26:29Z |
| R37 C-3: the served route name is the host-safe spelling, the renderer's percent-encoded spelling is not served | Dashboard | `revisions/sha256-7b82959a344a7c7e/presentation/` answers 200; `revisions/sha256%3A…/presentation/index.html` does not answer 200 (the deploy tree carries only the safe spelling) | PASS: `/revisions/sha256-7b82959a344a7c7e/presentation/` returns 200; `/revisions/sha256%3A7b82959a344a7c7e/presentation/index.html` returns 404 | 2026-09-04T08:26:09Z |
| Pinned presentation route is byte-stable across later publishes | Dashboard + `<out>\site` | After a later re-render, the pinned page's `glass-box-rendered-at` is unchanged while `index.html` advances | PASS: the host copy of the pinned `projection.json` is byte-identical to `<out>\site\revisions\sha256%3A7b82959a344a7c7e\presentation\projection.json` (`cmp`, no difference); pinned `glass-box-rendered-at=2026-09-03T20:01:19.753Z` on host and locally, unchanged since the 2026-09-03 publish | 2026-09-04T08:26:40Z |
| Kickoff-form delta check: added, changed, stricter, or contradictory requirements recorded | Actual submission form vs. `docs/SUBMISSION-SPEC.md` / `docs/HACKATHON-FACTS.md` | Diff the live form's fields/limits against this register; log any delta the same day | Step 1 of 3 read logged-in on 2026-09-04 11:55Z: long description is capped at 2000 characters (new; COPY.md cut to fit), Categories required from a predefined list (Finance, Investment), Event Tracks offers only "Options Alpha Agents", Technologies Used is a predefined list (Alpaca, Anthropic Claude, Claude Code, Vercel present), five optional social-link fields; recorded in `docs/HACKATHON-FACTS.md`; steps 2 and 3 pending the owner | 2026-09-04T11:55:00Z |

## Run log 2026-09-04

Host-side rows only, run from a non-interactive shell (no cookies, no session,
no credentials) between 08:26Z and 08:28Z. That is the clean-browser equivalent
for everything checkable over HTTP; the rows that need the lablab form, and the
PDF-side comparisons, stay with the owner.

Placeholders were resolved in place first:

```
node submission/render/inject.mjs submission/PREFLIGHT.md submission/PREFLIGHT.md
```

Commands:

```
curl -sI https://glass-box-trading.vercel.app/
curl -sI https://glass-box-trading.vercel.app/revisions/sha256-7b82959a344a7c7e/presentation/
curl -s -o /dev/null -w "%{http_code}" "https://glass-box-trading.vercel.app/revisions/sha256%3A7b82959a344a7c7e/presentation/index.html"
curl -s https://glass-box-trading.vercel.app/revisions/sha256-7b82959a344a7c7e/latest/
curl -s https://glass-box-trading.vercel.app/revisions/sha256-7b82959a344a7c7e/presentation/projection.json
powershell -NoProfile -File tools\probe-dashboard.ps1 -BaseUrl https://glass-box-trading.vercel.app -Manifest <scratch>\publish-manifest.json
curl -sI https://github.com/fradzano/glass-box-trading
curl -s https://api.github.com/repos/fradzano/glass-box-trading
git rev-parse HEAD ; git ls-remote origin p7/dev-live-certificate main
```

`tools\probe-dashboard.ps1` has no output-directory parameter — it writes its
receipt beside the manifest it is given. To leave the deployment tree under
`C:\Users\felix\gbt-publish` untouched, the manifest was copied to a scratch
directory and the probe pointed at the copy; the manifest is read as data only
(route list and expected meta), so the probed target is unchanged.

Receipt: `probe-20260904T082629Z.json`, 29/29 PASS, exit 0. Written to the
scratch directory and copied to

```
C:\Users\felix\verify-runs\fradzano\glass-box-trading\p7-dev-live-certificate\evidence\probe-20260904T082629Z.json
```

next to the previous day's `probe-20260903T200341Z.json`.

Open items for the owner: every submission-form and upload row (form-side
half), the video upload row once the render lands, and the default-branch
decision recorded in the repository-URL row.

### Addendum 2026-09-04 08:37Z — rendered artifacts

The one-pager PDF, deck PDF and cover PNG were checked locally after the
coordinator reported them rendered. PDF page counts and text come from `pypdf`
6.13.2 (object-stream aware), PNG dimensions from the IHDR chunk; text
extraction worked, so the PDFs were compared directly rather than only through
their injected sources. Cross-artifact figures and the journal revision were
compared across `submission/render/out/ONE-PAGER.injected.md`,
`submission/render/out/deck.injected.md`, `submission/COPY.md`, both PDFs and
the pinned host page, all carrying the same cutoff label
`2026-09-03T20:00:14.787Z`.

One negative finding at 08:37Z, closed at 08:45Z: `submission/COPY.md` carried
no `PA376WIK2ATL` literal; the form has a dedicated paper-account-ID field
(`docs/HACKATHON-FACTS.md`), so COPY.md gained that section and the long
description names the account.

### Submitted 2026-09-04 ~14:05 CEST

Project page: <https://lablab.ai/ai-hackathons/alpaca-ai-trading-agents-hackathon/glass-box-trading/glass-box-trading> (anonymous fetch archived in the verification store as `lablab-project-page-2026-09-04T1210Z.html`). The Additional Information text is not visible in the public page markup; it was submitted through the form and is recorded in `submission/COPY.md`.
