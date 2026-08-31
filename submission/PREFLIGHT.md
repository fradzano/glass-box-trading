# Submission preflight — SUB-09

This checklist is run from a clean browser (no session, no login, no
extensions that could mask a failure) against the actual submission form and
the frozen presentation-cutoff dataset (the pinned presentation route's
`revisions/{{JOURNAL_REVISION}}/presentation/projection.json`, produced by the
dashboard publish pipeline at {{PRESENTATION_CUTOFF_AT}}). Every cross-artifact
number comparison below is only valid between artifacts labelled with the
*same* cutoff; an unlabeled or cross-cutoff comparison is rejected outright,
never averaged or rounded into agreement. Results are left blank here and
filled in at run time — draft Sep 3, a cutoff-identical run by Sep 3 23:45,
and a rerun before Sep 4 12:00 per `docs/SUBMISSION-SPEC.md` §4/§6.

| Check | Surface | How verified (clean browser, no login) | Result | Timestamp |
|---|---|---|---|---|
| Title field ≤50 chars, matches `submission/COPY.md` exactly | Submission form | Open form, read rendered title field, diff against COPY.md | | |
| Short description ≤255 chars, matches `submission/COPY.md` exactly | Submission form | Open form, read rendered field, diff against COPY.md | | |
| Long description ≥100 words, matches `submission/COPY.md` exactly | Submission form | Open form, read rendered field, word-count and diff against COPY.md | | |
| Tag list matches `submission/COPY.md`, respects the form's delimiter/max-count/allowed-character rules | Submission form | Open form, read rendered tags, diff against COPY.md | | |
| One-pager upload: exact MIME type, byte size, renders as exactly one page | Submission form file upload | Download the uploaded file back from the form; open in a plain PDF viewer; verify page count = 1 | | |
| One-pager upload/link: successful actual-form validation pass | Submission form file upload | Submit-time or preview-time validation message from the form itself | | |
| Video upload: MP4, under five minutes, under 300 MB | Submission form file upload | Download the uploaded file back; check duration and file size | | |
| Slide deck upload: PDF, at most 10 slides, readable without narration | Submission form file upload | Download the uploaded file back; open and count slides | | |
| Cover image upload: PNG or JPG, exact 16:9, legible at thumbnail size | Submission form file upload | Download the uploaded file back; check dimensions and aspect ratio; view at thumbnail scale | | |
| Repository URL resolves, exact submitted revision, anonymous access | `submission/COPY.md` / form URL field | Open URL in clean browser with no auth; confirm commit SHA matches the intended submitted revision | | |
| Demo URL resolves, no login, golden path completes | `submission/COPY.md` / form URL field | Open `{{DEMO_URL}}` in clean browser; walk the golden demo path end to end | | |
| Pinned presentation-cutoff route resolves independently of the advancing latest route | Dashboard | Open `revisions/{{JOURNAL_REVISION}}/presentation/` route directly, confirm it is not the "latest" route | | |
| Account ID on dashboard matches account ID in `submission/COPY.md` / form | Dashboard + form | Read both, compare literal string `{{ACCOUNT_ID}}` | | |
| Journal revision on dashboard matches the revision cited in every uploaded artifact | Dashboard + one-pager + slides | Read revision string on each surface, compare against `{{JOURNAL_REVISION}}` | | |
| Cross-artifact number equality at equal cutoffs (P&L, equity, sleeve attribution) | One-pager, slides, dashboard pinned route | Pull the same field from each surface, confirm they cite the same cutoff before comparing values | | |
| Unlabeled or cross-cutoff number comparison is rejected, not reconciled | All numeric surfaces | Spot-check that no surface presents a number without a cutoff label | | |
| Kickoff-form delta check: added, changed, stricter, or contradictory requirements recorded | Actual submission form vs. `docs/SUBMISSION-SPEC.md` / `docs/HACKATHON-FACTS.md` | Diff the live form's fields/limits against this register; log any delta the same day | | |
