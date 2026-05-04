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

### A. Create a separate Google Sheet for the client (the one they'll edit)

The client needs Editor access to add their own columns (Status, Notes, Disposition, etc.) without touching your master. So we use a SECOND Google Sheet that the Apps Script writes into.

1. **sheets.google.com → Blank**. Name it something like `Trucker Benefit — Client Leads`.
2. **Share** → enter the client's email → set permission to **Editor** → Send.
3. Open the sheet's URL. Copy the ID from the middle of the URL:
   ```
   https://docs.google.com/spreadsheets/d/THIS_PART_HERE/edit
   ```
4. You'll paste this ID into the Apps Script in step C.

### B. Update the Apps Script to its latest version

The current `apps-script-backend.gs` (v3) writes to:
- Your master sheet — `Leads` and `Events` tabs (unchanged)
- The CLIENT'S sheet (different file, they have Editor access) — single `Leads` tab with only buyer-facing columns

Plus it pushes each new lead to a Ringy webhook URL.

To upgrade:
1. Open your Apps Script editor (Extensions → Apps Script in your master sheet).
2. Replace the entire script with the latest contents of [`apps-script-backend.gs`](apps-script-backend.gs).
3. Keep your existing `ADMIN_TOKEN` value.
4. Save (`Cmd+S`).

### C. Set the three connection values at the top of the script

```js
const ADMIN_TOKEN = "...";                               // (your existing token)
const RINGY_WEBHOOK_URL = "https://app.ringy.com/...";   // from your client's Ringy
const CLIENT_SHEET_ID = "1ABcD...EfGh";                  // from step A.3 above
```

After saving, **Deploy → Manage deployments → ✏️ → Version: New version → Deploy.** (Web app URL stays the same.)

The first time a lead comes in after this, the client's sheet automatically gets:
- A header row with: First Name, Phone, Email, Date of Birth, Zip, Income, Driver Type, Biggest Fear, Looking For, Notes
- Bold + frozen header
- One row of lead data underneath

The client can then add their own columns to the right (e.g. Status, Disposition, Called?) and edit any past row freely. The Apps Script only ever appends new rows; it never overwrites the buyer's edits.

If you later want to change which columns the client receives, edit `CLIENT_COLUMNS` and `CLIENT_COLUMN_LABELS` at the top of the script and redeploy.

### D. Get the Ringy "Lead Drop URL" from your client

1. In Ringy → **Lead Sources → New Source → Webhook** (the names sometimes change; look for "Lead Drop" or "Webhook URL").
2. Configure the Ringy field mapping. We send exactly these 10 field names — make sure each one is mapped on Ringy's side:
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
   notes
   ```
3. Ringy gives you a unique POST URL (something like `https://app.ringy.com/api/public/leads/new-lead/abc123def456`).
4. Paste that URL into the Apps Script `RINGY_WEBHOOK_URL` constant.
5. Save → redeploy.

If you ever need to change which fields go to Ringy, edit the `payload` object inside `pushToRingy()` in the script.

### E. After the next test lead

You should see:
1. **Your master sheet's `Leads` tab** — full row with attribution, fbclid, scroll depth, all the per-question columns, etc. (Your records.)
2. **The client's separate sheet** — single row with only First Name, Phone, Email, DOB, Zip, Income, Driver Type, Biggest Fear, Looking For, Notes. Bold + frozen header. They can add Status / Disposition columns to the right freely.
3. **The client's Ringy** — a new lead card with the same 10 fields populated.

If anything's off, the Apps Script has `console.error()` calls that show up in Apps Script → Executions tab — check there for "Could not open CLIENT_SHEET_ID" or "Ringy push failed" messages.
