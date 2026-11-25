alter table public.profiles
  add column if not exists avatar_path text,
  add column if not exists theme_palette text not null default 'savanna';
alter table public.profiles alter column notifications_enabled set default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_theme_palette_check'
  ) then
    alter table public.profiles
      add constraint profiles_theme_palette_check
      check (theme_palette in ('savanna', 'baobab', 'ocean', 'clay'));
  end if;
end
$$;

create table if not exists public.saved_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  contact_id uuid not null,
  username_snapshot text not null,
  created_at timestamptz not null default now(),
  constraint saved_contacts_not_self check (user_id <> contact_id),
  constraint saved_contacts_unique unique (user_id, contact_id)
);

insert into public.saved_contacts (user_id, contact_id, username_snapshot)
select c.member_a, c.member_b, p.username
from public.conversations c
join public.profiles p on p.id = c.member_b
union
select c.member_b, c.member_a, p.username
from public.conversations c
join public.profiles p on p.id = c.member_a
on conflict (user_id, contact_id) do update
set username_snapshot = excluded.username_snapshot;

drop policy if exists "profiles visible to discoverable users" on public.profiles;
create policy "profiles visible to discoverable users"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or discoverable
    or exists (
      select 1 from public.saved_contacts sc
      where sc.user_id = (select auth.uid()) and sc.contact_id = id
    )
    or exists (
      select 1 from public.conversations c
      where ((c.member_a = (select auth.uid()) and c.member_b = id)
        or (c.member_b = (select auth.uid()) and c.member_a = id))
    )
  );

create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  media_path text not null unique,
  media_type text not null check (media_type in ('image', 'video')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  constraint stories_expiry_window check (expires_at <= created_at + interval '24 hours')
);

create index if not exists stories_active_created_idx
  on public.stories (expires_at, created_at desc);
create index if not exists stories_user_active_idx
  on public.stories (user_id, expires_at, created_at desc);

create or replace function public.set_story_expiry()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := now();
  new.expires_at := new.created_at + interval '24 hours';
  return new;
end;
$$;

drop trigger if exists stories_set_expiry on public.stories;
create trigger stories_set_expiry
  before insert on public.stories
  for each row execute procedure public.set_story_expiry();

drop policy if exists "story profiles visible to viewers" on public.profiles;
create policy "story profiles visible to viewers"
  on public.profiles for select to authenticated
  using (
    exists (
      select 1 from public.stories s
      where s.user_id = id and s.expires_at > now()
    )
  );

create table if not exists public.notification_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

update public.profiles p
set notifications_enabled = false
where not exists (
  select 1 from public.notification_tokens t where t.user_id = p.id
);

alter table public.saved_contacts enable row level security;
alter table public.stories enable row level security;
alter table public.notification_tokens enable row level security;

drop policy if exists "users manage their saved contacts" on public.saved_contacts;
create policy "users manage their saved contacts"
  on public.saved_contacts for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and user_id <> contact_id);

drop policy if exists "signed-in users read active stories" on public.stories;
create policy "signed-in users read active stories"
  on public.stories for select to authenticated
  using (expires_at > now());
drop policy if exists "users create their own stories" on public.stories;
create policy "users create their own stories"
  on public.stories for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists "users delete their own stories" on public.stories;
create policy "users delete their own stories"
  on public.stories for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "users manage their push tokens" on public.notification_tokens;
create policy "users manage their push tokens"
  on public.notification_tokens for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.saved_contacts to authenticated;
grant select, insert, delete on public.stories to authenticated;
grant select, insert, update, delete on public.notification_tokens to authenticated;
grant update (avatar_path, theme_palette) on public.profiles to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('message-media', 'message-media', false, 10485776,
   array['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain',
         'application/octet-stream',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/ogg', 'audio/webm']),
  ('story-media', 'story-media', false, 26214400,
   array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']),
  ('profile-photos', 'profile-photos', false, 5242880,
   array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "conversation members upload message media" on storage.objects;
create policy "conversation members upload message media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'message-media'
    and exists (
      select 1 from public.conversations c
      where c.id::text = (storage.foldername(name))[1]
        and (c.member_a = (select auth.uid()) or c.member_b = (select auth.uid()))
        and not public.users_have_blocked(c.member_a, c.member_b)
    )
  );
drop policy if exists "conversation members read message media" on storage.objects;
create policy "conversation members read message media"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'message-media'
    and exists (
      select 1 from public.conversations c
      where c.id::text = (storage.foldername(name))[1]
        and (c.member_a = (select auth.uid()) or c.member_b = (select auth.uid()))
        and not public.users_have_blocked(c.member_a, c.member_b)
    )
  );

drop policy if exists "signed-in users read active story media" on storage.objects;
create policy "signed-in users read active story media"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'story-media'
    and exists (
      select 1 from public.stories s
      where s.media_path = name and s.expires_at > now()
    )
  );
drop policy if exists "users upload their story media" on storage.objects;
create policy "users upload their story media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'story-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
drop policy if exists "users delete their story media" on storage.objects;
create policy "users delete their story media"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'story-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "users read visible profile photos" on storage.objects;
create policy "users read visible profile photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'profile-photos'
    and exists (
      select 1 from public.profiles p
      where p.id::text = (storage.foldername(name))[1]
        and p.avatar_path = name
    )
  );
drop policy if exists "users upload their profile photos" on storage.objects;
create policy "users upload their profile photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
drop policy if exists "users update their profile photos" on storage.objects;
create policy "users update their profile photos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
drop policy if exists "users delete their profile photos" on storage.objects;
create policy "users delete their profile photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job where jobname = 'delete-expired-mzansilink-stories'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
end
$$;
