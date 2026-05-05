// Browser-driven Meta Conversions API endpoint.
//
// Used for events that originate from a user click on /thank-you.html
// (currently: Contact, when they tap Call Now). Lead and CompleteRegistration
// fire server-side from /api/lead now — they don't need to come back through
// here, which avoids the navigation-cancels-fetch problem that was killing
// CAPI coverage rate.

const { fireMetaCapiEvent } = require('../lib/capi.js');

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
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

    const body = parseBody(req);
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
        || (req.socket && req.socket.remoteAddress)
        || undefined;
    const ua = req.headers['user-agent'];

    const result = await fireMetaCapiEvent({
        event_name: body.event_name,
        event_id: body.event_id,
        event_source_url: body.event_source_url || req.headers['referer'],
        event_time: body.event_time,
        user_data: body.user_data || {},
        custom_data: body.custom_data || {},
        client_ip: ip,
        client_user_agent: ua
    });

    if (!result.ok) {
        const code = result.error === 'capi_not_configured' ? 500
                   : result.error === 'missing_event_name_or_id' ? 400
                   : 502;
        return res.status(code).json(result);
    }
    return res.status(200).json({ ok: true, event_id: body.event_id, events_received: result.events_received });
};
