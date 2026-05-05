# Supabase setup — always-live Postgres for the admin dashboard

Replaces Google Sheets as the source of truth for the admin dashboard.
Every lead and event the page captures gets written to Supabase Postgres
in real time, alongside the existing Apps Script write (which still handles
the buyer-facing client sheet + Ringy push).

## What you get

- Postgres database with millisecond reads
- Indexed by visitor / session / email / phone / received_at
- `payload` JSONB column that stores the full original event/lead — never lose data
- Free tier: 500MB storage + 50K monthly active users (way more than enough)
- Service-role key locked down server-side (never exposed to the browser)

## Setup (~10 min)

### 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → **Start your project** → sign up with GitHub.
2. Click **New project**.
3. Name it `trucker-benefit-prod` (or whatever).
4. **Database password** — generate a long random one. You won't need it for our setup but save it somewhere.
5. Pick the region closest to your traffic (US East / US West).
6. **Pricing plan**: Free.
7. Click **Create new project**. Wait ~2 min for provisioning.

### 2. Create the tables

1. Once provisioned, left sidebar → **SQL Editor** → **New query**.
2. Open [`backend/supabase-schema.sql`](supabase-schema.sql) → copy the entire file.
3. Paste into the SQL Editor → click **Run** (bottom right).
4. You should see "Success. No rows returned." — tables `leads` and `events` now exist.

Verify: left sidebar → **Table Editor** → you should see `events` and `leads` listed (both empty).

### 3. Get your API URL + service role key

1. Left sidebar → **Project Settings** (gear icon at the bottom) → **API**.
2. Find these two values:
   - **Project URL** (top): looks like `https://abcdefghijk.supabase.co`
   - **service_role key** (under "Project API keys" — click the eye to reveal): a long JWT starting with `eyJ...`
3. Both go into Vercel as env vars in the next step.

⚠️ **The service_role key bypasses Row Level Security.** Treat it like a database password. Never paste it in the browser, in chat, or in client-side code. It only ever lives in Vercel env vars (encrypted at rest) and gets used by `/api/lead` and `/api/admin`.

### 4. Set Vercel env vars

1. **vercel.com → trucker-benefit project → Settings → Environment Variables**.
2. Add three new ones (Production + Preview + Development for all):

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | the Project URL from step 3 |
   | `SUPABASE_SERVICE_KEY` | the service_role JWT from step 3 |
   | `ADMIN_TOKEN` | the same admin token you've been using (`REPLACE_WITH_A_LONG_RANDOM_STRING_AARON_WILL_NEVER_GUESS_LOL_XOXO` for now — change later) |

3. Save → **Deployments → latest → Redeploy** (env vars only apply to NEW deploys).

### 5. Verify

After the redeploy:

```
curl "https://truckerbenefit.com/api/admin?token=REPLACE_WITH_A_LONG_RANDOM_STRING_AARON_WILL_NEVER_GUESS_LOL_XOXO"
```

Should return `{"leads":[],"events":[]}`. Empty because the database is fresh.

Then run a real test quiz on the live site. Within ~15s the dashboard at
`truckerbenefit.com/#admin` should show the new visitor + lead, reading
straight from Supabase. The `Source:` indicator at the top will say
`remote (Sheet)` (the label is legacy — it's actually Supabase now).

### 6. Confirm Supabase rows in the Supabase UI

Left sidebar → **Table Editor** → `events` table → you should see ~30+ rows
from your test (page_view, question_view, question_answered, quiz_completed,
etc.). Click `leads` table → 1 row with the lead data.

## How it works

```
┌────────────────────────┐
│ truckerbenefit.com     │  page submits each lead/event to /api/lead
└────────────┬───────────┘
             │
             ▼
┌────────────────────────┐
│ Vercel /api/lead       │  enriches with IP/UA, fires both writes in parallel
└──┬──────────────────┬──┘
   │                  │
   ▼                  ▼
┌────────────┐  ┌─────────────────────┐
│ Supabase   │  │ Apps Script         │
│ (events +  │  │ → Master Sheet      │
│  leads)    │  │ → Client Sheet      │
│            │  │ → Ringy webhook     │
└─────┬──────┘  └─────────────────────┘
      │
      │ (admin reads)
      ▼
┌────────────────────────┐
│ Vercel /api/admin      │  token-gated, queries Supabase, returns JSON
└────────────┬───────────┘
             │
             ▼
┌────────────────────────┐
│ truckerbenefit.com/#admin │
└────────────────────────┘
```

Two parallel write paths means: if Supabase is down, the Sheet + Ringy still work. If Apps Script is down, Supabase still gets the data. Resilient.

## Cleanup

Once Supabase is live:
- The Apps Script's master sheet (`Leads` + `Events` tabs) is now redundant for the dashboard. You can leave it as a backup, or stop writing to it (remove the Apps Script append call from `/api/lead`).
- The client sheet (with the buyer's 10 columns) and Ringy push are still 100% Apps Script's job. Don't touch those.

## SQL queries you'll want later

Run these in Supabase → SQL Editor anytime:

```sql
-- Lead count by day
select date_trunc('day', received_at) as day, count(*)
from leads group by 1 order by 1 desc;

-- Conversion by source
select source, count(*) as leads
from leads group by source order by 2 desc;

-- Funnel by question (drop-off detector)
select payload->>'number' as question_number, count(*) as views
from events
where name = 'question_view'
group by 1 order by 1::int;

-- Find a specific lead
select * from leads where phone = '(555) 010-2030';
```
