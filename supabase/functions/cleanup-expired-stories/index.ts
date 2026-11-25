import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function respond(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request) => {
  const cleanupSecret = Deno.env.get('STORY_CLEANUP_SECRET');
  if (!cleanupSecret || request.headers.get('Authorization') !== `Bearer ${cleanupSecret}`) {
    return respond({ error: 'Unauthorized.' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return respond({ error: 'Story cleanup is not configured.' }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [expiredResult, legacyVideosResult] = await Promise.all([
    admin.from('stories')
      .select('id, media_path, music_path')
      .lte('expires_at', new Date().toISOString()),
    admin.from('stories')
      .select('id, media_path, music_path')
      .eq('media_type', 'video'),
  ]);
  if (expiredResult.error || legacyVideosResult.error) {
    return respond({ error: 'Expired stories could not be loaded.' }, 500);
  }
  const expired = [...new Map(
    [...(expiredResult.data ?? []), ...(legacyVideosResult.data ?? [])]
      .map((story) => [story.id, story]),
  ).values()];
  if (expired.length === 0) return respond({ deleted: 0 });

  const storagePaths = expired.flatMap(({ media_path, music_path }) =>
    music_path ? [media_path, music_path] : [media_path],
  );
  const { error: storageError } = await admin.storage
    .from('story-media')
    .remove(storagePaths);
  if (storageError) return respond({ error: 'Expired story files could not be deleted.' }, 500);

  const { error: deleteError } = await admin
    .from('stories')
    .delete()
    .in('id', expired.map(({ id }) => id));
  if (deleteError) return respond({ error: 'Expired story records could not be deleted.' }, 500);
  return respond({ deleted: expired.length });
});
