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

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
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
    const writes = [
        writeToSupabase(enriched),
        forwardToAppsScript(enriched)
    ];

    const isLead = kind === 'lead';
    const capiIds = (payload && payload.capi_event_ids) || {};
    if (isLead && capiIds.lead) {
        writes.push(fireServerCapiForLead(enriched, capiIds, ip, req.headers['user-agent']));
    }

    const results = await Promise.all(writes);
    const [supabaseResult, appsScriptResult, capiResult] = results;

    const okAny = supabaseResult.ok || appsScriptResult.ok;
    const capiInfo = capiResult ? `capi_lead=${capiResult.lead && capiResult.lead.ok ? 'ok' : 'err:' + (capiResult.lead && capiResult.lead.error)} capi_reg=${capiResult.reg && capiResult.reg.ok ? 'ok' : 'err:' + (capiResult.reg && capiResult.reg.error)}` : 'capi=skipped';

    if (okAny) {
        console.log(`[api/lead] kind=${kind} supabase=${supabaseResult.ok ? 'ok' : 'err:' + supabaseResult.error} apps_script=${appsScriptResult.ok ? 'ok attempt=' + appsScriptResult.attempt : 'err:' + appsScriptResult.error} ${capiInfo}`);
        return res.status(200).json({
            ok: true,
            supabase: supabaseResult.ok,
            apps_script: appsScriptResult.ok,
            apps_script_attempt: appsScriptResult.attempt,
            capi_lead: capiResult && capiResult.lead && capiResult.lead.ok,
            capi_reg: capiResult && capiResult.reg && capiResult.reg.ok
        });
    } else {
        console.error(`[api/lead] BOTH FAILED kind=${kind} supabase=${supabaseResult.error} apps_script=${appsScriptResult.error} ${capiInfo}`);
        return res.status(502).json({
            error: 'all_destinations_failed',
            supabase: supabaseResult.error,
            apps_script: appsScriptResult.error
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
        dob: u.dob,
        zip: u.zip,
        country: 'us',
        external_id: payload.visitor,
        fbp: payload.fbp,
        fbc: fbc
    };

    const [lead, reg] = await Promise.all([
        fireMetaCapiEvent({
            event_name: 'Lead',
            event_id: capiIds.lead,
            event_source_url: sourceUrl,
            user_data: userData,
            custom_data: { content_name: 'Quiz Complete', value: 1, currency: 'USD' },
            client_ip: ip,
            client_user_agent: userAgent
        }),
        capiIds.registration ? fireMetaCapiEvent({
            event_name: 'CompleteRegistration',
            event_id: capiIds.registration,
            event_source_url: sourceUrl,
            user_data: userData,
            custom_data: {},
            client_ip: ip,
            client_user_agent: userAgent
        }) : Promise.resolve({ ok: false, error: 'no_reg_event_id' })
    ]);

    return { lead, reg };
}
