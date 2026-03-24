-- COMPLETE DATABASE MODEL (normalized)
-- Source of truth:
-- - mountain_ranges
-- - peaks
-- - completions
-- - completion_participants
--
-- RPC:
-- - get_snapshot()       -> returns app payload as jsonb array
-- - replace_snapshot(x)  -> replaces all data from payload array
--
-- Legacy table app_state is removed at the end of this script.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('ADMIN', 'USER');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'local_type') then
    create type public.local_type as enum ('pico', 'morro', 'trilha', 'ilha', 'cachoeira');
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_type where typname = 'local_type')
    and not exists (
      select 1
      from pg_enum
      where enumtypid = 'public.local_type'::regtype
        and enumlabel = 'ilha'
    ) then
    alter type public.local_type add value 'ilha' after 'trilha';
  end if;
end $$;

create table if not exists public.app_users (
  username text primary key,
  display_name text not null,
  role public.app_role not null default 'USER',
  avatar_url text,
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_users
  add column if not exists auth_user_id uuid,
  add column if not exists email text;

create table if not exists public.mountain_ranges (
  id text primary key,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.peaks (
  id text primary key,
  range_id text not null references public.mountain_ranges(id) on delete cascade,
  name text not null,
  tipo_local public.local_type not null default 'pico',
  altitude_metros integer,
  altura_queda_metros integer,
  estado text not null default 'Parana',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint peaks_altitude_non_negative check (altitude_metros is null or altitude_metros >= 0),
  constraint peaks_drop_height_non_negative check (altura_queda_metros is null or altura_queda_metros >= 0)
);

create table if not exists public.completions (
  id text primary key,
  peak_id text not null references public.peaks(id) on delete cascade,
  owner_user_id uuid references auth.users(id) on delete set null,
  completion_date date not null,
  completion_date_label text not null,
  wikiloc_url text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.completions
  add column if not exists owner_user_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'completions_owner_user_id_fkey'
      and conrelid = 'public.completions'::regclass
  ) then
    alter table public.completions
      add constraint completions_owner_user_id_fkey
      foreign key (owner_user_id)
      references auth.users(id)
      on delete set null;
  end if;
end $$;

create table if not exists public.completion_participants (
  completion_id text not null references public.completions(id) on delete cascade,
  participant_name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (completion_id, participant_name)
);

create index if not exists idx_peaks_range_id on public.peaks(range_id);
create index if not exists idx_peaks_tipo_local on public.peaks(tipo_local);
create index if not exists idx_completions_peak_id on public.completions(peak_id);
create index if not exists idx_completions_owner_user_id on public.completions(owner_user_id);
create index if not exists idx_completion_participants_completion_id on public.completion_participants(completion_id);
create unique index if not exists idx_app_users_auth_user_id_unique
  on public.app_users(auth_user_id)
  where auth_user_id is not null;
create unique index if not exists idx_app_users_email_unique
  on public.app_users(lower(email))
  where email is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'app_users_auth_user_id_fkey'
      and conrelid = 'public.app_users'::regclass
  ) then
    alter table public.app_users
      add constraint app_users_auth_user_id_fkey
      foreign key (auth_user_id)
      references auth.users(id)
      on delete cascade;
  end if;
end $$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists mountain_ranges_touch_updated_at on public.mountain_ranges;
create trigger mountain_ranges_touch_updated_at
before update on public.mountain_ranges
for each row execute function public.touch_updated_at();

drop trigger if exists app_users_touch_updated_at on public.app_users;
create trigger app_users_touch_updated_at
before update on public.app_users
for each row execute function public.touch_updated_at();

drop trigger if exists peaks_touch_updated_at on public.peaks;
create trigger peaks_touch_updated_at
before update on public.peaks
for each row execute function public.touch_updated_at();

drop trigger if exists completions_touch_updated_at on public.completions;
create trigger completions_touch_updated_at
before update on public.completions
for each row execute function public.touch_updated_at();

create or replace function public.normalize_local_type(raw_value text)
returns public.local_type
language plpgsql
immutable
as $$
declare
  normalized text;
begin
  normalized := lower(trim(coalesce(raw_value, '')));
  if normalized = 'cume' then
    return 'pico';
  end if;
  if normalized in ('pico', 'morro', 'trilha', 'ilha', 'cachoeira') then
    return normalized::public.local_type;
  end if;
  return 'pico';
end;
$$;

create or replace function public.parse_snapshot_date(raw_value text)
returns date
language plpgsql
stable
as $$
declare
  parsed_date date;
begin
  if raw_value is null or btrim(raw_value) = '' then
    return current_date;
  end if;

  if raw_value ~ '^\d{2}/\d{2}/\d{4}$' then
    return to_date(raw_value, 'DD/MM/YYYY');
  end if;

  if raw_value ~ '^\d{4}-\d{2}-\d{2}$' then
    return raw_value::date;
  end if;

  begin
    parsed_date := (raw_value::timestamptz)::date;
    return parsed_date;
  exception when others then
    return current_date;
  end;
end;
$$;

create or replace function public.to_br_date(input_date date)
returns text
language sql
immutable
as $$
  select to_char(input_date, 'DD/MM/YYYY');
$$;

create or replace function public.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_users u
    where u.auth_user_id = auth.uid()
      and u.role = 'ADMIN'
      and u.is_active = true
  );
