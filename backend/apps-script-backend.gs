/**
 * Trucker Benefit — Google Apps Script backend
 *
 * Single endpoint that:
 *   - POST: visitors send leads + events here, we append to a Google Sheet
 *   - GET (with token): the admin dashboard fetches all rows back as JSON
 *
 * Three sheet tabs are written automatically:
 *   - "Leads"        — full lead record with all attribution + tracking columns (your master)
 *   - "Events"       — every analytics event (pageview, scroll, question views, etc.)
 *   - "Client_Leads" — clean buyer-facing columns only, ready to share with the lead buyer
 *
 * On every "lead" POST we ALSO push to RINGY_WEBHOOK_URL (if set) so the
 * client's Ringy CRM gets the lead in real-time.
 *
 * SETUP:
 *   1. Open the Google Sheet you want to use as the database.
 *   2. Extensions → Apps Script.
 *   3. Replace the default code with this entire file.
 *   4. Set ADMIN_TOKEN below to a long random string.
 *   5. Set RINGY_WEBHOOK_URL to the Lead Drop URL from your client's Ringy account
 *      (Ringy → Lead Sources → New Source → "Webhook" → copy URL). Leave blank
 *      to skip the auto-push.
 *   6. Save (💾).
 *   7. Deploy → Manage deployments → ✏️ pencil → Version: New version → Deploy.
 *      The Web app URL stays the same.
 *
 * SHARING WITH THE CLIENT:
 *   The simplest way to give a buyer access to ONLY the clean leads (not your
 *   master sheet with attribution) is to create a separate Google Sheet that
 *   pulls from this one with =IMPORTRANGE(). Steps in the BACKEND.md doc.
 */

const ADMIN_TOKEN = "REPLACE_WITH_A_LONG_RANDOM_STRING";

// Set this to the Lead Drop URL your client gives you from Ringy.
// Leave as empty string ("") to disable auto-push and only update the sheets.
const RINGY_WEBHOOK_URL = "";

// Optional: extra constants Ringy sometimes wants alongside the lead payload.
// Most users only need the URL above. If your Ringy webhook is configured to
// require a SID + auth token in the body, fill these in.
const RINGY_SID = "";
const RINGY_AUTH_TOKEN = "";

// Set this to the ID of a SEPARATE Google Sheet you create for the client.
// You share THAT sheet with the client as Editor — they can add columns
// (Status, Notes, etc.) and mark up rows without touching your master.
// To find the ID, open the sheet and look at the URL:
//   https://docs.google.com/spreadsheets/d/THIS_PART_HERE/edit
//                                          ↑↑↑↑↑↑↑↑↑↑↑↑↑↑
// Leave blank to fall back to a "Client_Leads" tab in the master sheet
// (in which case the client has to share access to your master, not ideal).
const CLIENT_SHEET_ID = "";

// Columns the client/buyer sees. Edit this list to control what's exposed.
// (Keys reference the flattened payload — q1_trucker_status, userData_email, etc.)
// "notes" is synthesized at write time, see writeClientRow below.
const CLIENT_COLUMNS = [
  "userData_firstName",
  "userData_phone",
  "userData_email",
  "userData_dob",
  "userData_zip",
  "q12_income",
  "q1_trucker_status",
  "q5_biggest_fear",
  "q7_looking_for",
  "notes"
];

// Friendlier column names for the Client_Leads sheet.
const CLIENT_COLUMN_LABELS = {
  userData_firstName: "First Name",
  userData_phone: "Phone",
  userData_email: "Email",
  userData_dob: "Date of Birth",
  userData_zip: "Zip",
  q12_income: "Income",
  q1_trucker_status: "Driver Type",
  q5_biggest_fear: "Biggest Fear",
  q7_looking_for: "Looking For",
  notes: "Notes"
};

