create table if not exists public.story_views (
  story_id uuid not null references public.stories(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (story_id, viewer_id)
);

create index if not exists story_views_viewer_idx
  on public.story_views (viewer_id, viewed_at desc);

create table if not exists public.story_reactions (
  story_id uuid not null references public.stories(id) on delete cascade,
  reactor_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null check (reaction in ('❤️', '😂', '😮', '😢', '👏', '🔥')),
  created_at timestamptz not null default now(),
  primary key (story_id, reactor_id)
);

alter table public.story_views enable row level security;
alter table public.story_reactions enable row level security;

drop policy if exists "story owners read their viewers" on public.story_views;
create policy "story owners read their viewers"
  on public.story_views for select to authenticated
  using (
    exists (
      select 1 from public.stories s
      where s.id = story_id and s.user_id = (select auth.uid())
    )
  );
drop policy if exists "users record views of active stories" on public.story_views;
create policy "users record views of active stories"
  on public.story_views for insert to authenticated
  with check (
    viewer_id = (select auth.uid())
    and exists (
      select 1 from public.stories s
      where s.id = story_id
        and s.user_id <> (select auth.uid())
        and s.expires_at > now()
    )
  );

drop policy if exists "story owners can see story viewers" on public.profiles;
create policy "story owners can see story viewers"
  on public.profiles for select to authenticated
  using (
    exists (
      select 1 from public.story_views v
      join public.stories s on s.id = v.story_id
      where v.viewer_id = public.profiles.id and s.user_id = (select auth.uid())
    )
  );

drop policy if exists "users and story owners read reactions" on public.story_reactions;
create policy "users and story owners read reactions"
  on public.story_reactions for select to authenticated
  using (
    reactor_id = (select auth.uid())
    or exists (
      select 1 from public.stories s
      where s.id = story_id and s.user_id = (select auth.uid())
    )
  );
drop policy if exists "users react to active stories" on public.story_reactions;
create policy "users react to active stories"
  on public.story_reactions for insert to authenticated
  with check (
    reactor_id = (select auth.uid())
    and exists (
      select 1 from public.stories s
      where s.id = story_id
        and s.user_id <> (select auth.uid())
        and s.expires_at > now()
    )
  );
drop policy if exists "users update their story reactions" on public.story_reactions;
create policy "users update their story reactions"
  on public.story_reactions for update to authenticated
  using (
    reactor_id = (select auth.uid())
    and exists (
      select 1 from public.stories s
      where s.id = story_id
        and s.user_id <> (select auth.uid())
        and s.expires_at > now()
    )
  )
  with check (
    reactor_id = (select auth.uid())
    and exists (
      select 1 from public.stories s
      where s.id = story_id
        and s.user_id <> (select auth.uid())
        and s.expires_at > now()
    )
  );
drop policy if exists "users remove their story reactions" on public.story_reactions;
create policy "users remove their story reactions"
  on public.story_reactions for delete to authenticated
  using (reactor_id = (select auth.uid()));

grant select, insert on public.story_views to authenticated;
grant select, insert, update, delete on public.story_reactions to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'story_views'
  ) then
    alter publication supabase_realtime add table public.story_views;
  end if;
end
$$;

drop policy if exists "typing participants receive typing signals" on realtime.messages;
create policy "typing participants receive typing signals"
  on realtime.messages for select to authenticated
  using (
    split_part(realtime.topic(), ':', 1) = 'typing'
    and (select auth.uid())::text in (
      split_part(realtime.topic(), ':', 2),
      split_part(realtime.topic(), ':', 3)
    )
    and exists (
      select 1 from public.conversations c
      where (
        (c.member_a::text = split_part(realtime.topic(), ':', 2)
          and c.member_b::text = split_part(realtime.topic(), ':', 3))
        or (c.member_a::text = split_part(realtime.topic(), ':', 3)
          and c.member_b::text = split_part(realtime.topic(), ':', 2))
      )
      and not public.users_have_blocked(c.member_a, c.member_b)
    )
  );

drop policy if exists "typing participants send typing signals" on realtime.messages;
create policy "typing participants send typing signals"
  on realtime.messages for insert to authenticated
  with check (
    split_part(realtime.topic(), ':', 1) = 'typing'
    and (select auth.uid())::text in (
      split_part(realtime.topic(), ':', 2),
      split_part(realtime.topic(), ':', 3)
    )
    and exists (
      select 1 from public.conversations c
      where (
        (c.member_a::text = split_part(realtime.topic(), ':', 2)
          and c.member_b::text = split_part(realtime.topic(), ':', 3))
        or (c.member_a::text = split_part(realtime.topic(), ':', 3)
          and c.member_b::text = split_part(realtime.topic(), ':', 2))
      )
      and not public.users_have_blocked(c.member_a, c.member_b)
    )
  );
