-- whatsapp-booking-agent: Supabase / Postgres schema.
-- Tables are prefixed `wba_` so they can live next to your own tables.

create extension if not exists btree_gist;

create table if not exists wba_conversations (
  phone       text primary key,
  name        text,
  history     jsonb not null default '[]',
  draft       jsonb not null default '{}',
  paused      boolean not null default false,
  updated_at  timestamptz not null default now()
);

-- WhatsApp re-delivers webhooks. Each message id is handled once.
create table if not exists wba_processed_messages (
  id          text primary key,
  created_at  timestamptz not null default now()
);

create table if not exists wba_bookings (
  id             uuid primary key default gen_random_uuid(),
  service_id     text not null,
  staff_id       text not null,
  phone          text not null,
  customer_name  text not null,
  date           date not null,
  start_min      int  not null check (start_min between 0 and 1439),
  end_min        int  not null check (end_min > start_min and end_min <= 1440),
  status         text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_at     timestamptz not null default now(),
  -- The real double-booking guard: one staff member cannot have two
  -- overlapping confirmed bookings, however many servers race for the slot.
  constraint wba_no_overlap exclude using gist (
    staff_id with =,
    date with =,
    int4range(start_min, end_min) with &&
  ) where (status = 'confirmed')
);

create index if not exists wba_bookings_phone_idx on wba_bookings (phone, date) where status = 'confirmed';

-- Server-only tables: RLS on, no policies. Only the service role key can read or write.
alter table wba_conversations enable row level security;
alter table wba_processed_messages enable row level security;
alter table wba_bookings enable row level security;
