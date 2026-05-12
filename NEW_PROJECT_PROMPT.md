# How to spawn a new quiz funnel project

## In a NEW empty folder, start a fresh Claude Code session and paste THIS as your first message:

---

I want to build a quiz-based lead-gen funnel for **[PRODUCT TYPE]** targeting **[DEMOGRAPHIC]**.

Use the architecture, file structure, code patterns, and integrations described in [BLUEPRINT.md](https://github.com/leadsdon/trucker-benefit/blob/main/BLUEPRINT.md) (raw: https://raw.githubusercontent.com/leadsdon/trucker-benefit/main/BLUEPRINT.md).

Reference implementation: https://github.com/leadsdon/trucker-benefit (truckerbenefit.com — IUL funnel for CDL truckers, fully working in production).

## Before writing any code, run the discovery process from BLUEPRINT.md STEP 1 — ask me:

1. Brand name, domain, color palette, tagline
2. Product details (type, value prop, coverage range, key benefit)
3. Audience demographic + 3-5 pain points specific to them
4. Mandatory PII fields + the 12-14 quiz questions following the framework in STEP 3
5. Compliance considerations for this audience
6. Buyer / CRM destination + call number

## Once I answer, build the entire system from scratch:

- `index.html` — landing + quiz with auto-advance, phase indicator, biased progress bar, phone confirm step
- `thank-you.html` — loading flourish, product match reveal, big call CTA, share section
- `privacy.html` + `terms.html` — TCPA-compliant boilerplate (mark for attorney review)
- `favicon.svg` — brand monogram
- `vercel.json` — security headers
- `api/lead.js` — fan-out proxy (Supabase + Apps Script + outbound webhook + CAPI). Includes hard-blocked sources, phone-required gate, lead-quality filter, server-side CAPI fire with dedup event_id.
- `api/admin.js` — token-gated admin dashboard data endpoint
- `api/capi.js` — Meta CAPI endpoint for browser-driven Contact event
- `lib/capi.js` — shared Meta CAPI helper (SHA-256 hashes all PII)
- `lib/lead-quality.js` — phone + email junk filter
- `backend/apps-script-backend.gs` — Google Apps Script for master + client sheets + Ringy push, with `testAuth()` and `cleanupTestRows()` helpers
- `backend/supabase-schema.sql` — Postgres tables
- `backend/SUPABASE.md` + `backend/BACKEND.md` — setup walkthroughs
- `SETUP.md` — operator go-live checklist (Vercel, Supabase, Meta, etc.)
- `BLUEPRINT.md` + `NEW_PROJECT_PROMPT.md` — copy these in so this project can also be replicated

## Critical guarantees the system MUST have (do not skip):

- **Phone required** at quiz validation + page beforeunload + server-side `/api/lead`. No phone = lead dropped entirely.
- **Lead quality filter** — fake phones (555 area, all same digit) and fake emails (test@example.com, mailinator domains) blocked from firing CAPI.
- **Hard-blocked sources** list at `/api/lead` (`smoketest`, `debug`, `internal_test`, etc.) — these drop on the floor, no writes anywhere.
- **CAPI fires ONLY for valid, complete, real leads.** Never for test/internal/junk. Same event_id on browser pixel + server CAPI = Meta dedup.
- **Direct-visit gate on /thank-you.html** — pixel only fires if sessionStorage has a pending lead. Otherwise redirect home.
- **Outbound webhooks fire ONLY for leads with usable phone.** Buyers never see worthless records.
- **Funnel in admin dashboard counts UNIQUE VISITORS per question**, not raw events. Refreshes / back-nav inflate event counts dramatically.
- **TrustedForm script + TCPA consent text + timestamp** on every phone-confirmation step.
- **noindex on /thank-you.html.**
- **Outbound webhook payload flat at top-level** (not nested under `userData`) — GHL and most CRMs require `email`/`phone` as top-level fields. Include both `firstName` and `first_name` casings.
- **Webhook payload includes computed `bio` paragraph + `bio_short` one-liner + structured `notes` block.**
- **Admin dashboard hidden behind passcode + URL hash** (`/#admin`).
- **Auto-advance on multiple-choice tap** (250ms delay), Enter key submits text inputs.
- **Phone confirmation step** — show typed number back, "Yes that's right" / "Edit".

## After build, output:

1. Full file tree
2. The SETUP.md filled in for this specific project (env vars to set, accounts to create)
3. A list of decisions you made (so I can review)
4. A list of decisions you deferred to me (e.g. final color hex codes, exact fear-story copy)
5. A prompt I should paste into the operator's next session to launch

Don't ask me to confirm before discovery — start with the discovery questions immediately.

---

## After Claude builds, do these operator tasks in order:

1. Push to a new GitHub repo
2. Connect Vercel to that repo (auto-deploy on push)
3. Buy + point the domain
4. Create Supabase project + run the schema SQL
5. Create master Google Sheet + paste Apps Script code + deploy
6. Create separate client sheet shared with buyer as Editor
7. Set all Vercel env vars
8. Create Meta Pixel + Conversions API token + Custom Conversion
9. Set up GHL / CRM webhook trigger, set as `OUTBOUND_LEAD_WEBHOOKS`
10. Have attorney review `privacy.html` + `terms.html`
11. Change admin passcode
12. Test end-to-end in incognito
13. Launch ads at $50/day → ramp to $300/day over 5-7 days
