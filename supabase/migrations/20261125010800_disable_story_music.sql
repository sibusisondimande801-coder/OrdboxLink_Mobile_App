update storage.buckets
set allowed_mime_types = array[
  'image/jpeg',
  'image/png',
  'image/webp'
]
where id = 'story-media';

drop policy if exists "users create their own stories" on public.stories;
create policy "users create their own stories"
  on public.stories for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and media_type = 'image'
    and music_path is null
  );

drop policy if exists "signed-in users read active story media" on storage.objects;
create policy "signed-in users read active story media"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'story-media'
    and exists (
      select 1 from public.stories s
      where s.media_path = name
        and s.media_type = 'image'
        and s.expires_at > now()
    )
  );
