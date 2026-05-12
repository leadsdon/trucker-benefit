# Quiz Funnel Blueprint

A complete spec for spawning a new quiz-lead-gen funnel for ANY product/demographic
combo. Paste this entire file into a fresh Claude Code session as the first
message — Claude will run the discovery process, then build the system.

---

## How to use this

1. Start a new Claude Code project in an empty folder.
2. Paste this entire file as the first message.
3. Answer the discovery questions Claude asks.
4. Claude builds everything; you complete the operator setup (Vercel, Supabase, etc.).

The reference implementation is **trucker-benefit** (truckerbenefit.com) — an IUL
funnel for CDL truckers. Architecture and patterns are identical across niches;
only the brand, copy, and quiz questions change.

---

## STEP 1 — Discovery (Claude asks the operator these BEFORE writing any code)

Ask these in one structured message. Wait for answers before building.

### A. Brand
1. **Brand name** (e.g. "Trucker Benefit", "Nurse Secure", "Vet Vault")
2. **Domain** (e.g. `truckerbenefit.com`) — registered? where?
3. **Tagline / one-liner** (one sentence the visitor sees first)
4. **Color palette** — pick a primary + accent (we use orange `#FF6B35` + gold `#FFB800` over dark navy `#1A1A2E`). Suggest 2-3 alternatives based on demographic if they don't have preferences.

### B. Product
5. **Product type** (e.g. IUL, term life, mortgage protection, supplemental health, final expense)
6. **Headline value prop** — what problem does it solve in one line
7. **Coverage range** (e.g. `$100K-$500K`, `$25K-$250K`)
8. **Borrow-against / cash value / other key benefit** to highlight

### C. Audience
9. **Demographic** (e.g. nurses, teachers, veterans, real estate agents, small business owners, retirees)
10. **Age range** (typical, for DOB defaults)
11. **Pain points specific to the audience** — list 3-5. These power the "fear" and "looking for" quiz questions.
12. **Compliance considerations** — is the audience subject to special regulations (e.g. medical professionals = HIPAA-adjacent, military = SCRA)?

