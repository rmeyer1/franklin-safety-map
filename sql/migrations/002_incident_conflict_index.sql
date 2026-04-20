drop index if exists incidents_source_event_idx;

create unique index if not exists incidents_source_event_idx
  on incidents (source, source_event_id);
