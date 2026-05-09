// Server-side lead/event proxy.
//
// The page sendBeacons every lead + event here. This function then forwards
// to the Apps Script (or any other configured backend) server-to-server with
// retries, so we don't lose leads to:
//   - ad-blockers (script.google.com is on most blocklists)
//   - Apps Script's POST → 302 redirect race with browser navigation
//   - mobile network drops during page navigation
//   - momentary Apps Script errors
//
// Set the destination URL once as APPS_SCRIPT_URL in Vercel env vars.
// Leave the page-side TB_CONFIG.LEAD_WEBHOOK_URL pointing at "/api/lead".

const { fireMetaCapiEvent } = require('../lib/capi.js');
const { assessLeadQuality } = require('../lib/lead-quality.js');

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
// Optional generic outbound webhook(s). Comma-separate to fan out to multiple
// URLs (Zapier + Make + your CRM, all at once). Receives every lead as JSON.
const OUTBOUND_LEAD_WEBHOOKS = (process.env.OUTBOUND_LEAD_WEBHOOKS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [0, 500, 1500];

function parseBody(req) {
    if (!req.body) return {};
    if (typeof req.body === 'string') {
        try { return JSON.parse(req.body); } catch (e) { return {}; }
    }
    return req.body;
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function forwardToAppsScript(payload) {
    if (!APPS_SCRIPT_URL) return { ok: false, error: 'apps_script_url_not_configured' };
    const body = JSON.stringify(payload);
    let lastError = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        if (BACKOFF_MS[attempt]) await sleep(BACKOFF_MS[attempt]);
        try {
            const resp = await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: body,
                redirect: 'manual'
            });
            // Apps Script returns 302 on success (the function ran, then redirects
            // to render the JSON response). Treat 2xx and 3xx as success.
            if (resp.status >= 200 && resp.status < 400) {
                return { ok: true, attempt: attempt + 1, status: resp.status };
            }
            lastError = `attempt ${attempt + 1}: status ${resp.status}`;
        } catch (err) {
            lastError = `attempt ${attempt + 1}: ${err && err.message || err}`;
        }
    }
    return { ok: false, error: lastError };
}

// Flatten the lead into the shape GoHighLevel / Zapier / Make / most CRMs
// expect: email + phone at top-level (GHL won't create a contact without
// at least one of those), plus camelCase + snake_case duplicates for
// flexibility, plus quiz answers as named custom fields.
function buildWebhookPayload(payload) {
    const u  = payload.userData     || {};
    const ft = payload.first_touch  || {};
    const tc = payload.tcpa_consent || {};

    const firstName = u.firstName || '';
    const lastName  = u.lastName  || '';
    const fullName  = (firstName + ' ' + lastName).trim();

    return {
        // ─── Differentiation fields (GHL requires email or phone) ───
        email: u.email || '',
        phone: u.phone || '',

        // ─── Standard contact fields, both camelCase + snake_case ───
        firstName: firstName,
        first_name: firstName,
        lastName: lastName,
        last_name: lastName,
        name: fullName,
        full_name: fullName,
        dateOfBirth: u.dob || '',
        date_of_birth: u.dob || '',
        state: u.state || '',
        age: u.age || null,

        // ─── Quiz answers as flat custom fields (no q-prefix) ───
        trucker_status:    payload.q1_trucker_status    || '',
        monthly_finances:  payload.q2_monthly_finances  || '',
        biggest_fear:      payload.q3_biggest_fear      || '',
        looking_for:       payload.q4_looking_for       || '',
        health_conditions: payload.q5_health_conditions || '',
        call_preference:   payload.q10_call_preference  || '',
        monthly_budget:    payload.q12_monthly_budget   || '',

        // ─── Attribution ───
        source:        payload.source         || '',
        utm_source:    ft.utm_source          || '',
        utm_medium:    ft.utm_medium          || '',
        utm_campaign:  ft.utm_campaign        || '',
        utm_content:   ft.utm_content         || '',
        utm_term:      ft.utm_term            || '',
        fbclid:        ft.fbclid              || '',
        gclid:         ft.gclid               || '',
        ttclid:        ft.ttclid              || '',
        referrer:      ft.referrer            || '',
        landing_path:  ft.landing_path        || '',

        // ─── TCPA / consent ───
        tcpa_consent_accepted:   tc.accepted ? 'yes' : 'no',
        tcpa_consent_timestamp:  tc.ts || '',
        trustedform_cert_url:    payload.trustedform_cert_url || '',

        // ─── Operator notes (free-text, agent-facing) ───
        notes: 'Trucker Benefit assessment lead. Driver: ' + (payload.q1_trucker_status || '?') +
               ' | Health: ' + (payload.q5_health_conditions || '?') +
               ' | Budget: ' + (payload.q12_monthly_budget || '?') +
               ' | Wants: ' + (payload.q10_call_preference || '?'),

        // ─── Server context ───
        ip:           payload.proxy_ip           || '',
        user_agent:   payload.proxy_user_agent   || '',
        received_at:  payload.proxy_received_at  || new Date().toISOString(),
        visitor_id:   payload.visitor || '',
        session_id:   payload.session || ''
    };
}

