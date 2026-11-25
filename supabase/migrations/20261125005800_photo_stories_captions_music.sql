alter table public.stories
  add column if not exists caption text,
  add column if not exists music_path text;

alter table public.stories
  drop constraint if exists stories_photo_only_check,
  drop constraint if exists stories_caption_length_check,
  drop constraint if exists stories_music_path_owner_check;

alter table public.stories
  add constraint stories_photo_only_check
    check (media_type = 'image') not valid,
  add constraint stories_caption_length_check
    check (caption is null or char_length(caption) <= 500),
  add constraint stories_music_path_owner_check
    check (music_path is null or split_part(music_path, '/', 1) = user_id::text);

update storage.buckets
set file_size_limit = null,
    allowed_mime_types = array[
      'image/jpeg',
      'image/png',
      'image/webp',
      'audio/aac',
      'audio/3gpp',
      'audio/mp4',
      'audio/mpeg',
      'audio/mp3',
      'audio/ogg',
      'audio/wav',
      'audio/x-m4a',
      'audio/x-wav',
      'audio/webm'
    ]
where id = 'story-media';

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

drop policy if exists "story profiles visible to viewers" on public.profiles;
create policy "story profiles visible to viewers"
  on public.profiles for select to authenticated
  using (
    exists (
      select 1 from public.stories s
      where s.user_id = id
        and s.media_type = 'image'
        and s.expires_at > now()
    )
  );

drop policy if exists "signed-in users read active stories" on public.stories;
create policy "signed-in users read active stories"
  on public.stories for select to authenticated
  using (media_type = 'image' and expires_at > now());

drop policy if exists "users create their own stories" on public.stories;
create policy "users create their own stories"
  on public.stories for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and media_type = 'image'
    and (
      music_path is null
      or split_part(music_path, '/', 1) = (select auth.uid())::text
    )
  );

drop policy if exists "signed-in users read active story media" on storage.objects;
create policy "signed-in users read active story media"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'story-media'
    and exists (
      select 1 from public.stories s
      where (s.media_path = name or s.music_path = name)
        and s.media_type = 'image'
        and s.expires_at > now()
    )
  );
