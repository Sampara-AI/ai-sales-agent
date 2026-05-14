-- Queue + Deliverability schema for first production hardening
-- Apply this to your Supabase database (public schema).

create table if not exists public.job_queue (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  type text not null,
  status text not null default 'queued', -- queued | running | succeeded | failed | dead
  priority int not null default 100,
  attempts int not null default 0,
  max_attempts int not null default 5,
  run_after timestamptz not null default now(),
  locked_at timestamptz null,
  locked_by text null,
  locked_until timestamptz null,
  last_error text null,
  payload jsonb not null default '{}'::jsonb
);

create index if not exists job_queue_status_run_after_idx on public.job_queue (status, run_after);
create index if not exists job_queue_type_idx on public.job_queue (type);
create index if not exists job_queue_locked_until_idx on public.job_queue (locked_until);

create or replace function public.claim_job_queue(lock_id text, max_jobs int default 10, lock_seconds int default 600)
returns setof public.job_queue
language plpgsql
as $$
declare
  v_now timestamptz := now();
begin
  return query
  with candidates as (
    select id
    from public.job_queue
    where
      (status = 'queued' and run_after <= v_now)
      or (status = 'running' and locked_until is not null and locked_until <= v_now)
    order by priority asc, created_at asc
    for update skip locked
    limit greatest(1, least(50, max_jobs))
  ), updated as (
    update public.job_queue jq
    set
      status = 'running',
      locked_at = v_now,
      locked_by = lock_id,
      locked_until = v_now + make_interval(secs => lock_seconds),
      updated_at = v_now
    where jq.id in (select id from candidates)
    returning jq.*
  )
  select * from updated;
end;
$$;

create table if not exists public.email_suppressions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  email text not null,
  reason text not null,
  source text null,
  meta jsonb not null default '{}'::jsonb
);

create unique index if not exists email_suppressions_email_idx on public.email_suppressions (lower(email));

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_user_id uuid null,
  actor_email text null,
  action text not null,
  entity_type text null,
  entity_id text null,
  meta jsonb not null default '{}'::jsonb
);

-- Minimal inbox tables (for Gmail/Graph ingestion later)
create table if not exists public.inbox_threads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  mailbox text not null,
  external_id text not null,
  subject text null,
  prospect_id uuid null,
  last_message_at timestamptz null
);

create unique index if not exists inbox_threads_mailbox_external_id_idx on public.inbox_threads (mailbox, external_id);

create table if not exists public.inbox_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  mailbox text not null,
  thread_external_id text not null,
  external_id text not null,
  direction text not null, -- inbound | outbound
  from_email text null,
  to_email text null,
  subject text null,
  snippet text null,
  raw jsonb not null default '{}'::jsonb,
  classification text null
);

create unique index if not exists inbox_messages_mailbox_external_id_idx on public.inbox_messages (mailbox, external_id);

alter table public.prospects
  add column if not exists domain text;

alter table public.hunting_campaigns
  add column if not exists require_manual_review boolean not null default false;

create extension if not exists vector;

create table if not exists public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  source text null,
  content_type text null,
  content_text text not null default '',
  status text not null default 'ready',
  meta jsonb not null default '{}'::jsonb
);

create table if not exists public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  document_id uuid not null references public.knowledge_documents(id) on delete cascade,
  chunk_index int not null default 0,
  content text not null,
  embedding vector(1536),
  meta jsonb not null default '{}'::jsonb
);

create index if not exists knowledge_chunks_document_id_idx on public.knowledge_chunks (document_id);

create index if not exists knowledge_chunks_embedding_idx on public.knowledge_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create or replace function public.match_knowledge_chunks(
  query_embedding text,
  match_count int default 6
)
returns table (
  id uuid,
  document_id uuid,
  content text,
  similarity float
)
language sql stable
as $$
  select
    kc.id,
    kc.document_id,
    kc.content,
    1 - (kc.embedding <=> query_embedding::vector(1536)) as similarity
  from public.knowledge_chunks kc
  where kc.embedding is not null
  order by kc.embedding <=> query_embedding::vector(1536)
  limit greatest(1, least(20, match_count));
$$;

alter table public.inbox_messages
  add column if not exists intent text null,
  add column if not exists escalated boolean not null default false,
  add column if not exists ai_summary text null,
  add column if not exists ai_next_action text null,
  add column if not exists ai_confidence int null,
  add column if not exists ai_draft_subject text null,
  add column if not exists ai_draft_body text null,
  add column if not exists knowledge_refs jsonb not null default '[]'::jsonb,
  add column if not exists processed_at timestamptz null;
