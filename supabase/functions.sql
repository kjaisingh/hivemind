begin;

create or replace function public.save_draft_round(p_game_id uuid, p_round_id uuid, p_details jsonb, p_questions jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  target public."Round";
  round_id uuid := p_round_id;
begin
  if jsonb_array_length(p_questions) not between 1 and 20 then
    raise exception 'Rounds need between 1 and 20 questions.' using errcode = 'PT400';
  end if;
  if round_id is null then
    insert into public."Round" ("gameId", name, description, "startsAt", "expiresAt")
    values (p_game_id, p_details->>'name', p_details->>'description', (p_details->>'startsAt')::timestamptz, (p_details->>'expiresAt')::timestamptz)
    returning id into round_id;
  else
    select * into target from public."Round" where id = round_id and "gameId" = p_game_id for update;
    if not found then raise exception 'Round not found.' using errcode = 'PT404'; end if;
    if target.status <> 'DRAFT' then raise exception 'Only draft rounds can be edited.' using errcode = 'PT409'; end if;
    update public."Round" set name = p_details->>'name', description = p_details->>'description',
      "startsAt" = (p_details->>'startsAt')::timestamptz, "expiresAt" = (p_details->>'expiresAt')::timestamptz
      where id = round_id;
    delete from public."Question" where "roundId" = round_id;
  end if;
  insert into public."Question" ("roundId", prompt, type, choices, position)
  select round_id, value->>'prompt', coalesce(value->>'type', 'TEXT'),
    case when value->>'type' = 'MULTIPLE_CHOICE' then value->'choices' else null end, ordinality
  from jsonb_array_elements(p_questions) with ordinality;
  return round_id;
end;
$$;

create or replace function public.publish_round(p_game_id uuid, p_round_id uuid, p_announcement text)
returns void language plpgsql security invoker set search_path = public as $$
declare target public."Round";
begin
  select * into target from public."Round" where id = p_round_id and "gameId" = p_game_id for update;
  if not found then raise exception 'Round not found.' using errcode = 'PT404'; end if;
  if target.status <> 'DRAFT' then raise exception 'Only draft rounds can be published.' using errcode = 'PT409'; end if;
  if target."startsAt" > clock_timestamp() then raise exception 'Round cannot be published before its start time.' using errcode = 'PT400'; end if;
  if target."expiresAt" <= clock_timestamp() then raise exception 'Round expiry must be in the future.' using errcode = 'PT400'; end if;
  if not exists (select 1 from public."Question" where "roundId" = p_round_id) then
    raise exception 'Add at least one question before publishing.' using errcode = 'PT400';
  end if;
  update public."Round" set status = 'ACTIVE', "publishedAt" = clock_timestamp(), "announcementEmail" = p_announcement where id = p_round_id;
exception when unique_violation then
  raise exception 'Another round is already active.' using errcode = 'PT409';
end;
$$;

create or replace function public.save_round_answers(p_round_id uuid, p_user_id uuid, p_answers jsonb)
returns void language plpgsql security invoker set search_path = public as $$
declare target public."Round";
begin
  select * into target from public."Round" where id = p_round_id for update;
  if not found then raise exception 'Round not found.' using errcode = 'PT404'; end if;
  if target.status <> 'ACTIVE' or target."expiresAt" <= clock_timestamp() then
    raise exception 'Round is closed.' using errcode = 'PT409';
  end if;
  if not exists (select 1 from public."GameMembership" where "gameId" = target."gameId" and "userId" = p_user_id) then
    raise exception 'Not part of this game.' using errcode = 'PT403';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_answers) answer
    left join public."Question" q on q.id = (answer->>'questionId')::uuid and q."roundId" = p_round_id
    where q.id is null or (answer->>'rawAnswer' <> '' and q.type = 'MULTIPLE_CHOICE' and not q.choices ? (answer->>'rawAnswer'))
  ) then raise exception 'Answer is not valid for this round.' using errcode = 'PT400'; end if;
  delete from public."Submission" where "userId" = p_user_id and "questionId" in (
    select (value->>'questionId')::uuid from jsonb_array_elements(p_answers) where value->>'rawAnswer' = ''
  );
  insert into public."Submission" ("questionId", "userId", "rawAnswer", "normalizedAnswer")
  select (value->>'questionId')::uuid, p_user_id, value->>'rawAnswer', value->>'normalizedAnswer'
  from jsonb_array_elements(p_answers) where value->>'rawAnswer' <> ''
  on conflict ("questionId", "userId") do update
    set "rawAnswer" = excluded."rawAnswer", "normalizedAnswer" = excluded."normalizedAnswer";
