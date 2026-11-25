alter table public.saved_contacts
  add column if not exists nickname text;

create table if not exists public.conversation_hides (
  user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (user_id, conversation_id)
);

alter table public.conversation_hides enable row level security;

drop policy if exists "users manage their own conversation hides" on public.conversation_hides;
create policy "users manage their own conversation hides"
  on public.conversation_hides for all to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.conversations c
      where c.id = conversation_id
        and (c.member_a = (select auth.uid()) or c.member_b = (select auth.uid()))
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.conversations c
      where c.id = conversation_id
        and (c.member_a = (select auth.uid()) or c.member_b = (select auth.uid()))
    )
  );

grant select, insert, update, delete on public.conversation_hides to authenticated;
