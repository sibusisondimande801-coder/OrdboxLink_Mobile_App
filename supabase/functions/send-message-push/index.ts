import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function respond(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return respond({ error: 'Sign in required.' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return respond({ error: 'Push delivery is not configured.' }, 500);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: authError } = await userClient.auth.getUser(
    authorization.slice('Bearer '.length),
  );
  if (authError || !userData.user) return respond({ error: 'Sign in required.' }, 401);

  let messageId: unknown;
  try {
    ({ messageId } = await request.json());
  } catch {
    return respond({ error: 'A message ID is required.' }, 400);
  }
  if (typeof messageId !== 'string' || !/^[0-9a-f-]{36}$/i.test(messageId)) {
    return respond({ error: 'A valid message ID is required.' }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: message, error: messageError } = await admin
    .from('messages')
    .select('id, sender_id, recipient_id, conversation_id')
    .eq('id', messageId)
    .eq('sender_id', userData.user.id)
    .maybeSingle();
  if (messageError) return respond({ error: 'The message could not be checked.' }, 500);
  if (!message) return respond({ error: 'Message not found.' }, 404);

  const { data: recipient, error: recipientError } = await admin
    .from('profiles')
    .select('notifications_enabled, show_notification_previews')
    .eq('id', message.recipient_id)
    .maybeSingle();
  if (recipientError) return respond({ error: 'Notification settings could not be read.' }, 500);
  if (!recipient?.notifications_enabled) return respond({ sent: 0 });

  const [{ data: sender, error: senderError }, { data: tokens, error: tokenError }] = await Promise.all([
    admin.from('profiles').select('username').eq('id', message.sender_id).maybeSingle(),
    admin.from('notification_tokens').select('expo_push_token').eq('user_id', message.recipient_id),
  ]);
  if (senderError || tokenError) return respond({ error: 'Push recipients could not be loaded.' }, 500);
  if (!tokens?.length) return respond({ sent: 0 });

  const notifications = tokens.map(({ expo_push_token }) => ({
    to: expo_push_token,
    title: recipient.show_notification_previews ? `@${sender?.username ?? 'New message'}` : 'New message',
    body: 'You have a new message.',
    sound: 'default',
    channelId: 'messages',
    data: { conversationId: message.conversation_id },
  }));
  const pushResponse = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(notifications),
  });
  if (!pushResponse.ok) return respond({ error: 'The push service could not accept the alert.' }, 502);
  return respond({ sent: notifications.length });
});
