/**
 * Trucker Benefit — Google Apps Script backend
 *
 * Single endpoint that:
 *   - POST: visitors send leads + events here, we append to a Google Sheet
 *   - GET (with token): the admin dashboard fetches all rows back as JSON
 *
 * Setup:
 *   1. Open the Google Sheet you want to use as the database.
 *   2. Extensions → Apps Script.
 *   3. Replace the default code with this entire file.
 *   4. Replace ADMIN_TOKEN below with a long random string of your choosing.
 *      (Treat it like a password. The admin dashboard will send this in the URL
 *       as ?token=... and the Apps Script will reject any GET that doesn't match.)
 *   5. Save (💾 icon).
 *   6. Deploy → New deployment → Type: Web app.
 *      - Description: "Trucker Benefit backend v1"
 *      - Execute as: Me
 *      - Who has access: Anyone
 *      - Click Deploy.
 *   7. Authorize (Google will warn — click "Advanced → Go to project (unsafe)").
 *   8. Copy the Web app URL (ends in /exec). Paste it back in the chat.
 *
 * Whenever you change the script, you must:
 *   Deploy → Manage deployments → ✏️ → Version: New version → Deploy.
 *   The URL stays the same.
 */

const ADMIN_TOKEN = "REPLACE_WITH_A_LONG_RANDOM_STRING";

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetName = body.kind === "lead" ? "Leads" : "Events";
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) sheet = ss.insertSheet(sheetName);

    const flat = flatten(body);
    flat.received_at = new Date().toISOString();

    appendRowDynamic(sheet, flat);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  if (params.token !== ADMIN_TOKEN) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: "unauthorized" }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const out = { leads: [], events: [] };
  [["Leads", "leads"], ["Events", "events"]].forEach(function(pair) {
    const sheet = ss.getSheetByName(pair[0]);
    if (!sheet) return;
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return;
    const headers = data[0];
    out[pair[1]] = data.slice(1).map(function(row) {
      const obj = {};
      headers.forEach(function(h, i) { obj[h] = row[i]; });
      return obj;
    });
  });
  return ContentService
    .createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Flatten a nested object into dot-free keys so it maps cleanly to columns.
 * { userData: { firstName: "Mike" }, source: "facebook" }
 * becomes
 * { userData_firstName: "Mike", source: "facebook" }
 */
function flatten(obj, prefix) {
  prefix = prefix || "";
  const result = {};
  for (const key in obj) {
    const v = obj[key];
    const newKey = prefix ? prefix + "_" + key : key;
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      Object.assign(result, flatten(v, newKey));
    } else if (Array.isArray(v)) {
      result[newKey] = JSON.stringify(v);
    } else {
      result[newKey] = v;
    }
  }
  return result;
}

/**
 * Append a row in a way that auto-extends the header when new keys appear.
 */
function appendRowDynamic(sheet, flat) {
  const lastCol = sheet.getLastColumn();
  let headers = [];
  if (lastCol > 0) {
    headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  }
  const incomingKeys = Object.keys(flat);
  const newKeys = incomingKeys.filter(function(k) { return headers.indexOf(k) === -1; });

  if (lastCol === 0) {
    headers = incomingKeys.slice();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else if (newKeys.length) {
    sheet.getRange(1, lastCol + 1, 1, newKeys.length).setValues([newKeys]);
    headers = headers.concat(newKeys);
  }

  const row = headers.map(function(h) {
    const v = flat[h];
    return (v === undefined || v === null) ? "" : v;
  });
  sheet.appendRow(row);
}
