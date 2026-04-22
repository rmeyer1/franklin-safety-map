create table if not exists enrichment_runs (
  id uuid primary key default gen_random_uuid(),
  source_call_id uuid not null references source_calls(id) on delete cascade,
  enrichment_job_id uuid references enrichment_jobs(id) on delete set null,
  transcript_text text,
  transcription_provider text,
  extraction jsonb not null default '{}'::jsonb,
  geocoding jsonb not null default '{}'::jsonb,
  outcome text not null check (outcome in ('published', 'skipped', 'failed')),
  created_at timestamptz not null default now()
);

create index if not exists enrichment_runs_source_call_idx
  on enrichment_runs (source_call_id, created_at desc);

create index if not exists enrichment_runs_job_idx
  on enrichment_runs (enrichment_job_id);
