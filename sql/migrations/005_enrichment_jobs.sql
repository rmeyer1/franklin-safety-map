create table if not exists enrichment_jobs (
  id uuid primary key default gen_random_uuid(),
  source_call_id uuid not null references source_calls(id) on delete cascade,
  job_type text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  priority integer not null default 100,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (source_call_id, job_type)
);

create index if not exists enrichment_jobs_status_available_idx
  on enrichment_jobs (status, available_at asc, priority asc, created_at asc);

create index if not exists enrichment_jobs_source_call_idx
  on enrichment_jobs (source_call_id);
