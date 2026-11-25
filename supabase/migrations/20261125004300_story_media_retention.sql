update storage.buckets
set file_size_limit = null
where id = 'story-media';

alter table public.stories
  drop constraint if exists stories_expiry_window;

update public.stories
set expires_at = created_at + interval '12 hours'
where media_type = 'video'
  and expires_at > created_at + interval '12 hours';

alter table public.stories
  add constraint stories_expiry_window
  check (
    expires_at <= created_at
      + case when media_type = 'video'
          then interval '12 hours'
          else interval '24 hours'
        end
  );

create or replace function public.set_story_expiry()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := now();
  new.expires_at := new.created_at
    + case when new.media_type = 'video'
        then interval '12 hours'
        else interval '24 hours'
      end;
  return new;
end;
$$;
