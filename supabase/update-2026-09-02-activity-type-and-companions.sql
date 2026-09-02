-- Safe update for activity types and companion-aware duplicate check-ins.
-- Apply this in Supabase SQL editor before/with the app deploy.

alter table public.completions
  add column if not exists activity_type text not null default 'bate_volta';

alter table public.completions
  drop constraint if exists completions_activity_type_check;

alter table public.completions
  add constraint completions_activity_type_check
  check (activity_type in ('bate_volta', 'ataque', 'trekking', 'travessia', 'acampamento'));

drop function if exists public.upsert_completion(text);
drop function if exists public.upsert_completion(text, text);
drop function if exists public.upsert_completion(text, text, text);
drop function if exists public.upsert_completion(text, text, text, jsonb);
drop function if exists public.upsert_completion(text, text, text, jsonb, text);
drop function if exists public.upsert_completion(text, text, text, jsonb, text, text);

create or replace function public.upsert_completion(
  p_peak_id text,
  p_completion_id text default null,
  p_completion_date text default null,
  p_participants jsonb default '[]'::jsonb,
  p_activity_type text default 'bate_volta',
  p_wikiloc_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_completion_id text;
  v_completion_date date;
  v_completion_label text;
  v_peak_exists boolean;
  v_existing public.completions;
  v_current_participant_name text;
  v_duplicate_participants text;
begin
  if auth.uid() is null then
    raise exception 'forbidden';
  end if;

  select exists (
    select 1
    from public.peaks p
    where p.id = p_peak_id
  ) into v_peak_exists;

  if not v_peak_exists then
    raise exception 'peak not found';
  end if;

  v_completion_date := public.parse_snapshot_date(p_completion_date);
  v_completion_label := nullif(trim(coalesce(p_completion_date, '')), '');
  if v_completion_label is null or v_completion_label !~ '^\d{2}/\d{2}/\d{4}$' then
    v_completion_label := public.to_br_date(v_completion_date);
  end if;

  v_completion_id := nullif(trim(coalesce(p_completion_id, '')), '');
  if v_completion_id is null then
    select c.id
    into v_completion_id
    from public.completions c
    where c.peak_id = p_peak_id
      and c.owner_user_id = auth.uid()
      and c.completion_date = v_completion_date
    limit 1;
  end if;

  if v_completion_id is null then
    v_completion_id := gen_random_uuid()::text;
  end if;

  select *
  into v_existing
  from public.completions c
  where c.id = v_completion_id;

  if found then
    if v_existing.owner_user_id is distinct from auth.uid()
      and not public.is_current_user_admin()
      and not (
        v_existing.owner_user_id is null
        and exists (
          select 1
          from public.completion_participants cp
          join public.app_users u
            on lower(cp.participant_name) = lower(u.display_name)
            or lower(cp.participant_name) = lower(u.username)
          where cp.completion_id = v_existing.id
            and u.auth_user_id = auth.uid()
            and u.is_active = true
        )
      )
    then
      raise exception 'forbidden';
    end if;
  end if;

  select coalesce(nullif(trim(u.display_name), ''), nullif(trim(u.username), ''))
  into v_current_participant_name
  from public.app_users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1;

  v_current_participant_name := coalesce(v_current_participant_name, auth.uid()::text);

  if p_participants is not null and jsonb_typeof(p_participants) <> 'array' then
    raise exception 'participants must be a JSON array';
  end if;

  with payload_participants as (
    select distinct btrim(participant_value) as participant_name
    from jsonb_array_elements_text(coalesce(p_participants, '[]'::jsonb)) as participant_items(participant_value)
    where btrim(participant_value) <> ''
    union
    select v_current_participant_name
  )
  select string_agg(pp.participant_name, ', ' order by pp.participant_name)
  into v_duplicate_participants
  from payload_participants pp
  where exists (
    select 1
    from public.completions c
    join public.completion_participants cp
      on cp.completion_id = c.id
    where c.peak_id = p_peak_id
      and c.completion_date = v_completion_date
      and c.id <> v_completion_id
      and lower(cp.participant_name) = lower(pp.participant_name)
  );

  if v_duplicate_participants is not null then
    raise exception 'duplicate check-in for participants: %', v_duplicate_participants;
  end if;

  insert into public.completions (
    id,
    peak_id,
    owner_user_id,
    completion_date,
    completion_date_label,
    activity_type,
    wikiloc_url
  )
  values (
    v_completion_id,
    p_peak_id,
    coalesce(v_existing.owner_user_id, auth.uid()),
    v_completion_date,
    v_completion_label,
    case
      when p_activity_type in ('bate_volta', 'ataque', 'trekking', 'travessia', 'acampamento') then p_activity_type
      else 'bate_volta'
    end,
    nullif(trim(coalesce(p_wikiloc_url, '')), '')
  )
  on conflict (id)
  do update set
    peak_id = excluded.peak_id,
    completion_date = excluded.completion_date,
    completion_date_label = excluded.completion_date_label,
    activity_type = excluded.activity_type,
    wikiloc_url = excluded.wikiloc_url,
    updated_at = now();

  delete from public.completion_participants
  where completion_id = v_completion_id;

  insert into public.completion_participants (completion_id, participant_name, sort_order)
  select v_completion_id, participant_name, row_number() over (order by sort_order, participant_name)
  from (
    select distinct on (lower(participant_name))
      participant_name,
      sort_order
    from (
      select v_current_participant_name as participant_name, 0 as sort_order
      union all
      select btrim(participant_value) as participant_name, participant_order::integer as sort_order
      from jsonb_array_elements_text(coalesce(p_participants, '[]'::jsonb)) with ordinality as participant_items(participant_value, participant_order)
      where btrim(participant_value) <> ''
    ) participant_payload
    order by lower(participant_name), sort_order
  ) normalized_participants
  on conflict (completion_id, participant_name)
  do update set sort_order = excluded.sort_order;

  return jsonb_build_object(
    'id', v_completion_id,
    'date', v_completion_label,
    'participants', coalesce(
      (
        select jsonb_agg(cp.participant_name order by cp.sort_order, cp.participant_name)
        from public.completion_participants cp
        where cp.completion_id = v_completion_id
      ),
      '[]'::jsonb
    ),
    'ownerUserId', coalesce(v_existing.owner_user_id, auth.uid())::text,
    'activityType', case
      when p_activity_type in ('bate_volta', 'ataque', 'trekking', 'travessia', 'acampamento') then p_activity_type
      else 'bate_volta'
    end,
    'wikilocUrl', nullif(trim(coalesce(p_wikiloc_url, '')), '')
  );
end;
$$;

create or replace function public.get_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with completion_json as (
  select
    c.peak_id,
    jsonb_agg(
      jsonb_strip_nulls(
        jsonb_build_object(
          'id', c.id,
          'date', c.completion_date_label,
          'ownerUserId', c.owner_user_id,
          'activityType', c.activity_type,
          'participants', coalesce(
            (
              select jsonb_agg(cp.participant_name order by cp.sort_order, cp.participant_name)
              from public.completion_participants cp
              where cp.completion_id = c.id
            ),
            '[]'::jsonb
          ),
          'wikilocUrl', nullif(c.wikiloc_url, '')
        )
      )
      order by c.sort_order, c.created_at
    ) as completions
  from public.completions c
  group by c.peak_id
),
peak_json as (
  select
    p.range_id,
    p.id as peak_id,
    p.sort_order,
    jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'tipo_local', p.tipo_local::text,
      'altitude_metros', p.altitude_metros,
      'altura_queda_metros', p.altura_queda_metros,
      'estado', p.estado,
      'category', case when p.tipo_local = 'cachoeira' then 'WATERFALL' else 'PEAK' end,
      'completions', coalesce(cj.completions, '[]'::jsonb)
    ) as peak_obj
  from public.peaks p
  left join completion_json cj on cj.peak_id = p.id
)
select coalesce(
  jsonb_agg(
    jsonb_build_object(
      'id', mr.id,
      'name', mr.name,
      'totalPeaks', (
        select count(*)
        from public.peaks p
        where p.range_id = mr.id
          and p.tipo_local in ('pico', 'morro')
      ),
      'completedPeaks', (
        select count(*)
        from public.peaks p
        where p.range_id = mr.id
          and p.tipo_local in ('pico', 'morro')
          and exists (select 1 from public.completions c where c.peak_id = p.id)
      ),
      'peaks', coalesce(
        (
          select jsonb_agg(pj.peak_obj order by pj.sort_order, pj.peak_id)
          from peak_json pj
          where pj.range_id = mr.id
        ),
        '[]'::jsonb
      )
    )
    order by mr.sort_order, mr.id
  ),
  '[]'::jsonb
)
from public.mountain_ranges mr;
$$;

grant execute on function public.get_snapshot() to authenticated;
grant execute on function public.upsert_completion(text, text, text, jsonb, text, text) to authenticated;
