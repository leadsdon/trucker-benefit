# Backend Setup — Google Apps Script

This is the simplest no-extra-service backend that lets the admin dashboard show
leads from EVERY visitor (not just your own browser).

## What you'll get

- One Google Sheet that stores every lead + event in real time.
- One URL that handles both:
  - **POST** from visitors → appends a row to the Sheet
  - **GET** from the admin dashboard (with secret token) → returns all rows as JSON
- Free. No new accounts beyond Google.
- Limit: ~6-min execution per request, ~20K simultaneous users — way more than enough for early traffic.

---

## 1. Create the Sheet (1 min)

1. Go to [sheets.google.com](https://sheets.google.com) → **Blank**.
2. Name it `Trucker Benefit Leads`.
3. Don't add any headers — the script creates them automatically.

## 2. Add the Apps Script (2 min)

1. In the Sheet: **Extensions → Apps Script**.
2. Delete the default `function myFunction()` placeholder.
3. Open [`apps-script-backend.gs`](apps-script-backend.gs) and copy its **entire** contents.
4. Paste into the Apps Script editor.
5. **Replace `ADMIN_TOKEN`** at the top with a long random string. Anything works — example:
   ```js
   const ADMIN_TOKEN = "tb_8K3mxQ9pVzL4nR7sW2yE5jH6";
   ```
   You'll need this same string in the page config later. Keep it secret.
6. Hit `Cmd+S` to save.

## 3. Deploy as a Web App (2 min)

1. Top-right: **Deploy → New deployment**.
2. Click the gear ⚙ → **Web app**.
3. Fill in:
   - **Description:** `Trucker Benefit backend v1`
   - **Execute as:** `Me (your email)`
   - **Who has access:** `Anyone` ← important
4. Click **Deploy**.
5. Google asks for permission. Click **Authorize access**.
6. It'll warn "Google hasn't verified this app." → **Advanced → Go to (unsafe)** → **Allow**.
7. **Copy the Web app URL** (ends in `/exec`). It looks like:
   ```
   https://script.google.com/macros/s/AKfycbz.../exec
   ```

## 4. Send me both values

Reply with:
- The **Web app URL** from step 3.7
- The **ADMIN_TOKEN** string you set in step 2.5

I'll plug both into the page, push to GitHub, Vercel auto-deploys. After that:
- Every visitor's lead lands in your Sheet within seconds.
- The admin dashboard at `truckerbenefit.com/#admin` fetches everything from the Sheet and shows it.
- CSV export still works — now exporting cross-device data.

---

## How to update the script later

If you ever want to change the script logic:

1. Edit in the Apps Script editor → save.
2. **Deploy → Manage deployments → ✏️ pencil**.
3. **Version → New version**, then **Deploy**.
4. The URL stays the same — no code changes needed on our side.

If you skip step 3, your edits won't be live.

---

## Sharing leads with a buyer / client (Ringy + read-only sheet)

Once you start selling these leads, you'll want two delivery channels:
1. A **clean Google Sheet** with only buyer-facing columns (no UTMs, fbclid, scroll depth, internal IDs, etc.) — for record-keeping and audit.
2. **Real-time push to Ringy** so the buyer's dialer gets the lead within seconds of submission.

The Apps Script handles both automatically. Here's how to wire it up.

### A. Update the Apps Script to its latest version

The current `apps-script-backend.gs` (v2) writes to THREE tabs in your sheet:
- `Leads` — your master with everything (unchanged)
- `Events` — every event for the admin dashboard (unchanged)
- `Client_Leads` — clean buyer-facing columns only (NEW)

It also pushes each new lead to a Ringy webhook URL (NEW).

To upgrade:
1. Open your Apps Script editor (Extensions → Apps Script in your sheet).
2. Replace the entire script with the latest contents of [`apps-script-backend.gs`](apps-script-backend.gs).
3. Keep your existing `ADMIN_TOKEN` value.
4. Save.
5. **Deploy → Manage deployments → ✏️ → Version: New version → Deploy.** (Web app URL stays the same.)

After the next lead comes in, a `Client_Leads` tab appears automatically with these columns:

| Column | Source |
|---|---|
| Received | Server timestamp |
| First Name | Quiz Q8 |
| Phone | Quiz Q11 |
| Email | Quiz Q10 |
| DOB | Quiz Q9 |
| Zip | Quiz Q13 |
| Driver Type | Quiz Q1 |
| Income | Quiz Q12 |
| Source | Inferred from UTMs / click IDs / referrer |
| Campaign | first_touch utm_campaign |
| TrustedForm Cert | Independent consent proof URL |
| TCPA Consent | Timestamp the user clicked through the consent text |
| Lead ID | Internal visitor ID |

To change which columns the buyer sees, edit `CLIENT_COLUMNS` at the top of the script.

### B. Get a Ringy "Lead Drop URL" from your client

1. In Ringy → **Lead Sources → New Source → Webhook** (the names sometimes change; look for "Lead Drop" or "Webhook URL").
2. Configure the field mapping in Ringy. We send these exact field names — make sure they're mapped on Ringy's side:
   ```
   first_name
   phone
   email
   date_of_birth
   zip
   income
   driver_type
   biggest_fear
   looking_for
   lead_source
   utm_campaign
   utm_source
   fbclid
   trustedform_cert_url
   tcpa_consent_timestamp
   notes
   ```
3. Ringy gives you a unique POST URL (something like `https://app.ringy.com/api/public/leads/new-lead/abc123def456`).
4. Paste that URL into the Apps Script:
   ```js
   const RINGY_WEBHOOK_URL = "https://app.ringy.com/api/public/leads/new-lead/abc123def456";
   ```
5. Save → redeploy (Manage deployments → New version).

### C. Give the client view-only access to clean leads

Two clean approaches — pick whichever you prefer:

**Option 1: Just share the master sheet, restrict to one tab.**
- File → Share with the client's email, set to **Viewer**.
- They open the sheet, click the `Client_Leads` tab. They can also see other tabs (Leads, Events) — not ideal.

**Option 2 (recommended): A separate sheet that mirrors `Client_Leads` only.**
- Create a brand new blank sheet (sheets.google.com → Blank). Name it something like `Trucker Benefit — Live Leads`.
- In cell A1 paste:
  ```
  =IMPORTRANGE("PASTE_YOUR_MASTER_SHEET_URL_HERE", "Client_Leads!A:Z")
  ```
- Replace the URL with your master sheet's URL. The first time you run it, click **Allow access**.
- Now this new sheet always reflects the `Client_Leads` tab in real time.
- Share THIS new sheet with the client (Viewer access). They never see the master.

If you have multiple clients buying leads, use option 2 with `=QUERY(IMPORTRANGE(...), "select * where Col10='source-they-bought'")` to filter per-source. Tell me when you reach that point and I'll set up the per-buyer filtering.