async function fanOutToWebhooks(payload) {
    if (!OUTBOUND_LEAD_WEBHOOKS.length) return { ok: false, error: 'no_webhooks_configured' };
    const flat = buildWebhookPayload(payload);
    const body = JSON.stringify(flat);
    const results = await Promise.all(OUTBOUND_LEAD_WEBHOOKS.map(async url => {
        try {
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: body
            });
            return { url, ok: resp.status >= 200 && resp.status < 300, status: resp.status };
        } catch (err) {
            return { url, ok: false, error: String(err && err.message || err) };
        }
    }));
    const ok = results.some(r => r.ok);
    return { ok, results };
}

async function writeToSupabase(payload) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return { ok: false, error: 'supabase_not_configured' };

    const isLead = payload.kind === 'lead';
    const table = isLead ? 'leads' : 'events';

    let row;
    if (isLead) {
        const u = payload.userData || {};
        row = {
            visitor: payload.visitor || null,
            session: payload.session || null,
            source: payload.source || null,
            device: payload.device || null,
            status: payload.status || null,
            first_name: u.firstName || null,
            email: u.email || null,
            phone: u.phone || null,
            payload: payload
        };
    } else {
        row = {
            name: payload.name || null,
            visitor: payload.visitor || null,
            session: payload.session || null,
            source: payload.source || null,
            device: payload.device || null,
            ts: payload.ts || null,
            event_id: payload.event_id || null,
            payload: payload.data || {}
        };
    }

    try {
        const resp = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_SERVICE_KEY,
                'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify(row)
        });
        if (resp.status >= 200 && resp.status < 300) return { ok: true };
        const text = await resp.text();
        return { ok: false, error: `supabase ${resp.status}: ${text.slice(0, 200)}` };
    } catch (err) {
        return { ok: false, error: String(err && err.message || err) };
    }
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

    const payload = parseBody(req);
    const kind = payload && payload.kind;

    // Enrich the payload with the visitor's IP and user-agent if not already
    // there (server-side captures these reliably even when client tracking
    // is partially blocked).
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
        || (req.socket && req.socket.remoteAddress)
        || null;
    const enriched = {
        ...payload,
        proxy_received_at: new Date().toISOString(),
        proxy_ip: ip,
        proxy_user_agent: req.headers['user-agent'] || null
    };

    // Fire all destinations in parallel:
    //  - Supabase: source of truth for dashboard
    //  - Apps Script: client sheet + Ringy push
    //  - Meta CAPI: server-side conversion events (only for kind=lead)
    //
    // Server-side CAPI firing here (instead of from the browser on
    // /thank-you.html) is what fixes Meta's "low coverage" warning — these
    // requests don't get cancelled by the user navigating to call-now etc.
    const isLead = kind === 'lead';

    // Defensive: a few sources are reserved for internal smoke tests and
    // should never reach external systems even if accidentally fired in a loop.
    const HARD_BLOCKED_SOURCES = ['smoketest', 'deploy_check', 'webhook_proof', 'debug'];
    const isHardBlocked = HARD_BLOCKED_SOURCES.indexOf(payload.source) !== -1;

    // Phone is the differentiation field for every downstream system
    // (Ringy, GHL/LeadConnector, Meta CAPI all require it for matching).
    // A lead without phone is unusable to the buyer — save it for our
    // own records but DO NOT forward externally. This blocks partial leads
    // captured via beforeunload (where the user bailed before Q11).
    const phoneDigits = (payload.userData && payload.userData.phone || '').replace(/\D/g, '');
    const hasUsablePhone = phoneDigits.length >= 10;
    const leadMissingPhone = isLead && !hasUsablePhone;

    // Hard-blocked sources never write ANYWHERE — drop on the floor.
    // Stops accidental smoke-test loops from polluting the database.
    if (isHardBlocked) {
        console.log(`[api/lead] HARD BLOCKED — source=${payload.source} dropped without any writes`);
        return res.status(200).json({ ok: true, hard_blocked: true, source: payload.source });
    }

    const writes = [writeToSupabase(enriched)];

    // Apps Script: always forwards events; only forwards leads if usable.
    if (!isLead || hasUsablePhone) {
        writes.push(forwardToAppsScript(enriched));
    } else {
        writes.push(Promise.resolve({ ok: false, error: 'lead_missing_phone_not_forwarded' }));
        console.log(`[api/lead] Lead missing phone — saved to Supabase only, NOT forwarded to Apps Script/Ringy/GHL/CAPI. visitor=${payload.visitor}`);
    }

    // Outbound webhooks (GHL etc.) — only for leads with a real phone
    if (isLead && hasUsablePhone && OUTBOUND_LEAD_WEBHOOKS.length) {
        writes.push(fanOutToWebhooks(enriched));
    } else {
        writes.push(Promise.resolve({ ok: false, error: leadMissingPhone ? 'lead_missing_phone' : 'skipped' }));
    }

    const capiIds = (payload && payload.capi_event_ids) || {};
    let qualityCheck = null;

    // Don't fire CAPI for ANY test/internal source. These would otherwise
    // pollute Meta's conversion count and inflate apparent CPL/ROAS.
    const TEST_SOURCES = ['test', 'debug', 'smoketest', 'webhook_proof', 'webhook_flat_test', 'pre_launch', 'manual_backfill'];
    const isTestSource = TEST_SOURCES.indexOf(payload.source) !== -1;

    if (isLead && capiIds.lead && !isTestSource && hasUsablePhone) {
        qualityCheck = assessLeadQuality(payload);
        if (qualityCheck.ok) {
            writes.push(fireServerCapiForLead(enriched, capiIds, ip, req.headers['user-agent']));
        } else {
            // Lead still saves to Supabase + Apps Script (we keep the data),
            // but no CAPI fire — Meta's algo doesn't get to learn from junk
            // submissions, which keeps your CPL accurate as you scale.
            console.log(`[api/lead] CAPI skipped — lead failed quality check: ${qualityCheck.reasons.join(', ')}`);
        }
    } else if (isLead && capiIds.lead && isTestSource) {
        console.log(`[api/lead] CAPI skipped — test source: ${payload.source}`);
    } else if (leadMissingPhone) {
        console.log(`[api/lead] CAPI skipped — lead missing phone`);
    }

    const results = await Promise.all(writes);
    const [supabaseResult, appsScriptResult, webhookResult, capiResult] = results;

    const okAny = supabaseResult.ok || appsScriptResult.ok || (webhookResult && webhookResult.ok);
    let capiInfo;
    if (!isLead || !capiIds.lead) {
        capiInfo = 'capi=skipped';
    } else if (qualityCheck && !qualityCheck.ok) {
        capiInfo = 'capi=blocked_low_quality:' + qualityCheck.reasons.join('|');
    } else if (capiResult) {
        capiInfo = `capi_lead=${capiResult.lead && capiResult.lead.ok ? 'ok' : 'err:' + (capiResult.lead && capiResult.lead.error)}`;
    } else {
        capiInfo = 'capi=unknown';
    }

    const webhookInfo = (isLead && OUTBOUND_LEAD_WEBHOOKS.length)
        ? `webhooks=${webhookResult && webhookResult.ok ? 'ok(' + (webhookResult.results || []).filter(r => r.ok).length + '/' + (webhookResult.results || []).length + ')' : 'err'}`
        : 'webhooks=none';

    if (okAny) {
        console.log(`[api/lead] kind=${kind} supabase=${supabaseResult.ok ? 'ok' : 'err:' + supabaseResult.error} apps_script=${appsScriptResult.ok ? 'ok attempt=' + appsScriptResult.attempt : 'err:' + appsScriptResult.error} ${capiInfo} ${webhookInfo}`);
        return res.status(200).json({
            ok: true,
            supabase: supabaseResult.ok,
            apps_script: appsScriptResult.ok,
            apps_script_attempt: appsScriptResult.attempt,
            outbound_webhooks: webhookResult && webhookResult.results,
            capi_lead: capiResult && capiResult.lead && capiResult.lead.ok,
            quality: qualityCheck
        });
    } else {
        console.error(`[api/lead] ALL FAILED kind=${kind} supabase=${supabaseResult.error} apps_script=${appsScriptResult.error} ${capiInfo} ${webhookInfo}`);
        return res.status(502).json({
            error: 'all_destinations_failed',
            supabase: supabaseResult.error,
            apps_script: appsScriptResult.error,
            webhooks: webhookResult && webhookResult.results
        });
    }
};

