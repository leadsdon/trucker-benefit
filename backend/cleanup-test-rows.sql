-- ────────────────────────────────────────────────────────────────────────
-- Cleanup: remove all test rows + your own self-tests (Juan / Nataly)
-- from Supabase. Run in Supabase → SQL Editor → New query → Run.
--
-- Removes:
--   • Anything where source = 'test' or 'smoketest' (Sarah Mitchell,
--     Marcus Henderson, TEST_DRIVER, TEST_DRIVER_2, TEST_CAPI, REAL_LEAD,
--     FAKE_PHONE, AUTH_TEST, etc.)
--   • Anything where first_name (case-insensitive) is Juan or Nataly
--     (your own dry-run completions on the live site)
--   • All events tied to those same visitor IDs
--
-- Keeps:
--   • All 9 pre_launch backfilled leads (Devin, Sampson, MICHELE, etc.)
--   • Real production traffic
-- ────────────────────────────────────────────────────────────────────────

-- Counts before (so you can see what got removed)
select 'Before cleanup' as stage,
       (select count(*) from public.leads)  as leads,
       (select count(*) from public.events) as events;

-- 1. Delete events from test sources, OR from any visitor associated with
--    a junk lead.
delete from public.events
where source in ('test', 'smoketest')
   or (visitor is not null and visitor in (
        select distinct visitor
        from public.leads
        where visitor is not null
          and (
              source in ('test', 'smoketest')
              or lower(first_name) in ('juan', 'nataly')
              or lower(payload->'userData'->>'firstName') in ('juan', 'nataly')
          )
   ));

-- 2. Delete the junk leads.
delete from public.leads
where source in ('test', 'smoketest')
   or lower(first_name) in ('juan', 'nataly')
   or lower(payload->'userData'->>'firstName') in ('juan', 'nataly');

-- Counts after
select 'After cleanup' as stage,
       (select count(*) from public.leads)  as leads,
       (select count(*) from public.events) as events;

-- What's left in the leads table
select first_name, source, received_at::date as received
from public.leads
order by received_at desc;
