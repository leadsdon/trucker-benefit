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

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

    if (!APPS_SCRIPT_URL) {
        // No destination configured — log loudly so the operator notices in
        // Vercel logs. Returning 500 so the client knows it failed.
        console.error('[api/lead] APPS_SCRIPT_URL env var is not set');
        return res.status(500).json({ error: 'apps_script_url_not_configured' });
    }

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

    const result = await forwardToAppsScript(enriched);

    if (result.ok) {
        // Compact success log; visible in Vercel → Project → Logs
        console.log(`[api/lead] ok kind=${kind} attempt=${result.attempt}`);
        return res.status(200).json({ ok: true, attempt: result.attempt });
    } else {
        console.error(`[api/lead] FAILED kind=${kind} error=${result.error}`);
        return res.status(502).json({ error: 'forward_failed', detail: result.error });
    }
};