$$;

drop function if exists public.upsert_app_user(text, text, text);
drop function if exists public.list_app_users();
drop function if exists public.list_participant_directory();
drop function if exists public.get_my_app_user();
drop function if exists public.upsert_completion(text, text, text, jsonb, text);
drop function if exists public.delete_completion(text);

create or replace function public.upsert_app_user(
  p_auth_user_id uuid,
  p_email text,
  p_username text,
  p_display_name text,
  p_avatar_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user_id uuid;
  v_email text;
  v_username text;
  v_display_name text;
  v_avatar_url text;
  v_role public.app_role;
  v_row public.app_users;
begin
  v_auth_user_id := p_auth_user_id;
  v_email := lower(trim(coalesce(p_email, '')));
  v_username := lower(trim(coalesce(p_username, '')));
  v_display_name := nullif(trim(coalesce(p_display_name, '')), '');
  v_avatar_url := nullif(trim(coalesce(p_avatar_url, '')), '');

  if v_auth_user_id is null then
    raise exception 'auth_user_id is required';
  end if;

  if auth.uid() is null or auth.uid() <> v_auth_user_id then
    raise exception 'forbidden';
  end if;

  if v_email = '' then
    raise exception 'email is required';
  end if;

  if v_username = '' then
    v_username := split_part(v_email, '@', 1);
  end if;

  if v_username = '' then
    raise exception 'username is required';
  end if;

  if v_display_name is null then
    v_display_name := v_username;
  end if;

  v_role := case
    when v_email = 'huboox.rec@gmail.com' then 'ADMIN'
    else 'USER'
  end;

  update public.app_users
  set
    email = v_email,
    display_name = v_display_name,
    role = v_role,
    avatar_url = coalesce(v_avatar_url, avatar_url),
    is_active = true,
    last_login_at = now(),
    updated_at = now()
  where auth_user_id = v_auth_user_id
  returning * into v_row;

  if not found then
    update public.app_users
    set
      auth_user_id = v_auth_user_id,
      email = v_email,
      username = v_username,
      display_name = v_display_name,
      role = v_role,
      avatar_url = coalesce(v_avatar_url, avatar_url),
      is_active = true,
      last_login_at = now(),
      updated_at = now()
    where lower(coalesce(email, '')) = v_email
    returning * into v_row;
  end if;

  if not found then
    update public.app_users
    set
      auth_user_id = v_auth_user_id,
      email = v_email,
      display_name = v_display_name,
      role = v_role,
      avatar_url = coalesce(v_avatar_url, avatar_url),
      is_active = true,
      last_login_at = now(),
      updated_at = now()
    where username = v_username
    returning * into v_row;
  end if;

  if not found then
    insert into public.app_users (
      auth_user_id,
      email,
      username,
      display_name,
      role,
      avatar_url,
      is_active,
      last_login_at
    )
    values (
      v_auth_user_id,
      v_email,
      v_username,
      v_display_name,
      v_role,
      v_avatar_url,
      true,
      now()
    )
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'auth_user_id', v_row.auth_user_id,
    'email', v_row.email,
    'username', v_row.username,
    'display_name', v_row.display_name,
    'role', v_row.role::text,
    'avatar_url', v_row.avatar_url,
    'is_active', v_row.is_active,
    'last_login_at', v_row.last_login_at
  );
end;
$$;

