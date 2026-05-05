-- ────────────────────────────────────────────────────────────────────────
-- Trucker Benefit — Supabase schema
-- Paste this entire file into Supabase → SQL Editor → New query → Run.
-- ────────────────────────────────────────────────────────────────────────

-- Events table: every analytics event (page_view, question_view, etc.)
create table if not exists public.events (
    id bigserial primary key,
    received_at timestamptz not null default now(),
    name text,
    visitor text,
    session text,
    source text,
    device text,
    ts bigint,
    event_id text,
    payload jsonb not null default '{}'::jsonb
);

create index if not exists events_received_at_idx on public.events (received_at desc);
create index if not exists events_visitor_idx on public.events (visitor);
create index if not exists events_session_idx on public.events (session);
create index if not exists events_name_idx on public.events (name);

-- Leads table: every quiz completion
create table if not exists public.leads (
    id bigserial primary key,
    received_at timestamptz not null default now(),
    visitor text,
    session text,
    source text,
    device text,
    status text,
    first_name text,
    email text,
    phone text,
    payload jsonb not null default '{}'::jsonb
);

create index if not exists leads_received_at_idx on public.leads (received_at desc);
create index if not exists leads_visitor_idx on public.leads (visitor);
create index if not exists leads_email_idx on public.leads (email);
create index if not exists leads_phone_idx on public.leads (phone);

-- Lock down public access. Only the service role (used by our Vercel functions)
-- can read/write. Anonymous users get nothing — anon key won't even SELECT.
alter table public.events enable row level security;
alter table public.leads enable row level security;
