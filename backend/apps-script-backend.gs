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
// Keys reference the flattened payload — userData_*, q<N>_<slug>, notes.
// "notes" is synthesized at write time, see writeClientRow below.
//
// Quiz is currently 13 questions. Keep these in sync with QUESTION_SLUGS
// in index.html if you change the quiz structure.
const CLIENT_COLUMNS = [
  "userData_firstName",
  "userData_lastName",
  "userData_phone",
  "userData_email",
  "userData_dob",
  "userData_state",
  "q1_trucker_status",
  "q2_monthly_finances",
  "q11_monthly_budget",
  "q5_health_conditions",
  "q3_biggest_fear",
  "q4_looking_for",
  "notes"
];

// Friendlier column names for the Client_Leads sheet.
const CLIENT_COLUMN_LABELS = {
  userData_firstName: "First Name",
  userData_lastName: "Last Name",
  userData_phone: "Phone",
  userData_email: "Email",
  userData_dob: "Date of Birth",
  userData_state: "State",
  q1_trucker_status: "Driver Type",
  q2_monthly_finances: "Monthly Finances",
  q11_monthly_budget: "Monthly Budget",
  q5_health_conditions: "Health Conditions",
  q3_biggest_fear: "Biggest Fear",
  q4_looking_for: "Looking For",
  notes: "Notes"
};

// Default notes text written to the buyer-facing sheet + sent to Ringy. The
// buyer already gets the structured fields above; this is just a context
// label so it shows up on lead cards/emails.
const LEAD_NOTES = "Trucker Benefit financial protection assessment — completed quiz, IUL match.";

/**
 * One-time auth check. Run this from the editor (▶ button) BEFORE deploying.
 * Google will prompt for SpreadsheetApp + UrlFetchApp permissions — accept
 * all of them. This grants the script everything it needs to:
 *   - Write to the master sheet (already worked)
 *   - openById the SEPARATE client sheet (was failing silently)
 *   - UrlFetchApp.fetch to Ringy (was failing silently)
 *
 * Look at the Execution Log (View → Logs / Cmd+Enter) for ✅ marks. Any ❌
 * means that capability isn't granted yet.
 */
/**
 * One-shot cleanup. Run this from the editor (▶ button) to remove all
 * DeployCheck / smoketest / test rows from BOTH the master sheet and
 * the separate client sheet. Useful after a runaway test loop.
 *
 * Look at View → Logs after running for a row-count summary.
 */
function cleanupTestRows() {
  const JUNK_NAMES = ['DeployCheck', 'TEST_DRIVER', 'TEST_DRIVER_2', 'TEST_CAPI',
    'REAL_LEAD', 'FAKE_PHONE', 'AUTH_TEST', 'AUTH', 'WebhookCheck',
    'WebhookVerify', 'WEBHOOK_PROOF', 'GHL_FIX', 'DEBUG', 'VERIFY', 'CAPI_BLOCK',
    'WebhookFull', 'WebhookVerifyPostDeploy', 'James'];
  const JUNK_SOURCES = ['test', 'debug', 'smoketest', 'webhook_proof',
    'webhook_flat_test', 'webhook_full_test', 'manual_backfill'];

  let totalRemoved = 0;

  // Master sheet — Leads + Events tabs
  const master = SpreadsheetApp.getActiveSpreadsheet();
  ['Leads', 'Events'].forEach(function(tabName) {
    const sheet = master.getSheetByName(tabName);
    if (!sheet) return;
    const removed = wipeJunkRows(sheet, JUNK_NAMES, JUNK_SOURCES);
    Logger.log('Master sheet "' + tabName + '": removed ' + removed + ' rows');
    totalRemoved += removed;
  });

  // Client sheet (separate file) — Leads tab
  if (CLIENT_SHEET_ID) {
    try {
      const client = SpreadsheetApp.openById(CLIENT_SHEET_ID);
      const sheet = client.getSheetByName('Leads');
      if (sheet) {
        const removed = wipeJunkRows(sheet, JUNK_NAMES, JUNK_SOURCES);
        Logger.log('Client sheet "Leads": removed ' + removed + ' rows');
        totalRemoved += removed;
      }
    } catch (err) {
      Logger.log('Could not access client sheet: ' + err);
    }
  }

  Logger.log('TOTAL ROWS REMOVED: ' + totalRemoved);
}

/**
 * Helper for cleanupTestRows. Walks the sheet from the bottom up and
 * deletes any row whose first-name or source matches a junk pattern.
 * Returns the number of rows deleted.
 */
