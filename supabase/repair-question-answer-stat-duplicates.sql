-- Repairs duplicate derived answer statistics that can block schema.sql.
-- Safe to retry. Conflicting payloads abort the transaction without changes.

begin;

set local lock_timeout = '15s';
set local statement_timeout = '2min';
lock table public."QuestionAnswerStat" in share row exclusive mode;

do $$
begin
  if exists (
    select 1
    from public."QuestionAnswerStat"
    group by "questionId", "normalizedAnswer"
    having count(*) > 1
       and count(distinct row("displayAnswer", count, percentage)) > 1
  ) then
    raise exception 'Conflicting QuestionAnswerStat duplicates found; no rows were changed';
  end if;
end
$$;

create schema if not exists maintenance;
revoke all on schema maintenance from public, anon, authenticated;

create table if not exists maintenance.question_answer_stat_duplicate_backup (
  id uuid primary key,
  "questionId" uuid not null,
  "normalizedAnswer" text not null,
  "displayAnswer" text not null,
  count integer not null,
  percentage double precision not null,
  "archivedAt" timestamptz not null default timezone('utc', now())
);
revoke all on maintenance.question_answer_stat_duplicate_backup from public, anon, authenticated;

with duplicate_keys as (
  select "questionId", "normalizedAnswer"
  from public."QuestionAnswerStat"
  group by "questionId", "normalizedAnswer"
  having count(*) > 1
)
insert into maintenance.question_answer_stat_duplicate_backup (
  id,
  "questionId",
  "normalizedAnswer",
  "displayAnswer",
  count,
  percentage
)
select
  stat.id,
  stat."questionId",
  stat."normalizedAnswer",
  stat."displayAnswer",
  stat.count,
  stat.percentage
from public."QuestionAnswerStat" stat
join duplicate_keys duplicate
  on duplicate."questionId" = stat."questionId"
 and duplicate."normalizedAnswer" = stat."normalizedAnswer"
on conflict (id) do nothing;

do $$
begin
  if exists (
    with duplicate_keys as (
      select "questionId", "normalizedAnswer"
      from public."QuestionAnswerStat"
      group by "questionId", "normalizedAnswer"
      having count(*) > 1
    )
    select 1
    from public."QuestionAnswerStat" stat
    join duplicate_keys duplicate
      on duplicate."questionId" = stat."questionId"
     and duplicate."normalizedAnswer" = stat."normalizedAnswer"
    left join maintenance.question_answer_stat_duplicate_backup backup
      on backup.id = stat.id
    where backup.id is null
       or row(
         backup."questionId",
         backup."normalizedAnswer",
         backup."displayAnswer",
         backup.count,
         backup.percentage
       ) is distinct from row(
         stat."questionId",
         stat."normalizedAnswer",
         stat."displayAnswer",
         stat.count,
         stat.percentage
       )
  ) then
    raise exception 'QuestionAnswerStat backup verification failed; no rows were changed';
  end if;
end
$$;

with ranked as (
  select
    id,
    row_number() over (
      partition by "questionId", "normalizedAnswer"
      order by id
    ) as duplicate_rank
  from public."QuestionAnswerStat"
)
delete from public."QuestionAnswerStat" stat
using ranked
where stat.id = ranked.id
  and ranked.duplicate_rank > 1;

create unique index if not exists "QuestionAnswerStat_questionId_normalizedAnswer_idx"
  on public."QuestionAnswerStat" ("questionId", "normalizedAnswer");

commit;

-- Success returns no rows.
select "questionId", "normalizedAnswer", count(*) as row_count
from public."QuestionAnswerStat"
group by "questionId", "normalizedAnswer"
having count(*) > 1;