create or replace function public.reset_app_data(p_include_users boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_current_user_admin() then
    raise exception 'forbidden';
  end if;

  truncate table
    public.completion_participants,
    public.completions,
    public.peaks,
    public.mountain_ranges
  restart identity;

  if p_include_users then
    delete from public.app_users;
  end if;
end;
$$;

create or replace function public.list_app_users()
returns table (
  auth_user_id uuid,
  email text,
  username text,
  display_name text,
  role text,
  avatar_url text,
  is_active boolean,
  last_login_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'forbidden';
  end if;

  if not public.is_current_user_admin() then
    raise exception 'forbidden';
  end if;

  return query
  select
    u.auth_user_id,
    u.email,
    u.username,
    u.display_name,
    u.role::text as role,
    u.avatar_url,
    u.is_active,
    u.last_login_at,
    u.created_at
  from public.app_users u
  order by
    case when u.role = 'ADMIN' then 0 else 1 end,
    u.last_login_at desc nulls last,
    u.username asc;
end;
$$;

create or replace function public.list_participant_directory()
returns table (
  username text,
  display_name text,
  role text,
  avatar_url text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'forbidden';
  end if;

  return query
  select
    u.username,
    u.display_name,
    u.role::text as role,
    u.avatar_url,
    u.created_at
  from public.app_users u
  where u.is_active = true
  order by
    u.display_name asc,
    u.username asc;
end;
$$;

create or replace function public.get_my_app_user()
returns table (
  auth_user_id uuid,
  email text,
  username text,
  display_name text,
  role text,
  avatar_url text,
  is_active boolean,
  last_login_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'forbidden';
  end if;

  return query
  select
    u.auth_user_id,
    u.email,
    u.username,
    u.display_name,
    u.role::text as role,
    u.avatar_url,
    u.is_active,
    u.last_login_at,
    u.created_at
  from public.app_users u
  where u.auth_user_id = auth.uid()
  limit 1;
end;
$$;

create or replace function public.replace_snapshot(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_range_item jsonb;
  v_peak_item jsonb;
  v_completion_item jsonb;
  v_participant_name text;
  v_range_id text;
  v_peak_id text;
  v_completion_id text;
  v_local_type public.local_type;
  v_completion_date date;
  v_completion_label text;
  v_range_order integer := 0;
  v_peak_order integer;
  v_completion_order integer;
  v_participant_order integer;
begin
  if payload is null or jsonb_typeof(payload) <> 'array' then
    raise exception 'payload must be a JSON array';
  end if;

  if auth.uid() is null or not public.is_current_user_admin() then
    raise exception 'forbidden';
  end if;

  truncate table
    public.completion_participants,
    public.completions,
    public.peaks,
    public.mountain_ranges;

  for v_range_item in select value from jsonb_array_elements(payload)
  loop
    v_range_order := v_range_order + 1;
    v_range_id := coalesce(nullif(v_range_item->>'id', ''), gen_random_uuid()::text);

    insert into public.mountain_ranges (id, name, sort_order)
    values (
      v_range_id,
      coalesce(nullif(v_range_item->>'name', ''), 'Sem nome'),
      v_range_order
    );

    v_peak_order := 0;
    for v_peak_item in select value from jsonb_array_elements(coalesce(v_range_item->'peaks', '[]'::jsonb))
    loop
      v_peak_order := v_peak_order + 1;
      v_peak_id := coalesce(nullif(v_peak_item->>'id', ''), gen_random_uuid()::text);

      if exists (select 1 from public.peaks where id = v_peak_id) then
        v_peak_id := v_range_id || '-' || v_peak_id;
      end if;

      v_local_type := public.normalize_local_type(v_peak_item->>'tipo_local');

      insert into public.peaks (
        id,
        range_id,
        name,
        tipo_local,
        altitude_metros,
        altura_queda_metros,
        estado,
        sort_order
      )
      values (
        v_peak_id,
        v_range_id,
        coalesce(nullif(v_peak_item->>'name', ''), 'Sem nome'),
        v_local_type,
        case when (v_peak_item->>'altitude_metros') ~ '^-?\d+$' then (v_peak_item->>'altitude_metros')::integer else null end,
        case when (v_peak_item->>'altura_queda_metros') ~ '^-?\d+$' then (v_peak_item->>'altura_queda_metros')::integer else null end,
        coalesce(nullif(v_peak_item->>'estado', ''), 'Parana'),
        v_peak_order
      );

      v_completion_order := 0;
      for v_completion_item in select value from jsonb_array_elements(coalesce(v_peak_item->'completions', '[]'::jsonb))
      loop
        v_completion_order := v_completion_order + 1;
        v_completion_id := coalesce(nullif(v_completion_item->>'id', ''), gen_random_uuid()::text);

        if exists (select 1 from public.completions where id = v_completion_id) then
          v_completion_id := v_peak_id || '-' || v_completion_order::text || '-' || gen_random_uuid()::text;
        end if;

        v_completion_date := public.parse_snapshot_date(v_completion_item->>'date');
        v_completion_label := nullif(v_completion_item->>'date', '');
        if v_completion_label is null or v_completion_label !~ '^\d{2}/\d{2}/\d{4}$' then
          v_completion_label := public.to_br_date(v_completion_date);
        end if;

        insert into public.completions (
          id,
          peak_id,
          owner_user_id,
          completion_date,
          completion_date_label,
          wikiloc_url,
          sort_order
        )
        values (
          v_completion_id,
          v_peak_id,
          case
            when (v_completion_item->>'ownerUserId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              then (v_completion_item->>'ownerUserId')::uuid
            else null
          end,
          v_completion_date,
          v_completion_label,
          nullif(v_completion_item->>'wikilocUrl', ''),
          v_completion_order
        );

        v_participant_order := 0;
        for v_participant_name in
          select value
          from jsonb_array_elements_text(coalesce(v_completion_item->'participants', '[]'::jsonb))
        loop
          if v_participant_name is null or btrim(v_participant_name) = '' then
            continue;
          end if;

          v_participant_order := v_participant_order + 1;
          insert into public.completion_participants (completion_id, participant_name, sort_order)
          values (v_completion_id, btrim(v_participant_name), v_participant_order)
          on conflict (completion_id, participant_name) do nothing;
        end loop;
      end loop;
    end loop;
  end loop;
end;
$$;

create or replace function public.upsert_completion(
  p_peak_id text,
  p_completion_id text default null,
  p_completion_date text default null,
  p_participants jsonb default '[]'::jsonb,
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
  v_participant_name text;
  v_participant_order integer := 0;
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

  v_completion_id := nullif(trim(coalesce(p_completion_id, '')), '');
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
    then
      raise exception 'forbidden';
    end if;
  end if;

  v_completion_date := public.parse_snapshot_date(p_completion_date);
  v_completion_label := nullif(trim(coalesce(p_completion_date, '')), '');
  if v_completion_label is null or v_completion_label !~ '^\d{2}/\d{2}/\d{4}$' then
    v_completion_label := public.to_br_date(v_completion_date);
  end if;

  insert into public.completions (
    id,
    peak_id,
    owner_user_id,
    completion_date,
    completion_date_label,
    wikiloc_url
  )
  values (
    v_completion_id,
    p_peak_id,
    coalesce(v_existing.owner_user_id, auth.uid()),
    v_completion_date,
    v_completion_label,
    nullif(trim(coalesce(p_wikiloc_url, '')), '')
  )
  on conflict (id)
  do update set
    peak_id = excluded.peak_id,
    completion_date = excluded.completion_date,
    completion_date_label = excluded.completion_date_label,
    wikiloc_url = excluded.wikiloc_url,
    updated_at = now();

  delete from public.completion_participants
  where completion_id = v_completion_id;

  if p_participants is not null and jsonb_typeof(p_participants) <> 'array' then
    raise exception 'participants must be a JSON array';
  end if;

  for v_participant_name in
    select value
    from jsonb_array_elements_text(coalesce(p_participants, '[]'::jsonb))
  loop
    if v_participant_name is null or btrim(v_participant_name) = '' then
      continue;
    end if;

    v_participant_order := v_participant_order + 1;
    insert into public.completion_participants (completion_id, participant_name, sort_order)
    values (v_completion_id, btrim(v_participant_name), v_participant_order)
    on conflict (completion_id, participant_name)
    do update set sort_order = excluded.sort_order;
  end loop;

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
    'wikilocUrl', nullif(trim(coalesce(p_wikiloc_url, '')), '')
  );
end;
$$;

create or replace function public.delete_completion(
  p_completion_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_user_id uuid;
begin
  if auth.uid() is null then
    raise exception 'forbidden';
  end if;

  select c.owner_user_id
  into v_owner_user_id
  from public.completions c
  where c.id = p_completion_id;

  if not found then
    raise exception 'completion not found';
  end if;

  if v_owner_user_id is distinct from auth.uid()
    and not public.is_current_user_admin()
  then
    raise exception 'forbidden';
  end if;

  delete from public.completions
  where id = p_completion_id;
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

grant execute on function public.is_current_user_admin() to authenticated;
grant execute on function public.get_snapshot() to authenticated;
grant execute on function public.get_my_app_user() to authenticated;
grant execute on function public.replace_snapshot(jsonb) to authenticated;
grant execute on function public.upsert_app_user(uuid, text, text, text, text) to authenticated;
grant execute on function public.upsert_completion(text, text, text, jsonb, text) to authenticated;
grant execute on function public.delete_completion(text) to authenticated;
grant execute on function public.list_app_users() to authenticated;
grant execute on function public.list_participant_directory() to authenticated;
grant execute on function public.reset_app_data(boolean) to authenticated;

revoke all on public.app_users from anon, authenticated;
revoke all on public.mountain_ranges from anon, authenticated;
revoke all on public.peaks from anon, authenticated;
revoke all on public.completions from anon, authenticated;
revoke all on public.completion_participants from anon, authenticated;

alter table public.app_users enable row level security;
alter table public.mountain_ranges enable row level security;
alter table public.peaks enable row level security;
alter table public.completions enable row level security;
alter table public.completion_participants enable row level security;

-- Remove legacy table after migration to normalized model.
drop table if exists public.app_state cascade;
