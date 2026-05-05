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

    // Fire both writes in parallel. Supabase is the always-live source of truth
    // for the dashboard; Apps Script handles the client sheet + Ringy push.
    // If one fails, the other still goes — we don't lose the lead.
    const [supabaseResult, appsScriptResult] = await Promise.all([
        writeToSupabase(enriched),
        forwardToAppsScript(enriched)
    ]);

    if (supabaseResult.ok || appsScriptResult.ok) {
        console.log(`[api/lead] kind=${kind} supabase=${supabaseResult.ok ? 'ok' : 'err:' + supabaseResult.error} apps_script=${appsScriptResult.ok ? 'ok attempt=' + appsScriptResult.attempt : 'err:' + appsScriptResult.error}`);
        return res.status(200).json({
            ok: true,
            supabase: supabaseResult.ok,
            apps_script: appsScriptResult.ok,
            apps_script_attempt: appsScriptResult.attempt
        });
    } else {
        console.error(`[api/lead] BOTH FAILED kind=${kind} supabase=${supabaseResult.error} apps_script=${appsScriptResult.error}`);
        return res.status(502).json({
            error: 'all_destinations_failed',
            supabase: supabaseResult.error,
            apps_script: appsScriptResult.error
        });
    }
};
