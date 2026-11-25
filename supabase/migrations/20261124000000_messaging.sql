create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  biography text not null default '',
  public_key text,
  discoverable boolean not null default true,
  disappearing_after_seconds integer not null default 0
    check (disappearing_after_seconds in (0, 3600, 86400, 604800)),
  notifications_enabled boolean not null default true,
  show_notification_previews boolean not null default false,
  biometric_lock boolean not null default false,
  created_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[a-z][a-z0-9_]{2,23}$')
);

create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

create table if not exists public.user_blocks (
  user_id uuid not null references public.profiles(id) on delete cascade,
  blocked_user_id uuid not null references public.profiles(id) on delete cascade,
  blocked_username text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, blocked_user_id),
  constraint user_blocks_not_self check (user_id <> blocked_user_id)
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  member_a uuid not null references public.profiles(id) on delete cascade,
  member_b uuid not null references public.profiles(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint conversations_distinct_members check (member_a < member_b),
  constraint conversations_unique_pair unique (member_a, member_b)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  nonce text not null,
  sender_ciphertext text not null,
  recipient_ciphertext text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  constraint messages_distinct_members check (sender_id <> recipient_id)
);

create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at);
create index if not exists messages_recipient_created_idx
  on public.messages (recipient_id, created_at);

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_username text;
begin
  normalized_username := lower(regexp_replace(coalesce(new.raw_user_meta_data ->> 'username', ''), '^@', ''));
  if normalized_username !~ '^[a-z][a-z0-9_]{2,23}$' then
    raise exception 'A valid username is required';
  end if;

  insert into public.profiles (id, username, biography)
  values (
    new.id,
    normalized_username,
    left(coalesce(new.raw_user_meta_data ->> 'biography', ''), 240)
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute procedure public.create_profile_for_new_user();

create or replace function public.apply_message_expiry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  expiry_seconds integer;
begin
  select disappearing_after_seconds into expiry_seconds
  from public.profiles where id = new.sender_id;
  if coalesce(expiry_seconds, 0) > 0 then
    new.expires_at := new.created_at + make_interval(secs => expiry_seconds);
  end if;
  return new;
end;
$$;

drop trigger if exists messages_set_expiry on public.messages;
create trigger messages_set_expiry
  before insert on public.messages
  for each row execute procedure public.apply_message_expiry();

create extension if not exists pg_cron with schema pg_catalog;
do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job where jobname = 'delete-expired-mzansilink-messages'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
  perform cron.schedule(
    'delete-expired-mzansilink-messages',
    '*/5 * * * *',
    'delete from public.messages where expires_at is not null and expires_at <= now()'
  );
end;
$$;

create or replace function public.users_have_blocked(user_a uuid, user_b uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or auth.uid() not in (user_a, user_b) then
    return true;
  end if;
  return exists (
    select 1 from public.user_blocks b
    where (b.user_id = user_a and b.blocked_user_id = user_b)
       or (b.user_id = user_b and b.blocked_user_id = user_a)
  );
end;
$$;
revoke all on function public.users_have_blocked(uuid, uuid) from public;
grant execute on function public.users_have_blocked(uuid, uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.user_blocks enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

drop policy if exists "profiles visible to discoverable users" on public.profiles;
create policy "profiles visible to discoverable users"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or discoverable
    or exists (
      select 1 from public.conversations c
      where ((c.member_a = (select auth.uid()) and c.member_b = id)
        or (c.member_b = (select auth.uid()) and c.member_a = id))
    )
  );
drop policy if exists "users insert their own profile" on public.profiles;
create policy "users insert their own profile"
  on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
drop policy if exists "users update their own profile" on public.profiles;
create policy "users update their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "users read their own blocks" on public.user_blocks;
create policy "users read their own blocks"
  on public.user_blocks for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "users create their own blocks" on public.user_blocks;
create policy "users create their own blocks"
  on public.user_blocks for insert to authenticated
  with check (user_id = (select auth.uid()) and blocked_user_id <> (select auth.uid()));
drop policy if exists "users update their own blocks" on public.user_blocks;
create policy "users update their own blocks"
  on public.user_blocks for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists "users remove their own blocks" on public.user_blocks;
create policy "users remove their own blocks"
  on public.user_blocks for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "conversation members read conversations" on public.conversations;
create policy "conversation members read conversations"
  on public.conversations for select to authenticated
  using (
    (member_a = (select auth.uid()) or member_b = (select auth.uid()))
    and not public.users_have_blocked(member_a, member_b)
  );
drop policy if exists "users create their own conversations" on public.conversations;
create policy "users create their own conversations"
  on public.conversations for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and ((member_a = (select auth.uid())) or (member_b = (select auth.uid())))
    and not public.users_have_blocked(member_a, member_b)
  );

drop policy if exists "conversation members read unexpired messages" on public.messages;
create policy "conversation members read unexpired messages"
  on public.messages for select to authenticated
  using (
    (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()))
    and (expires_at is null or expires_at > now())
    and not public.users_have_blocked(sender_id, recipient_id)
  );
drop policy if exists "users send encrypted messages" on public.messages;
create policy "users send encrypted messages"
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and ((c.member_a = sender_id and c.member_b = recipient_id)
          or (c.member_b = sender_id and c.member_a = recipient_id))
    )
    and not public.users_have_blocked(sender_id, recipient_id)
  );
drop policy if exists "members delete expired messages" on public.messages;
create policy "members delete expired messages"
  on public.messages for delete to authenticated
  using (
    (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()))
    and expires_at is not null
    and expires_at <= now()
  );

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end
$$;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.user_blocks to authenticated;
grant select, insert on public.conversations to authenticated;
grant select, insert, delete on public.messages to authenticated;
