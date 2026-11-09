-- Routed coach telemetry (no prompts or responses stored)
create table if not exists public.coach_model_runs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  route text not null check (route in ('fast', 'main', 'deep', 'safety')),
  model_alias text not null,
  latency_ms integer not null default 0 check (latency_ms >= 0),
  fallback_used boolean not null default false,
  grounding_status text not null default 'unknown',
  evidence_count integer not null default 0 check (evidence_count >= 0),
  prompt_chars integer not null default 0 check (prompt_chars >= 0),
  response_chars integer not null default 0 check (response_chars >= 0),
  prompt_tokens integer,
  output_tokens integer,
  feedback smallint check (feedback in (-1, 1)),
  feedback_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists coach_model_runs_user_created_idx
  on public.coach_model_runs(user_id, created_at desc);
create index if not exists coach_model_runs_route_created_idx
  on public.coach_model_runs(route, created_at desc);

alter table public.coach_model_runs enable row level security;
-- Intentionally no client policies. Netlify functions use the service role and
-- always constrain writes by the JWT-derived user_id. Raw coach content is never stored.
