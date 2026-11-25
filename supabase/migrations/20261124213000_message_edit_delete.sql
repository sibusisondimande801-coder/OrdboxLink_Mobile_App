alter table public.messages
  add column if not exists edited_at timestamptz,
  add column if not exists deleted_at timestamptz;

drop policy if exists "senders update their own active messages" on public.messages;
create policy "senders update their own active messages"
  on public.messages for update to authenticated
  using (
    sender_id = (select auth.uid())
    and (expires_at is null or expires_at > now())
    and deleted_at is null
    and not public.users_have_blocked(sender_id, recipient_id)
  )
  with check (
    sender_id = (select auth.uid())
    and (expires_at is null or expires_at > now())
    and not public.users_have_blocked(sender_id, recipient_id)
  );

grant update (nonce, sender_ciphertext, recipient_ciphertext, edited_at, deleted_at)
  on public.messages to authenticated;

create index if not exists messages_deleted_at_idx
  on public.messages (deleted_at)
  where deleted_at is not null;
