alter table incidents
  add column if not exists source_call_id uuid references source_calls(id) on delete set null,
  add column if not exists enrichment_run_id uuid references enrichment_runs(id) on delete set null;

create index if not exists incidents_source_call_idx
  on incidents (source_call_id);

create index if not exists incidents_enrichment_run_idx
  on incidents (enrichment_run_id);
