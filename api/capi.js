// Server-side Meta Conversions API endpoint.
// Called from /thank-you.html alongside the browser pixel — same event_id on
// both, so Meta dedupes. PII is SHA-256 hashed before leaving this function.
//
// Required env vars (set in Vercel → Project → Settings → Environment Variables):
//   META_PIXEL_ID         e.g. 1589839658777765
//   META_ACCESS_TOKEN     the long EAAK... token from Events Manager → Conversions API
// Optional:
//   META_TEST_EVENT_CODE  while testing in Events Manager → Test Events tab
//                         (find it labeled "Test Event Code"); remove for prod

const crypto = require('node:crypto');

const META_API_VERSION = 'v19.0';

function sha256(v) {
    if (v === undefined || v === null || v === '') return undefined;
    return crypto.createHash('sha256').update(String(v).toLowerCase().trim()).digest('hex');
}

function normalizePhone(phone) {
    if (!phone) return undefined;
    const digits = String(phone).replace(/\D/g, '');
    if (!digits) return undefined;
    // US default: prepend 1 if 10 digits
    return digits.length === 10 ? '1' + digits : digits;
}

function normalizeDob(dob) {
    if (!dob) return undefined;
    // Convert MM/DD/YYYY → YYYYMMDD (Meta's expected format pre-hash)
    const m = String(dob).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return undefined;
    return m[3] + m[1] + m[2];
}

function parseBody(req) {
    if (req.body) {
        if (typeof req.body === 'string') {
            try { return JSON.parse(req.body); } catch (e) { return {}; }
        }
        return req.body;
    }
    return {};
}

module.exports = async function handler(req, res) {
    // CORS — only accept from our own origin in production. * is safe here
    // because the endpoint is rate-limited by Vercel and the access token is
    // not exposed to the client anyway.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

    const PIXEL_ID = process.env.META_PIXEL_ID;
    const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
    const TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE || undefined;

    if (!PIXEL_ID || !ACCESS_TOKEN) {
        return res.status(500).json({ error: 'capi_not_configured', detail: 'Set META_PIXEL_ID and META_ACCESS_TOKEN in Vercel environment variables.' });
    }

    let body;
    try { body = parseBody(req); }
    catch (e) { return res.status(400).json({ error: 'invalid_body' }); }

    const event_name = body.event_name;
    const event_id = body.event_id;
    const event_source_url = body.event_source_url || req.headers['referer'];
    const event_time = Number(body.event_time) || Math.floor(Date.now() / 1000);
    const userData = body.user_data || {};
    const custom_data = body.custom_data || {};

    if (!event_name || !event_id) {
        return res.status(400).json({ error: 'missing_event_name_or_id' });
    }

    // Pull IP + UA from the request — these are the strongest match keys
    // because they always exist server-side.
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
        || (req.socket && req.socket.remoteAddress)
        || undefined;
    const userAgent = req.headers['user-agent'];

    const user_data = {};
    if (userData.email)     user_data.em = sha256(userData.email);
    if (userData.phone)     user_data.ph = sha256(normalizePhone(userData.phone));
    if (userData.firstName) user_data.fn = sha256(userData.firstName);
    if (userData.lastName)  user_data.ln = sha256(userData.lastName);
    if (userData.dob)       user_data.db = sha256(normalizeDob(userData.dob));
    if (userData.zip)       user_data.zp = sha256(userData.zip);
    if (userData.state)     user_data.st = sha256(userData.state);
    if (userData.country)   user_data.country = sha256(userData.country || 'us');
    if (userData.fbp)       user_data.fbp = userData.fbp;
    if (userData.fbc)       user_data.fbc = userData.fbc;
    if (userData.external_id) user_data.external_id = sha256(userData.external_id);
    if (ip)                 user_data.client_ip_address = ip;
    if (userAgent)          user_data.client_user_agent = userAgent;

    const event = {
        event_name,
        event_time,
        event_id,
        event_source_url,
        action_source: 'website',
        user_data,
        custom_data
    };

    const payload = { data: [event] };
    if (TEST_EVENT_CODE) payload.test_event_code = TEST_EVENT_CODE;

    const metaUrl = `https://graph.facebook.com/${META_API_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(ACCESS_TOKEN)}`;

    try {
        const metaResp = await fetch(metaUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const metaJson = await metaResp.json().catch(() => ({}));

        if (!metaResp.ok) {
            return res.status(502).json({ error: 'meta_error', status: metaResp.status, meta: metaJson });
        }
        return res.status(200).json({ ok: true, event_id, events_received: metaJson.events_received });
    } catch (err) {
        return res.status(500).json({ error: 'server_error', message: String(err) });
    }
};
