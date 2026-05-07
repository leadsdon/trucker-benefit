-- ────────────────────────────────────────────────────────────────────────
-- Backfill: 9 real leads received before the system was live.
-- Run this in Supabase → SQL Editor → New query → Run.
-- Sources them as 'pre_launch' so they show up clearly in dashboards
-- and don't get attributed to your paid ad campaigns.
-- ────────────────────────────────────────────────────────────────────────

insert into public.leads (received_at, status, source, first_name, payload) values
    (now() - interval '14 days', 'complete', 'pre_launch', 'Devin',
        '{"status":"complete","source":"pre_launch","userData":{"firstName":"Devin"},"notes":"Pre-launch lead — backfilled manually"}'::jsonb),

    (now() - interval '13 days', 'complete', 'pre_launch', 'Sampson',
        '{"status":"complete","source":"pre_launch","userData":{"firstName":"Sampson"},"notes":"Pre-launch lead — backfilled manually"}'::jsonb),

    (now() - interval '12 days', 'complete', 'pre_launch', 'MICHELE',
        '{"status":"complete","source":"pre_launch","userData":{"firstName":"MICHELE"},"notes":"Pre-launch lead — backfilled manually"}'::jsonb),

    (now() - interval '11 days', 'complete', 'pre_launch', 'Robert',
        '{"status":"complete","source":"pre_launch","userData":{"firstName":"Robert"},"notes":"Pre-launch lead — backfilled manually"}'::jsonb),

    (now() - interval '10 days', 'complete', 'pre_launch', 'Paul',
        '{"status":"complete","source":"pre_launch","userData":{"firstName":"Paul"},"notes":"Pre-launch lead — backfilled manually"}'::jsonb),

    (now() - interval '9 days',  'complete', 'pre_launch', 'Bill',
        '{"status":"complete","source":"pre_launch","userData":{"firstName":"Bill"},"notes":"Pre-launch lead — backfilled manually"}'::jsonb),

    (now() - interval '8 days',  'complete', 'pre_launch', 'Debra',
        '{"status":"complete","source":"pre_launch","userData":{"firstName":"Debra"},"notes":"Pre-launch lead — backfilled manually"}'::jsonb),

    (now() - interval '7 days',  'complete', 'pre_launch', 'Russell',
        '{"status":"complete","source":"pre_launch","userData":{"firstName":"Russell"},"notes":"Pre-launch lead — backfilled manually"}'::jsonb),

    (now() - interval '6 days',  'complete', 'pre_launch', 'Lazaro',
        '{"status":"complete","source":"pre_launch","userData":{"firstName":"Lazaro"},"notes":"Pre-launch lead — backfilled manually"}'::jsonb);

-- Verify the inserts
select first_name, source, received_at::date as received
from public.leads
where source = 'pre_launch'
order by received_at desc;
