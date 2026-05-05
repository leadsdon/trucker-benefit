// Shared Meta Conversions API firing logic.
// Used by both /api/capi (browser-driven Contact events) and /api/lead
// (server-driven Lead + CompleteRegistration on every quiz completion).
//
// Required env vars:
//   META_PIXEL_ID
//   META_ACCESS_TOKEN
// Optional:
//   META_TEST_EVENT_CODE  (set during Test Events verification, remove for prod)

const crypto = require('node:crypto');

const META_API_VERSION = 'v19.0';

function sha256Lower(v) {
    if (v === undefined || v === null || v === '') return undefined;
    return crypto.createHash('sha256').update(String(v).toLowerCase().trim()).digest('hex');
}

function normalizePhone(phone) {
    if (!phone) return undefined;
    const digits = String(phone).replace(/\D/g, '');
    if (!digits) return undefined;
    return digits.length === 10 ? '1' + digits : digits;
}

function normalizeDob(dob) {
    if (!dob) return undefined;
    // MM/DD/YYYY → YYYYMMDD (Meta's pre-hash format)
    const m = String(dob).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return undefined;
    return m[3] + m[1] + m[2];
}

function buildUserData(u, ip, ua) {
    const out = {};
    if (u.email)       out.em = sha256Lower(u.email);
    if (u.phone)       out.ph = sha256Lower(normalizePhone(u.phone));
    if (u.firstName)   out.fn = sha256Lower(u.firstName);
    if (u.lastName)    out.ln = sha256Lower(u.lastName);
    if (u.dob)         out.db = sha256Lower(normalizeDob(u.dob));
    if (u.zip)         out.zp = sha256Lower(u.zip);
    if (u.state)       out.st = sha256Lower(u.state);
    out.country = sha256Lower(u.country || 'us');
    if (u.fbp)         out.fbp = u.fbp;
    if (u.fbc)         out.fbc = u.fbc;
    if (u.external_id) out.external_id = sha256Lower(u.external_id);
    if (ip)            out.client_ip_address = ip;
    if (ua)            out.client_user_agent = ua;
    return out;
}

/**
 * Fire a single CAPI event. Returns { ok, status, events_received, error }.
 *
 * opts: {
 *   event_name, event_id, event_source_url, event_time,
 *   user_data: { email, phone, firstName, lastName, dob, zip, fbp, fbc, external_id, country },
 *   custom_data: { ... },
 *   client_ip, client_user_agent
 * }
 */
async function fireMetaCapiEvent(opts) {
    const PIXEL_ID = process.env.META_PIXEL_ID;
    const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
    const TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE || undefined;

    if (!PIXEL_ID || !ACCESS_TOKEN) {
        return { ok: false, error: 'capi_not_configured' };
    }
    if (!opts.event_name || !opts.event_id) {
        return { ok: false, error: 'missing_event_name_or_id' };
    }

    const event = {
        event_name: opts.event_name,
        event_time: Number(opts.event_time) || Math.floor(Date.now() / 1000),
        event_id: opts.event_id,
        event_source_url: opts.event_source_url,
        action_source: 'website',
        user_data: buildUserData(opts.user_data || {}, opts.client_ip, opts.client_user_agent),
        custom_data: opts.custom_data || {}
    };

    const payload = { data: [event] };
    if (TEST_EVENT_CODE) payload.test_event_code = TEST_EVENT_CODE;

    const url = `https://graph.facebook.com/${META_API_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(ACCESS_TOKEN)}`;

    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            return { ok: false, status: resp.status, error: JSON.stringify(json).slice(0, 300) };
        }
        return { ok: true, status: resp.status, events_received: json.events_received };
    } catch (err) {
        return { ok: false, error: String(err && err.message || err) };
    }
}

module.exports = { fireMetaCapiEvent };