// Default notes text written to the buyer-facing sheet + sent to Ringy. The
// buyer already gets the structured fields above; this is just a context
// label so it shows up on lead cards/emails.
const LEAD_NOTES = "Trucker Benefit financial protection assessment — completed quiz, IUL match.";

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

    // Lead-specific extras: client-facing sheet + Ringy push.
    if (body.kind === "lead") {
      writeClientRow(ss, flat);
      if (RINGY_WEBHOOK_URL) pushToRingy(flat);
    }

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
 * Append a row to the buyer-facing sheet with only CLIENT_COLUMNS.
 *
 * If CLIENT_SHEET_ID is set, writes to that external sheet (recommended —
 * you share THAT sheet with the buyer as Editor so they can add Status,
 * Notes, etc.). Otherwise falls back to a "Client_Leads" tab inside the
 * master sheet.
 *
 * Headers are written once on the first lead. The script never overwrites
 * existing rows, so any columns the buyer adds to the right (or any edits
 * they make to past rows) are preserved.
 */
function writeClientRow(masterSS, flat) {
  // Inject synthesized "notes" so the row writer can find it.
  flat = Object.assign({}, flat, { notes: LEAD_NOTES });

  let sheet;
  if (CLIENT_SHEET_ID) {
    try {
      const clientSS = SpreadsheetApp.openById(CLIENT_SHEET_ID);
      sheet = clientSS.getSheetByName("Leads") || clientSS.insertSheet("Leads");
    } catch (err) {
      console.error("Could not open CLIENT_SHEET_ID, falling back to master tab:", err);
      sheet = masterSS.getSheetByName("Client_Leads") || masterSS.insertSheet("Client_Leads");
    }
  } else {
    sheet = masterSS.getSheetByName("Client_Leads") || masterSS.insertSheet("Client_Leads");
  }

  // Write header row on first use.
  if (sheet.getLastRow() === 0) {
    const labels = CLIENT_COLUMNS.map(function(k) {
      return CLIENT_COLUMN_LABELS[k] || k;
    });
    sheet.getRange(1, 1, 1, labels.length).setValues([labels]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, labels.length).setFontWeight("bold");
  }

  // Build the row by matching against existing headers (in case the buyer
  // added their own columns like Status / Notes — we leave those blank
  // for them to fill in manually).
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  // Map our CLIENT_COLUMN_LABELS values back to their internal keys so we
  // can look up the buyer-friendly header → underlying field.
  const labelToKey = {};
  Object.keys(CLIENT_COLUMN_LABELS).forEach(function(k) {
    labelToKey[CLIENT_COLUMN_LABELS[k]] = k;
  });

  const row = headers.map(function(h) {
    const internalKey = labelToKey[h] || h;
    const v = flat[internalKey];
    return (v === undefined || v === null) ? "" : v;
  });
  sheet.appendRow(row);
}

/**
 * POST a lead to the client's Ringy webhook in a format that maps cleanly to
 * Ringy's standard fields. The exact field names Ringy expects depend on how
 * the user configured their Lead Drop in Ringy — this payload covers the
 * common defaults.
 */
function pushToRingy(flat) {
  // Fields the client receives. Match exactly what Ringy is mapped to expect.
  const payload = {
    first_name: flat.userData_firstName || "",
    phone: flat.userData_phone || "",
    email: flat.userData_email || "",
    date_of_birth: flat.userData_dob || "",
    zip: flat.userData_zip || "",
    income: flat.q12_income || "",
    driver_type: flat.q1_trucker_status || "",
    biggest_fear: flat.q5_biggest_fear || "",
    looking_for: flat.q7_looking_for || "",
    notes: LEAD_NOTES
  };
  // If Ringy requires SID + auth_token, include them.
  if (RINGY_SID) payload.sid = RINGY_SID;
  if (RINGY_AUTH_TOKEN) payload.auth_token = RINGY_AUTH_TOKEN;

  try {
    UrlFetchApp.fetch(RINGY_WEBHOOK_URL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
      followRedirects: true
    });
  } catch (err) {
    // Don't fail the whole doPost if Ringy is down — the lead is still in the
    // sheets, you can review/forward later.
    console.error("Ringy push failed:", err);
  }
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
