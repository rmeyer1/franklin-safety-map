create table if not exists source_calls (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  cursor_key text not null,
  source_event_id text not null,
  occurred_at timestamptz not null,
  occurred_at_ms bigint not null,
  audio_url text,
  file_name text,
  transcript_text text,
  channel text,
  label text,
  duration_seconds double precision,
  metadata jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source, source_event_id)
);

create index if not exists source_calls_source_cursor_occurred_idx
  on source_calls (source, cursor_key, occurred_at_ms desc);

create index if not exists source_calls_source_created_idx
  on source_calls (source, created_at desc);
