create extension if not exists postgis;
create extension if not exists pgcrypto;

create table if not exists incidents (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_event_id text,
  layer text not null check (layer in ('police', 'fire', 'ems', 'traffic', 'transit')),
  category text not null,
  address text not null default '',
  description text not null,
  severity integer not null check (severity between 1 and 5),
  status text not null default 'Active' check (status in ('Active', 'Resolved', 'Archived')),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  location geography(Point, 4326) not null,
  metadata jsonb not null default '{}'::jsonb
);

create unique index if not exists incidents_source_event_idx
  on incidents (source, source_event_id)
  where source_event_id is not null;

create index if not exists incidents_status_occurred_idx
  on incidents (status, occurred_at desc);
