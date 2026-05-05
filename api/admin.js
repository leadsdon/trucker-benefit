// Admin dashboard data source.
// Reads leads + events from Supabase (always-live source of truth) and
// returns them in the shape the dashboard expects.
//
// Required env vars (set in Vercel → Project → Settings → Environment Variables):
//   SUPABASE_URL          https://<your-project>.supabase.co
//   SUPABASE_SERVICE_KEY  the service_role key (Supabase → Settings → API)
//   ADMIN_TOKEN           any long random string; the dashboard sends it as ?token=
//
// The service_role key bypasses Row Level Security — never expose to the client.
// It only lives in this serverless function, never in the page source.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

const EVENTS_LIMIT = 50000;
const LEADS_LIMIT = 10000;

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(204).end();

    const token = (req.query && req.query.token) || '';
    if (!ADMIN_TOKEN) {
        return res.status(500).json({ error: 'admin_token_not_configured' });
    }
    if (token !== ADMIN_TOKEN) {
        return res.status(401).json({ error: 'unauthorized' });
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return res.status(500).json({ error: 'supabase_not_configured' });
    }

    const headers = {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json'
    };

    try {
        const [leadsRes, eventsRes] = await Promise.all([
            fetch(SUPABASE_URL + '/rest/v1/leads?order=received_at.desc&limit=' + LEADS_LIMIT, { headers }),
            fetch(SUPABASE_URL + '/rest/v1/events?order=received_at.desc&limit=' + EVENTS_LIMIT, { headers })
        ]);

        if (!leadsRes.ok || !eventsRes.ok) {
            const leadsErr = leadsRes.ok ? null : await leadsRes.text();
            const eventsErr = eventsRes.ok ? null : await eventsRes.text();
            return res.status(502).json({
                error: 'supabase_fetch_failed',
                leads_status: leadsRes.status,
                events_status: eventsRes.status,
                leads_err: leadsErr,
                events_err: eventsErr
            });
        }

        const leadsRaw = await leadsRes.json();
        const eventsRaw = await eventsRes.json();

        // Reshape into what the dashboard expects (already-nested format).
        // The dashboard's unflattenRow() will see userData as an object and
        // skip the unflatten path — data flows through unchanged.
        const leads = leadsRaw.map(function(l) {
            const ts = new Date(l.received_at).getTime();
            const p = l.payload || {};
            return Object.assign({}, p, {
                visitor: l.visitor || p.visitor,
                session: l.session || p.session,
                source: l.source || p.source,
                device: l.device || p.device,
                status: l.status || p.status,
                savedAt: l.received_at,
                savedAtTs: ts,
                ts: ts
            });
        });

        const events = eventsRaw.map(function(e) {
            const p = e.payload || {};
            return {
                name: e.name,
                visitor: e.visitor,
                session: e.session,
                source: e.source,
                device: e.device,
                ts: e.ts || new Date(e.received_at).getTime(),
                event_id: e.event_id,
                data: p,
                received_at: e.received_at
            };
        });

        // Cache on the CDN for 5 seconds — dashboard auto-refreshes every 15s
        // anyway, this just smooths burst traffic from a single user mashing refresh.
        res.setHeader('Cache-Control', 'public, max-age=5, s-maxage=5');
        return res.status(200).json({ leads: leads, events: events });
    } catch (err) {
        return res.status(500).json({ error: 'server_error', message: String(err && err.message || err) });
    }
};
