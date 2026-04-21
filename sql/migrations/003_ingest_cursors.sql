create table if not exists ingest_cursors (
  source text not null,
  cursor_key text not null,
  last_occurred_at_ms bigint not null default 0,
  last_source_event_id text,
  updated_at timestamptz not null default now(),
  primary key (source, cursor_key)
);