### D. Quiz Data Points (MANDATORY)
13. **PII fields needed**: first name, last name, DOB, email, phone, state — minimum. Anything else (license #, employer, household income, retirement target)?
14. **Qualifying questions** — what disqualifies a lead? (e.g. "Are you actually a nurse?" filters non-targets)
15. **Quality-signal questions** — what indicates a HIGH-value lead vs low? (saves consistently, high budget, urgent need, etc.)
16. **Underwriting question** — health, occupation hazard, etc.
17. **Budget question** — what monthly amount can they afford
18. **Call preference** — phone vs video
19. **Final field** — state (for licensed-agent routing)

Claude proposes ~12-14 questions following the [QUIZ FRAMEWORK](#quiz-framework)
below; operator approves or edits.

### E. Operator handoff
20. **Buyer / CRM destination** — where do completed leads go? (Ringy, GoHighLevel, custom webhook, multiple)
21. **Call number** to display on results page (real number, with country code)
22. **Brand voice** — formal? blue-collar? professional? caring?

---

## STEP 2 — Architecture

```
┌────────────────────────────────────┐
│  Landing page (static HTML on      │
│  Vercel + custom domain)           │
│                                    │
│  • Hero + offer + intro card       │
│  • Embedded quiz card              │
│  • Fear-testimonials section       │
│  • Sticky bottom CTA               │
│  • Privacy + Terms + Footer        │
└────────────┬───────────────────────┘
             │
             │ on submission
             ▼
┌────────────────────────────────────┐
│  /api/lead (Vercel Serverless)     │
│  Same-domain proxy. Fan-out to:    │
└──┬──────┬───────┬───────┬──────────┘
   │      │       │       │
   ▼      ▼       ▼       ▼
┌──────┐ ┌────┐ ┌─────┐ ┌──────┐
│Supa- │ │Apps│ │GHL/ │ │Meta  │
│base  │ │Scr.│ │CRM  │ │CAPI  │
│(DB)  │ │→   │ │WHK  │ │      │
│      │ │Shts│ │     │ │      │
│      │ │+Rin│ │     │ │      │
└──┬───┘ └────┘ └─────┘ └──────┘
   │
   │ (admin reads)
   ▼
┌────────────────────────────────────┐
│  /api/admin → admin dashboard      │
│  at /#admin (hidden, passcode)     │
└────────────────────────────────────┘

After submission, page redirects to /thank-you.html
   • Browser pixel fires Lead (same event_id as CAPI)
   • IUL match reveal with key benefits
   • Call Now button (tel: link, big green pulsing)
   • Share-with-friend section
   • Stays on this URL — easier conversion tracking
```

### Tech stack
- **Frontend:** single static `index.html` + `thank-you.html` + `privacy.html` + `terms.html` + `favicon.svg`. No React, no build step, no framework. Vanilla JS.
- **Hosting:** Vercel (free tier, drag-and-drop deploy + GitHub auto-deploy)
- **Database:** Supabase Postgres (free tier)
- **Spreadsheet integration:** Google Apps Script web app (free)
- **CRM push:** Configurable webhook URL (Zapier, Make, GHL, Ringy, custom)
- **Meta tracking:** Pixel (browser) + Conversions API (server-side via /api/capi using lib/capi.js)
- **Heatmaps (optional):** Microsoft Clarity
- **Consent capture:** TrustedForm (free script, paid cert retrieval)

### Folder structure to create
```
project-root/
├── index.html              ← landing + quiz
├── thank-you.html          ← results page (conversion URL)
├── privacy.html            ← TCPA-compliant policy
├── terms.html              ← liability / regulatory disclosures
├── favicon.svg             ← brand mark (TB-style monogram or simple icon)
├── vercel.json             ← security headers + clean URLs
├── SETUP.md                ← go-live checklist for operator
├── BLUEPRINT.md            ← (this file — for replication)
├── .gitignore
├── api/
│   ├── lead.js             ← proxy: fans out to all destinations
│   ├── admin.js            ← reads Supabase, returns JSON
│   └── capi.js             ← Meta CAPI endpoint (for Contact event on click)
├── lib/
│   ├── capi.js             ← shared Meta CAPI fire helper
│   └── lead-quality.js     ← phone + email junk filter
└── backend/
    ├── apps-script-backend.gs  ← Google Apps Script (master + client sheets + Ringy push)
    ├── supabase-schema.sql     ← Postgres tables (events, leads)
    ├── SUPABASE.md             ← 10-min setup walkthrough
    ├── BACKEND.md              ← Apps Script + client sheet + Ringy setup
    └── cleanup-test-rows.sql   ← run after dev testing
```

---

## STEP 3 — Quiz Framework

The quiz is the conversion engine. Structure matters. ~12-14 questions total.

### Phase 1 — Qualifier (Q1)
**Purpose:** filter non-target audience with a single-tap question.
**Always Q1.** Lowest possible friction.
**Example for truckers:** "First — are you a truck driver?" with 4 options (OTR / Local / Owner-op / Planning).
**Example for nurses:** "First — are you a nurse?" (RN / LPN / Nursing Student / Just looking).

### Phase 2 — Vision/Reality (1-2 questions)
**Purpose:** emotional engagement + buying-capacity signal.
- ONE question that segments by financial state ("How do you handle your finances?") with options ranging from "paycheck-to-paycheck" → "save consistently with money set aside." This becomes the high-quality lead signal.

### Phase 3 — Fear / Pain (1-2 questions)
**Purpose:** anchor the agent's sales pitch.
- "My biggest [demographic-relevant] fear is..." with 4 options
- Optionally: "What I'm really looking for is..." (sets up the product positioning)

### Phase 4 — Underwriting (1 question)
**Purpose:** flag for the buyer / insurance carrier.
- "Have you been diagnosed with [conditions relevant to the product] in the last 5 years?" Yes / No.

### Phase 5 — PII (5-7 questions)
**Order matters.** Ask in this exact sequence to maximize completion:
1. **First name** (lowest friction text field)
2. **Last name** (second name field — they're committed)
3. **Date of birth** (auto-format MM/DD/YYYY, validate age 18-90)
4. **Email** (validate format, junk filter)
5. **Call preference** (phone vs video — PREFACE to phone Q, prepares them mentally)
6. **Phone** (formatted (xxx) xxx-xxxx, REQUIRED, with explicit confirmation step)
7. **Monthly budget** (5 options spanning the realistic range, e.g. `<$200 / $200-400 / $400-600 / $600-800 / $800+`)
8. **State** (dropdown OR text with autocomplete of all 50)

### Question count
Target: 12-14 total. Each extra question = ~5% drop-off. Cut anything that doesn't directly improve buyer quality or unlock a sales angle.

### Behavior requirements
- **Auto-advance** on multiple-choice click (250ms delay for visual feedback)
- **Continue button** on text inputs (Enter key also submits)
- **Phone confirmation screen** — show typed number, "Yes that's right" / "Edit" — reduces miskeyed numbers
- **Phone is HARD required** — page validation + server gate. No phone, no lead.
- **TCPA consent text** on the phone confirmation step (legal requirement)
- **Progress bar** — biased forward (sqrt curve, not linear) so it feels closer to done
- **Phase indicator** — "STEP 1 OF 5" rather than "Question 4 of 14"
- **Loading screen** after final question — 2-3 sec animation while pixels fire, before redirect

---

## STEP 4 — Landing Page Sections (in order)

1. **Hero** with pre-headline + H1 + sub-headline + quiz embed
2. **Intro card** (yellow accent): "Answer X quick questions and we'll reveal your personalized plan"
3. **Borrow-against / cash-value callout** (gold-bordered) — highlights the #1 product feature
4. **Quiz card** (embedded white card with progress bar + phase indicator + questions)
5. **(After submit: redirect to /thank-you.html)**
6. **Fear-testimonials section** — 4 cautionary stories with names/details, then 4 stats, then a red CTA "Don't gamble with your family's future"
7. **Footer** — Privacy / Terms / Cookie Settings / Contact + compliance disclosures
8. **Sticky bottom CTA bar** — orange "START THE QUIZ →" button always visible
9. **Cookie consent banner** — Accept/Decline (gates pixels)

### Thank-you page sections
1. **Loading flourish** (2.5s) — "Locking in your plan, [NAME]…" with 3 step checkmarks animating in
2. **IUL/Product match reveal** — badge + headline + 4-5 benefit cards
3. **Big green pulsing CALL NOW button** with `tel:` link
4. **Urgency line** — "⚡ ACT NOW — RATES LOCK AT TODAY'S AGE"
5. **Trust list** — Free consult, Licensed agents standing by, Quote in 15 min
6. **Share section** — blue dashed box, "Help a fellow [nurse/trucker/etc.] friend" with native share API

---

## STEP 5 — Required Integrations + Env Vars

Operator must set these in Vercel → Project → Settings → Environment Variables:

| Env var | What it is | Required for | Optional? |
|---|---|---|---|
| `APPS_SCRIPT_URL` | Google Apps Script Web App URL (ends in `/exec`) | Sheets + Ringy push | yes (skip if not using sheets/Ringy) |
| `SUPABASE_URL` | `https://xxx.supabase.co` | Database + admin dashboard | yes (skip = localStorage only) |
| `SUPABASE_SERVICE_KEY` | Service role JWT | DB writes | with above |
| `ADMIN_TOKEN` | Long random string | Admin dashboard read gate | with above |
| `META_PIXEL_ID` | From Meta Events Manager | Browser Pixel | yes for Meta ads |
| `META_ACCESS_TOKEN` | Conversions API token | Server-side CAPI | with Pixel ID |
| `META_TEST_EVENT_CODE` | From Meta Test Events tab | Dev/testing only — REMOVE for prod | optional |
| `OUTBOUND_LEAD_WEBHOOKS` | Comma-separated webhook URLs (GHL, Zapier, etc.) | CRM delivery | yes for CRM |

### Page-level config (in `<head>` of index.html as `window.TB_CONFIG`):
- `META_PIXEL_ID` — duplicate of env var (browser-side needs it too)
- `GA4_MEASUREMENT_ID` — `G-XXXXXXXXXX`
- `GOOGLE_ADS_ID` + labels
- `CLARITY_PROJECT_ID` — for heatmaps
- `LEAD_WEBHOOK_URL` — set to `/api/lead`
- `ADMIN_READ_URL` — set to `/api/admin`
- `ADMIN_REMOTE_TOKEN` — matches `ADMIN_TOKEN` env var
- `CALL_NOW_NUMBER` + `CALL_NOW_TEL` — real phone

### Hardened guarantees the system MUST have
- **Phone-required gate** at 3 layers: quiz validation, page beforeunload, server `/api/lead`
- **Lead-quality filter** (`lib/lead-quality.js`) — block obvious fake phones (555 area, all same digit) + fake emails (test@example.com, mailinator, etc.) from firing CAPI
- **Hard-blocked sources** list at `/api/lead` for `smoketest`, `internal_test`, `debug`, etc. — these never write anywhere
- **CAPI fires ONLY for real, valid, completed leads** — never for test/internal/junk
- **Outbound webhooks ONLY for leads with phone** — buyers never receive worthless records
- **TrustedForm script + TCPA consent text + timestamp** captured on every lead
- **Privacy + Terms pages** generated and linked
- **noindex on /thank-you.html** — keeps conversion URL out of search

---

## STEP 6 — Pixel + CAPI Strategy

For accurate ROAS reporting and lowest CPL:

1. **Browser Pixel** fires `Lead` event on `/thank-you.html` load (only if `tb_pending_lead` in sessionStorage — prevents direct-visit inflation)
2. **Server-side CAPI** fires the same `Lead` event from `/api/lead` with the SAME `event_id` (Meta dedupes)
3. **Hashed PII** sent server-side: email, phone, first name, last name, DOB, zip/state, country, fbp, fbc, external_id, IP, user-agent → Match Quality 8-9/10
4. **Conversion values** populated from quiz answers (use monthly_budget × 12 × estimated_LTV_multiplier as lead value)
5. **AEM Priority** in Events Manager: `Contact` (phone call) = 1, `Lead` = 2, `InitiateCheckout` = 3

### Code references
- Browser: `index.html` head — `<!-- Meta Pixel Code -->` block
- Server fire: `api/lead.js` `fireServerCapiForLead()` + `lib/capi.js`
- Quality gate: `lib/lead-quality.js` `assessLeadQuality()`
- Stable event_ids: generated in `index.html` `showResults()`, passed via sessionStorage + payload

---

## STEP 7 — Admin Dashboard

Hidden behind passcode at `/#admin`. Reads from Supabase via `/api/admin`.

### Sections
- **Cohort filter bar** — Today / 7d / 30d / All-time + source filter + device filter
- **Stat cards** (10 of them): Unique Visitors, Page Views, Quiz Starts (+CR%), Quiz Completes (+CR%), Call Clicks (+CR%), Overall Visitor→Call, Complete Leads, Share Clicks, Median Active Time, Median Max Scroll
- **Funnel by question** — visual horizontal bars showing reach % per question, drop-off coloring, median dwell time. **Counts UNIQUE VISITORS, not events.**
- **Funnel summary** at top — Started → Completed → Completion Rate big numbers + "biggest leaks" callouts
- **Leads by Source** breakdown — pulled from leads table, captures even backfilled records
- **Attribution by Source** — visitors/starts/completes/calls per source from event stream
- **Leads table** — click row to expand into full detail (attribution, engagement, all answers)
- **CSV export** + Events JSON export
- **Auto-refresh every 15s** + manual refresh button
- **Live indicator** + data source label (Supabase live / localStorage fallback)

### Important — funnel must use unique visitors
Counting raw events inflates because page refreshes / back-nav fire the same event multiple times for one visitor. Use `Set<visitor>` per question, then `.size`.

---

## STEP 8 — Webhook Payload Shape (what GHL / CRM receives)

Single flat JSON object with everything an agent could want. See `api/lead.js` `buildWebhookPayload()` for exact shape. Key fields:

| Category | Fields |
|---|---|
| **Differentiation** (CRM needs ≥1) | `email`, `phone`, `phone_digits`, `phone_e164` |
| **Contact** (both casings) | `firstName` + `first_name`, `lastName` + `last_name`, `name`, `dateOfBirth` + `date_of_birth`, `age`, `state`, `country` |
| **Quiz answers** (flat, no q-prefix) | `trucker_status`, `monthly_finances`, `biggest_fear`, `looking_for`, `health_conditions`, `call_preference`, `monthly_budget` |
| **Quality signals** ⭐ | `lead_score` (0-100), `lead_grade` (A/B/C/D), `budget_tier`, `is_healthy`, `is_otr`, `saves_consistently` |
| **Narrative** ⭐ | `bio` (paragraph), `bio_short` (one-liner), `notes` (multi-line summary) |
| **Engagement** | `time_on_page_seconds`, `active_seconds`, `scroll_pct`, `device` |
| **Attribution** | `source`, `utm_*`, `fbclid`, `gclid`, `referrer`, `landing_path` |
| **Compliance** | `tcpa_consent_accepted`, `tcpa_consent_timestamp`, `tcpa_consent_text`, `trustedform_cert_url` |
| **Server context** | `ip`, `user_agent`, `received_at`, `visitor_id`, `session_id` |

### Adapt for niche
- `trucker_status` → `nurse_type` / `teacher_grade` / `vet_branch` etc.
- `monthly_finances`, `biggest_fear`, `looking_for`, `health_conditions`, `call_preference`, `monthly_budget` keep the same SLUG, just different question text/options.
- Bio narrative pattern: adapts automatically because it pulls from the same slugs.

---

## STEP 9 — Brand Customization Quick Reference

Replace these things per niche:

| What | Where | Trucker example | Nurse example |
|---|---|---|---|
| Brand name | All HTML pages, footer | "Trucker Benefit" | "Nurse Secure" |
| Domain | `vercel.json`, all share/canonical refs | truckerbenefit.com | nursesecure.com |
| Primary color | CSS `:root --primary` | `#FF6B35` (orange) | `#3B82F6` (medical blue) |
| Accent color | CSS `--accent` | `#FFB800` (gold) | `#10B981` (green) |
| Hero pre-head | `index.html` | "ATTENTION TRUCK DRIVERS:" | "FOR REGISTERED NURSES:" |
| Hero H1 | `index.html` | "The Hidden Financial Crisis Destroying Trucker Families..." | "How Nurses Are Quietly Building $250K+ in Tax-Free Wealth..." |
| Fear stories | `index.html` fear section | "Diane K., widow of OTR driver" | "Sarah M., ICU nurse, 3 months unable to work after needlestick" |
| Q1 qualifier | `index.html` questions array | "Are you a truck driver?" | "Are you a registered nurse?" |
| Notes / bio templates | `api/lead.js` `buildBio()` | "long-haul OTR truck driver from TX" | "ER nurse from CA with 8 years experience" |
| Favicon monogram | `favicon.svg` | "TB" | "NS" |

---

## STEP 10 — Operator Go-Live Checklist (give them this as `SETUP.md`)

1. Buy domain (if not done)
2. Sign up Vercel — drag-and-drop folder OR connect GitHub repo → deploy
3. Sign up Supabase — create project, run `backend/supabase-schema.sql`, copy URL + service_role key
4. Create master Google Sheet → Apps Script → paste `backend/apps-script-backend.gs` → set constants → deploy as Web App → copy URL
5. Create separate client sheet → share with buyer as Editor → copy sheet ID → paste into Apps Script
6. Set Vercel env vars (see STEP 5 above)
7. Sign up Microsoft Clarity → paste project ID into TB_CONFIG (optional, free heatmaps)
8. Meta Business → Events Manager → create Pixel → get Pixel ID + Conversions API token → paste into TB_CONFIG + env vars
9. Create Custom Conversion in Meta: Event = `Lead`, URL contains `/thank-you.html`
10. Verify domain in Meta (DNS or meta-tag method)
11. Configure AEM Priority in Meta — Contact = 1, Lead = 2
12. GoHighLevel / CRM: create webhook trigger, copy URL, set as `OUTBOUND_LEAD_WEBHOOKS` env var in Vercel
13. Set up Ringy custom fields if using Ringy (monthly_budget, health_conditions, call_preference, etc.)
14. Have attorney review `privacy.html` + `terms.html` before paid traffic
15. Change default admin passcode in `index.html` and `ADMIN_TOKEN` env var
16. Test end-to-end: incognito → complete quiz → verify in Supabase + sheets + GHL + Meta Test Events
17. Launch ads on $50/day → ramp to $300/day over 5-7 days as data accumulates

---

## STEP 11 — Lessons Learned from Trucker Benefit (apply to all niches)

1. **Phone is the only contact channel that matters.** Make it required at 3 layers. No phone = no lead.
2. **Test sources must be hard-blocked.** A runaway test loop fired 1000 fake "leads" into GHL once. Add `smoketest`, `debug`, `internal_test` to a server-side block list.
3. **CAPI dedup needs same event_id on both sides.** Generate event_id once in showResults(), pass via sessionStorage to thank-you.html browser pixel AND via payload to /api/lead for server-side fire.
4. **Direct visits to /thank-you.html inflate CAPI.** Gate pixel firing behind sessionStorage check — if no pending lead, no pixel.
5. **The funnel must count unique visitors per question, not raw events.** Refresh / back-nav inflates event counts dramatically.
6. **Auto-advance on tap is mandatory.** Every "Next" button click is a friction point.
7. **Phone confirmation step is non-negotiable.** Show what they typed back, "Yes that's right" — catches miskeys before they go downstream.
8. **Lead bio + quality score gives agents context** — they call best leads first, close higher rate.
9. **TCPA copy on the phone confirmation step is legal protection.** Use the explicit prior-express-written-consent language.
10. **Quiz question count = drop-off curve.** Cut anything that doesn't directly drive buyer quality or sales angle.

---

## END OF BLUEPRINT

When Claude finishes building, it should output:
1. The full file tree
2. The operator's SETUP.md (filled in)
3. A list of decisions made (so the operator can review)
4. A list of decisions DEFERRED to operator (e.g. final color palette, exact fear-story copy)

For follow-up Claude sessions on the same project: reference the existing files,
don't recreate them. Use `git diff` to track changes between sessions.
