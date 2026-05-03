# Trucker Benefit — Go-Live Checklist

Everything in code is ready. This file is the list of accounts/IDs **you** need to set up
to make the page functional. Replace the placeholders in `index.html`.

---

## 1. Hosting (5 min, free)

**Recommended: Vercel.**

1. Sign up at [vercel.com](https://vercel.com) (use GitHub / Google).
2. Click "Add New → Project → Deploy without Git → Drag & drop".
3. Drag the entire `Trucker Benefit` folder onto the upload area.
4. Click Deploy. You'll get a URL like `trucker-benefit.vercel.app`.
5. **Custom domain:** Project → Settings → Domains → Add `truckerbenefit.com`. Vercel
   gives you DNS records — paste them into your domain registrar (Namecheap/GoDaddy/etc.).

(Alternative: Netlify, Cloudflare Pages — same workflow.)

---

## 2. Real call number (1 min)

In `index.html`, find the lines:

```js
const CALL_NOW_NUMBER = "(555) 123-4567";
const CALL_NOW_TEL = "+15551234567";
```

Replace with your actual number. The `_TEL` version is what the `tel:` link uses — must
include country code and digits only (no spaces or punctuation).

---

## 3. Lead destination (10 min, free)

The page already POSTs every lead and event as JSON. Right now it goes to localStorage only.
Pick **one** of these to receive them:

### Option A — Zapier → Google Sheets (easiest)
1. zapier.com → Create Zap.
2. Trigger: **Webhooks by Zapier → Catch Hook**. Copy the webhook URL Zapier gives you.
3. Action: **Google Sheets → Create Spreadsheet Row**. Map fields:
   - `userData.firstName`, `userData.email`, `userData.phone`, `source`,
     `first_touch.utm_campaign`, `tcpa_consent.ts`, `trustedform_cert_url`, etc.
4. Add a second action: **SMS by Zapier** or **Gmail** to notify yourself.
5. In `index.html`, replace `LEAD_WEBHOOK_URL = ""` with the URL from step 2.

### Option B — Make.com (more events on free tier)
Same idea, slightly more powerful UI. make.com → Create Scenario → Webhook → Google Sheets.

### Option C — Supabase (real database, queryable)
1. supabase.com → New project (free tier).
2. Create a table `leads` with appropriate columns.
3. Create an Edge Function that accepts POSTs and inserts into the table.
4. Use the Edge Function URL as `LEAD_WEBHOOK_URL`.

---

## 4. Tracking & ads (10 min)

In `index.html`, find the `window.TB_CONFIG` object near the top of the `<head>`. Replace each placeholder with your real ID:

| Field | Where to get it | Required? |
|-------|-----------------|-----------|
| `CLARITY_PROJECT_ID` | clarity.microsoft.com → Project → Settings | Recommended (free, gives heatmaps) |
| `META_PIXEL_ID` | business.facebook.com → Events Manager → Pixel | If running Facebook/Instagram ads |
| `GA4_MEASUREMENT_ID` | analytics.google.com → Admin → Data Streams (starts with `G-`) | Recommended |
| `GOOGLE_ADS_ID` | ads.google.com → Tools → Conversions (starts with `AW-`) | If running Google Ads |
| `GOOGLE_ADS_LEAD_LABEL` | Google Ads → Conversions → New "Lead" conversion → Tag setup | If using Google Ads |
| `GOOGLE_ADS_CALL_LABEL` | Google Ads → Conversions → New "Phone Call" conversion | If using Google Ads |

Each tag is auto-disabled until configured, so leaving placeholders in dev is safe.

---

## 5. TCPA / compliance (CRITICAL before paid traffic)

**Already in code:**
- ✅ Express written consent language on the phone confirmation screen.
- ✅ Consent timestamp + page URL captured into the lead payload.
- ✅ TrustedForm script is live (free) — captures independent proof of consent.
- ✅ Cookie banner with Accept/Decline that gates pixel firing.
- ✅ Privacy Policy + Terms of Service pages.
- ✅ Compliance footer with required disclosures.

**Still on you:**
1. **Have a US privacy/insurance attorney review** `privacy.html` and `terms.html` before launching paid ads.
2. **TrustedForm cert retrieval** — to actually use the certificate as legal proof in a TCPA dispute, you need an ActiveProspect account (~$0.30/lead). The script is already firing; you just need the account to retrieve certs by URL.
3. **Optional: Jornaya LeadiD** — competing product, also accepted by most carriers.
4. **State licensing** — confirm the licensed agents taking calls are licensed in the caller's state. Selling insurance across state lines without proper licensing is a regulatory issue.

---

## 6. Server-side conversion APIs (Tier 3, can wait until you scale)

The browser pixels (Meta, Google) get blocked by ~30% of users (ad-blockers, iOS privacy).
To recover that data:

- **Meta Conversions API (CAPI)** — easiest path is [Stape.io](https://stape.io) (~$20/mo) which proxies events server-side. Or build your own with the Meta Marketing API.
- **Google Enhanced Conversions** — enable in Google Ads → Conversions → upload hashed emails server-side.
- This is what gives you "Hyros parity" — without it your ROAS reporting will be ~30% off.

---

## 7. Final checks before launch

- [ ] Open the live URL in incognito on your phone, run through the quiz end-to-end.
- [ ] Verify a test lead lands in your Google Sheet / Supabase / wherever.
- [ ] Verify the Meta Pixel fires with the test event tool (business.facebook.com → Events Manager → Test Events).
- [ ] Verify the call number actually rings the right line.
- [ ] Verify the share button opens your phone's native share sheet (test on iOS + Android).
- [ ] Open `index.html#admin` (passcode: `trucker2025`) — change `ADMIN_PASSCODE` in the script to something only you know.
- [ ] Replace `support@truckerbenefit.com` and `privacy@truckerbenefit.com` in the footer + policy pages with real inboxes you check.

When all those are checked, you're live.