// Fire Lead + CompleteRegistration to Meta CAPI server-side.
// Uses event_ids that the client also passed to the browser pixel via
// sessionStorage, so Meta dedupes browser + server.
async function fireServerCapiForLead(payload, capiIds, ip, userAgent) {
    const u = payload.userData || {};
    const ft = payload.first_touch || {};
    const sourceUrl = payload.event_source_url
        || payload.thank_you_url
        || (payload.proxy_origin ? payload.proxy_origin + '/thank-you.html' : 'https://truckerbenefit.com/thank-you.html');

    // Reconstruct fbc from first_touch fbclid if no cookie was passed.
    let fbc = payload.fbc;
    if (!fbc && ft.fbclid) {
        fbc = 'fb.1.' + (ft.ts || Date.now()) + '.' + ft.fbclid;
    }

    const userData = {
        email: u.email,
        phone: u.phone,
        firstName: u.firstName,
        lastName: u.lastName,
        dob: u.dob,
        state: u.state,
        country: 'us',
        external_id: payload.visitor,
        fbp: payload.fbp,
        fbc: fbc
    };

    const lead = await fireMetaCapiEvent({
        event_name: 'Lead',
        event_id: capiIds.lead,
        event_source_url: sourceUrl,
        user_data: userData,
        custom_data: { content_name: 'Quiz Complete', value: 1, currency: 'USD' },
        client_ip: ip,
        client_user_agent: userAgent
    });

    return { lead };
}
