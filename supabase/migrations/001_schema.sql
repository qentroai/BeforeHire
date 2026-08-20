
create extension if not exists pgcrypto;


create table if not exists public.profiles(
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.companies(
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.company_memberships(
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  role text not null default 'admin',
  primary key(user_id,company_id)
);

create or replace function public.is_company_member(target_company uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.company_memberships
  where user_id=auth.uid() and company_id=target_company);
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
declare c_id uuid;
begin

  if length(trim(coalesce(new.raw_user_meta_data->>'full_name',''))) < 2
     or length(trim(coalesce(new.raw_user_meta_data->>'company_name',''))) < 2
  then raise exception 'Name and company name are required.'; end if;

  insert into public.profiles(id,full_name)
  values(new.id,trim(new.raw_user_meta_data->>'full_name'));

  insert into public.companies(name)
  values(trim(new.raw_user_meta_data->>'company_name')) returning id into c_id;

  insert into public.company_memberships(user_id,company_id,role)
  values(new.id,c_id,'admin');
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

create table if not exists public.sources(
  id uuid primary key default gen_random_uuid(),
  state text,
  category text,
  agency text not null,
  title text,
  url text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.source_snapshots(
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete cascade,
  retrieved_at timestamptz not null default now(),
  http_status integer,
  content_hash text,
  cleaned_text text,
  changed_from_previous boolean,
  fetch_error text,
  review_needed boolean not null default true
);
create table if not exists public.requirements(
  id uuid primary key default gen_random_uuid(),
  state text not null,
  category text not null,
  unique(state,category)
);
create table if not exists public.requirement_versions(
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references public.requirements(id) on delete cascade,
  source_id uuid references public.sources(id),
  status text not null check(status in('green','yellow','red')),
  requirement_text text not null,
  action_text text,
  responsible_role text,
  deadline_text text,
  effective_from date,
  effective_to date,
  verified_at timestamptz not null,
  approved boolean not null default false,
  active boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.minimum_wages(
  id uuid primary key default gen_random_uuid(),
  state text not null,
  hourly_rate numeric(10,2) not null,
  effective_from date not null,
  effective_to date,
  source_id uuid references public.sources(id),
  verified_at timestamptz not null,
  approved boolean not null default false
);
create table if not exists public.contractor_overlays(
  id uuid primary key default gen_random_uuid(),
  state text not null,
  status text not null check(status in('green','yellow','red')),
  note_text text not null,
  action_text text not null,
  responsible_role text,
  deadline_text text,
  source_id uuid references public.sources(id),
  verified_at timestamptz not null,
  approved boolean not null default false,
  active boolean not null default false
);

create table if not exists public.hiring_cases(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  worker_name text,
  role text not null,
  company_state text not null,
  worker_state text not null,
  worker_type text not null,
  arrangement text,
  employment_basis text,
  compensation_text text,
  start_date date,
  overall_status text not null check(overall_status in('green','yellow','red')),
  rule_engine_version text not null,
  result_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.case_events(
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.hiring_cases(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid references auth.users(id),
  event_type text not null,
  event_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_memberships enable row level security;
alter table public.hiring_cases enable row level security;
alter table public.case_events enable row level security;
alter table public.sources enable row level security;
alter table public.requirements enable row level security;
alter table public.requirement_versions enable row level security;
alter table public.minimum_wages enable row level security;
alter table public.contractor_overlays enable row level security;
alter table public.source_snapshots enable row level security;

create policy profiles_self on public.profiles for select to authenticated using(id=auth.uid());
create policy companies_member on public.companies for select to authenticated using(public.is_company_member(id));
create policy memberships_self on public.company_memberships for select to authenticated using(user_id=auth.uid());
create policy cases_select on public.hiring_cases for select to authenticated using(public.is_company_member(company_id));
create policy cases_insert on public.hiring_cases for insert to authenticated
with check(public.is_company_member(company_id) and created_by=auth.uid());
create policy cases_update on public.hiring_cases for update to authenticated
using(public.is_company_member(company_id)) with check(public.is_company_member(company_id));
create policy events_select on public.case_events for select to authenticated using(public.is_company_member(company_id));
create policy events_insert on public.case_events for insert to authenticated
with check(public.is_company_member(company_id) and created_by=auth.uid());

create policy sources_read on public.sources for select to authenticated using(active=true);
create policy requirements_read on public.requirements for select to authenticated using(true);
create policy req_versions_read on public.requirement_versions for select to authenticated using(approved=true);
create policy wages_read on public.minimum_wages for select to authenticated using(approved=true);
create policy overlays_read on public.contractor_overlays for select to authenticated using(approved=true);

grant usage on schema public to authenticated;
grant select on public.profiles,public.companies,public.company_memberships to authenticated;
grant select,insert,update on public.hiring_cases to authenticated;
grant select,insert on public.case_events to authenticated;
grant select on public.sources,public.requirements,public.requirement_versions,public.minimum_wages,public.contractor_overlays to authenticated;