function wipeJunkRows(sheet, junkNames, junkSources) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return 0;

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  // Find columns we'll match against
  const nameCols = [];
  const sourceCols = [];
  headers.forEach(function(h, i) {
    const lower = String(h).toLowerCase();
    if (lower.indexOf('firstname') !== -1 || lower.indexOf('first_name') !== -1 || lower === 'first name') nameCols.push(i);
    if (lower === 'source') sourceCols.push(i);
  });

  // Iterate bottom-up so deleting rows doesn't shift subsequent indices
  let removed = 0;
  for (let i = data.length - 1; i >= 0; i--) {
    const row = data[i];
    const firstName = nameCols.length ? String(row[nameCols[0]] || '') : '';
    const source = sourceCols.length ? String(row[sourceCols[0]] || '') : '';

    const nameMatch = junkNames.some(function(j) { return firstName.indexOf(j) === 0; });
    const sourceMatch = junkSources.indexOf(source) !== -1;

    if (nameMatch || sourceMatch) {
      sheet.deleteRow(i + 2); // +2: 1-indexed + skip header
      removed++;
    }
  }
  return removed;
}

function testAuth() {
  Logger.log('Running auth test...');

  // Test 1: master sheet write
  try {
    const masterSS = SpreadsheetApp.getActiveSpreadsheet();
    Logger.log('✅ Master sheet (' + masterSS.getName() + ') accessible');
  } catch (err) {
    Logger.log('❌ Master sheet failed: ' + err);
  }

  // Test 2: client sheet via openById (this is what was failing)
  try {
    if (!CLIENT_SHEET_ID) {
      Logger.log('⚠ CLIENT_SHEET_ID is empty — set it before testing');
    } else {
      const clientSS = SpreadsheetApp.openById(CLIENT_SHEET_ID);
      Logger.log('✅ Client sheet (' + clientSS.getName() + ') accessible via openById');
    }
  } catch (err) {
    Logger.log('❌ Client sheet openById failed: ' + err);
    Logger.log('   → Make sure CLIENT_SHEET_ID is correct AND that this Google account is shared on the client sheet (or owns it).');
  }

  // Test 3: external URL fetch (Ringy uses this)
  try {
    const resp = UrlFetchApp.fetch('https://httpbin.org/get', { muteHttpExceptions: true });
    Logger.log('✅ UrlFetchApp works (status ' + resp.getResponseCode() + ')');
  } catch (err) {
    Logger.log('❌ UrlFetchApp failed: ' + err);
  }

  // Test 4: actual Ringy POST (with real lead-shaped payload)
  if (RINGY_WEBHOOK_URL && RINGY_SID && RINGY_AUTH_TOKEN) {
    try {
      const resp = UrlFetchApp.fetch(RINGY_WEBHOOK_URL, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
          sid: RINGY_SID,
          authToken: RINGY_AUTH_TOKEN,
          phone_number: '(415) 234-5678',
          first_name: 'AUTH',
          last_name: 'TEST',
          email: 'authtest@truckerbenefit.com',
          state: 'TX',
          notes: 'AUTH TEST — please delete'
        }),
        muteHttpExceptions: true
      });
      Logger.log('✅ Ringy POST: status ' + resp.getResponseCode() + ', body: ' + resp.getContentText().slice(0, 200));
    } catch (err) {
      Logger.log('❌ Ringy POST failed: ' + err);
    }
  } else {
    Logger.log('⚠ Ringy not configured — set RINGY_WEBHOOK_URL + RINGY_SID + RINGY_AUTH_TOKEN');
  }

  Logger.log('Done. Look for ✅ on all 4 lines.');
}

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
  // Ringy public lead-creation endpoint expects auth (sid + authToken) and
  // the lead fields together in a single JSON body.
  // https://app.ringy.com/api/public/leads/new-lead
  const payload = {
    sid: RINGY_SID,
    authToken: RINGY_AUTH_TOKEN,
    // Ringy's canonical phone field is "phone_number", not "phone".
    phone_number: flat.userData_phone || "",
    first_name: flat.userData_firstName || "",
    last_name: flat.userData_lastName || "",
    email: flat.userData_email || "",
    date_of_birth: flat.userData_dob || "",
    state: flat.userData_state || "",
    // Ringy custom fields — your client must create these in their Ringy
    // account (Lead Sources → Custom Fields) for them to show up on the lead.
    monthly_finances: flat.q2_monthly_finances || "",
    monthly_budget: flat.q11_monthly_budget || "",
    driver_type: flat.q1_trucker_status || "",
    health_conditions: flat.q5_health_conditions || "",
    biggest_fear: flat.q3_biggest_fear || "",
    looking_for: flat.q4_looking_for || "",
    notes: LEAD_NOTES
  };

  try {
    const resp = UrlFetchApp.fetch(RINGY_WEBHOOK_URL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
      followRedirects: true
    });
    const code = resp.getResponseCode();
    const text = resp.getContentText();
    if (code >= 200 && code < 300) {
      console.log("Ringy push ok:", code, text.slice(0, 200));
    } else {
      console.error("Ringy push non-2xx:", code, text.slice(0, 500));
    }
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
