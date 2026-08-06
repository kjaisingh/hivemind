create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new."updatedAt" = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public."User" (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  username text not null unique,
  "passwordHash" text,
  "googleId" text unique,
  "createdAt" timestamptz not null default timezone('utc', now())
);

create table if not exists public."Game" (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null,
  code text not null unique,
  "inviteToken" text not null unique,
  "createdAt" timestamptz not null default timezone('utc', now()),
  "adminId" uuid not null references public."User"(id)
);

create table if not exists public."GameMembership" (
  id uuid primary key default gen_random_uuid(),
  "gameId" uuid not null references public."Game"(id) on delete cascade,
  "userId" uuid not null references public."User"(id) on delete cascade,
  role text not null default 'PLAYER' check (role in ('ADMIN', 'PLAYER')),
  "joinedAt" timestamptz not null default timezone('utc', now()),
  unique ("gameId", "userId")
);

create index if not exists "GameMembership_userId_idx" on public."GameMembership" ("userId");

create table if not exists public."Round" (
  id uuid primary key default gen_random_uuid(),
  "gameId" uuid not null references public."Game"(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'ACTIVE', 'CLOSED')),
  "startsAt" timestamptz not null,
  "expiresAt" timestamptz not null,
  "publishedAt" timestamptz,
  "announcementEmail" text,
  "createdAt" timestamptz not null default timezone('utc', now())
);

create index if not exists "Round_gameId_idx" on public."Round" ("gameId");

create table if not exists public."Question" (
  id uuid primary key default gen_random_uuid(),
  "roundId" uuid not null references public."Round"(id) on delete cascade,
  prompt text not null,
  position integer not null
);

create index if not exists "Question_roundId_idx" on public."Question" ("roundId");

create table if not exists public."Submission" (
  id uuid primary key default gen_random_uuid(),
  "questionId" uuid not null references public."Question"(id) on delete cascade,
  "userId" uuid not null references public."User"(id) on delete cascade,
  "rawAnswer" text not null,
  "normalizedAnswer" text not null,
  "createdAt" timestamptz not null default timezone('utc', now()),
  "updatedAt" timestamptz not null default timezone('utc', now()),
  unique ("questionId", "userId")
);

create index if not exists "Submission_questionId_idx" on public."Submission" ("questionId");
create index if not exists "Submission_userId_idx" on public."Submission" ("userId");

drop trigger if exists submission_set_updated_at on public."Submission";

create trigger submission_set_updated_at
before update on public."Submission"
for each row
execute function public.set_updated_at();

create table if not exists public."RoundScore" (
  id uuid primary key default gen_random_uuid(),
  "roundId" uuid not null references public."Round"(id) on delete cascade,
  "userId" uuid not null references public."User"(id) on delete cascade,
  "totalScore" integer not null,
  rank integer not null,
  "medalAwarded" boolean not null default false,
  unique ("roundId", "userId")
);

create index if not exists "RoundScore_roundId_idx" on public."RoundScore" ("roundId");

create table if not exists public."QuestionAnswerStat" (
  id uuid primary key default gen_random_uuid(),
  "questionId" uuid not null references public."Question"(id) on delete cascade,
  "normalizedAnswer" text not null,
  "displayAnswer" text not null,
  count integer not null,
  percentage double precision not null
);

create index if not exists "QuestionAnswerStat_questionId_idx" on public."QuestionAnswerStat" ("questionId");

create table if not exists public."GameEmailSettings" (
  id uuid primary key default gen_random_uuid(),
  "gameId" uuid not null unique references public."Game"(id) on delete cascade,
  "autoRoundOpen" boolean not null default true,
  "autoResultsLive" boolean not null default true,
  "expiringHoursCsv" text not null default '24,1'
);

create table if not exists public."EmailDeliveryLog" (
  id uuid primary key default gen_random_uuid(),
  "dedupeKey" text not null unique,
  "gameId" uuid not null references public."Game"(id) on delete cascade,
  "roundId" uuid,
  "recipientId" uuid not null references public."User"(id) on delete cascade,
  "emailType" text not null,
  "sentAt" timestamptz not null default timezone('utc', now())
);

create table if not exists public."Session" (
  sid text primary key,
  sess jsonb not null,
  "expiresAt" timestamptz not null
);

create index if not exists "Session_expiresAt_idx" on public."Session" ("expiresAt");

-- RLS enabled with no policies on every table: blocks anon/authenticated keys entirely.
-- The backend talks to Supabase only via the service_role key, which bypasses RLS by design.
alter table public."User" enable row level security;
alter table public."Game" enable row level security;
alter table public."GameMembership" enable row level security;
alter table public."Round" enable row level security;
alter table public."Question" enable row level security;
alter table public."Submission" enable row level security;
alter table public."RoundScore" enable row level security;
alter table public."QuestionAnswerStat" enable row level security;
alter table public."GameEmailSettings" enable row level security;
alter table public."EmailDeliveryLog" enable row level security;
alter table public."Session" enable row level security;