end;
$$;

create or replace function public.promote_suggestion(p_game_id uuid, p_round_id uuid, p_suggestion_id uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare
  target public."Round";
  suggestion public."QuestionSuggestion";
  question_count integer;
  next_position integer;
begin
  select * into target from public."Round" where id = p_round_id and "gameId" = p_game_id for update;
  if not found then raise exception 'Round not found.' using errcode = 'PT404'; end if;
  if target.status <> 'DRAFT' then raise exception 'Suggestions can only be promoted into draft rounds.' using errcode = 'PT409'; end if;
  select * into suggestion from public."QuestionSuggestion" where id = p_suggestion_id and "gameId" = p_game_id for update;
  if not found then raise exception 'Suggestion not found.' using errcode = 'PT404'; end if;
  if suggestion.status <> 'PENDING' then raise exception 'Suggestion was already reviewed.' using errcode = 'PT409'; end if;
  select count(*), coalesce(max(position), 0) + 1 into question_count, next_position from public."Question" where "roundId" = p_round_id;
  if question_count >= 20 then raise exception 'Round already has the maximum 20 questions.' using errcode = 'PT409'; end if;
  insert into public."Question" ("roundId", prompt, position) values (p_round_id, suggestion.prompt, next_position);
  update public."QuestionSuggestion" set status = 'PROMOTED', "promotedRoundId" = p_round_id where id = p_suggestion_id;
end;
$$;

create or replace function public.close_round(p_round_id uuid)
returns boolean language plpgsql security invoker set search_path = public as $$
declare target public."Round";
begin
  select * into target from public."Round" where id = p_round_id for update;
  if not found or target.status <> 'ACTIVE' or target."expiresAt" > clock_timestamp() then return false; end if;

  delete from public."QuestionAnswerStat" where "questionId" in (select id from public."Question" where "roundId" = p_round_id);
  insert into public."QuestionAnswerStat" ("questionId", "normalizedAnswer", "displayAnswer", count, percentage)
  with variants as (
    select s."questionId", case when q.type = 'MULTIPLE_CHOICE' then s."rawAnswer" else coalesce(nullif(s."normalizedAnswer", ''), s."rawAnswer") end as answer_key,
      regexp_replace(trim(s."rawAnswer"), '\s+', ' ', 'g') as display_answer, count(*) as variant_count
    from public."Submission" s join public."Question" q on q.id = s."questionId"
    where q."roundId" = p_round_id
    group by s."questionId", answer_key, display_answer
  ), grouped as (
    select "questionId", answer_key, (array_agg(display_answer order by variant_count desc, display_answer))[1] as display_answer,
      sum(variant_count) as response_count
    from variants group by "questionId", answer_key
  )
  select "questionId", answer_key, display_answer, response_count::integer,
    (100.0 * response_count / sum(response_count) over (partition by "questionId"))::double precision
  from grouped;

  delete from public."RoundScore" where "roundId" = p_round_id;
  insert into public."RoundScore" ("roundId", "userId", "totalScore", rank, "medalAwarded")
  with earned as (
    select s."userId", sum(a.count)::integer as points
    from public."Submission" s join public."Question" q on q.id = s."questionId"
    join public."QuestionAnswerStat" a on a."questionId" = q.id
      and a."normalizedAnswer" = case when q.type = 'MULTIPLE_CHOICE' then s."rawAnswer" else coalesce(nullif(s."normalizedAnswer", ''), s."rawAnswer") end
    where q."roundId" = p_round_id group by s."userId"
  ), totals as (
    select m."userId", coalesce(e.points, 0) as points
    from public."GameMembership" m left join earned e on e."userId" = m."userId"
    where m."gameId" = target."gameId"
  ), ranked as (
    select *, rank() over (order by points desc)::integer as place from totals
  )
  select p_round_id, "userId", points, place, place = 1 and points > 0 from ranked;
  update public."Round" set status = 'CLOSED' where id = p_round_id;
  return true;
end;
$$;

revoke all on function public.save_draft_round(uuid, uuid, jsonb, jsonb), public.publish_round(uuid, uuid, text),
  public.save_round_answers(uuid, uuid, jsonb), public.promote_suggestion(uuid, uuid, uuid), public.close_round(uuid) from public, anon, authenticated;
grant execute on function public.save_draft_round(uuid, uuid, jsonb, jsonb), public.publish_round(uuid, uuid, text),
  public.save_round_answers(uuid, uuid, jsonb), public.promote_suggestion(uuid, uuid, uuid), public.close_round(uuid) to service_role;

commit;
