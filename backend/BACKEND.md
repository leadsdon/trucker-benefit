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
