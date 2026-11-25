import { File as ExpoFile } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import type { ImagePickerAsset } from 'expo-image-picker';
import { AccountProfile } from './accountService';
import { getSupabaseClient } from './supabase';

export const MAX_STORY_IMAGE_SIZE = 10 * 1024 * 1024;

export const STORY_REACTIONS = ['❤️', '😂', '😮', '😢', '👏', '🔥'] as const;
export type StoryReaction = (typeof STORY_REACTIONS)[number];

export interface StoryItem {
  id: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  publicKey: string;
  disappearingAfterSeconds: number;
  mediaType: 'image';
  mediaUrl: string;
  caption: string;
  createdAt: string;
  expiresAt: string;
  viewCount: number;
  reactionCount: number;
  myReaction: StoryReaction | null;
}

export interface StoryViewer {
  userId: string;
  username: string;
  viewedAt: string;
}

export async function listActiveStoryOwnerIds(): Promise<string[]> {
  const { data, error } = await getSupabaseClient()
    .from('stories')
    .select('user_id')
    .eq('media_type', 'image')
    .gt('expires_at', new Date().toISOString());
  if (error) throw error;
  return [...new Set(data.map((story) => story.user_id))];
}

export async function listActiveStories(currentUserId: string): Promise<StoryItem[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('stories')
    .select('id, user_id, media_path, media_type, caption, created_at, expires_at, profiles!stories_user_id_fkey!inner(username, avatar_path, public_key, disappearing_after_seconds)')
    .eq('media_type', 'image')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (error) throw error;

  const ownStoryIds = data.filter((story) => story.user_id === currentUserId).map((story) => story.id);
  const storyIds = data.map((story) => story.id);
  const viewCounts = new Map<string, number>();
  const reactionCounts = new Map<string, number>();
  const reactions = new Map<string, StoryReaction>();
  if (ownStoryIds.length > 0) {
    const { data: views, error: viewsError } = await supabase
      .from('story_views')
      .select('story_id')
      .in('story_id', ownStoryIds);
    if (viewsError) throw viewsError;
    for (const view of views) {
      viewCounts.set(view.story_id, (viewCounts.get(view.story_id) ?? 0) + 1);
    }
    const { data: storyReactions, error: storyReactionsError } = await supabase
      .from('story_reactions')
      .select('story_id')
      .in('story_id', ownStoryIds);
    if (storyReactionsError) throw storyReactionsError;
    for (const storyReaction of storyReactions) {
      reactionCounts.set(
        storyReaction.story_id,
        (reactionCounts.get(storyReaction.story_id) ?? 0) + 1,
      );
    }
  }
  if (storyIds.length > 0) {
    const { data: ownReactions, error: reactionError } = await supabase
      .from('story_reactions')
      .select('story_id, reaction')
      .eq('reactor_id', currentUserId)
      .in('story_id', storyIds);
    if (reactionError) throw reactionError;
    for (const reaction of ownReactions) {
      reactions.set(reaction.story_id, reaction.reaction as StoryReaction);
    }
  }

  return Promise.all(
    data.map(async (story) => {
      const secondsUntilExpiry = Math.max(
        1,
        Math.floor((Date.parse(story.expires_at) - Date.now()) / 1000),
      );
      const { data: media, error: mediaError } = await getSupabaseClient()
        .storage.from('story-media')
        .createSignedUrl(story.media_path, Math.min(60 * 60, secondsUntilExpiry));
      if (mediaError) throw mediaError;
      const storyProfile = Array.isArray(story.profiles) ? story.profiles[0] : story.profiles;
      if (!storyProfile) throw new Error('A story profile could not be loaded.');
      const profile = storyProfile as {
        username: string;
        avatar_path: string | null;
        public_key: string | null;
        disappearing_after_seconds: number;
      };
      let avatarUrl: string | null = null;
      if (profile.avatar_path) {
        const avatar = await getSupabaseClient()
          .storage.from('profile-photos')
          .createSignedUrl(profile.avatar_path, 60 * 60);
        if (avatar.error) throw avatar.error;
        avatarUrl = avatar.data.signedUrl;
      }
      return {
        id: story.id,
        userId: story.user_id,
        username: `@${profile.username}`,
        avatarUrl,
        publicKey: profile.public_key ?? '',
        disappearingAfterSeconds: profile.disappearing_after_seconds,
        mediaType: 'image',
        mediaUrl: media.signedUrl,
        caption: story.caption ?? '',
        createdAt: story.created_at,
        expiresAt: story.expires_at,
        viewCount: viewCounts.get(story.id) ?? 0,
        reactionCount: reactionCounts.get(story.id) ?? 0,
        myReaction: reactions.get(story.id) ?? null,
      };
    }),
  );
}

export async function deleteOwnStory(ownerId: string, storyId: string): Promise<string | null> {
  const supabase = getSupabaseClient();
  const { data: story, error: storyError } = await supabase
    .from('stories')
    .select('media_path, music_path')
    .eq('id', storyId)
    .eq('user_id', ownerId)
    .maybeSingle();
  if (storyError) throw storyError;
  if (!story) throw new Error('This story could not be found or is no longer available.');

  const { data: deleted, error: deleteError } = await supabase
    .from('stories')
    .delete()
    .eq('id', storyId)
    .eq('user_id', ownerId)
    .select('id')
    .maybeSingle();
  if (deleteError) throw deleteError;
  if (!deleted) throw new Error('This story could not be deleted. Refresh and try again.');

  const { error: storageError } = await supabase.storage
    .from('story-media')
    .remove([story.media_path, story.music_path].filter((path): path is string => Boolean(path)));
  if (storageError) {
    return `The story was deleted, but its media file could not be removed: ${storageError.message}`;
  }
  return null;
}

export async function recordStoryView(
  storyId: string,
  viewerId: string,
  ownerId: string,
): Promise<void> {
  if (viewerId === ownerId) return;
  const { error } = await getSupabaseClient()
    .from('story_views')
    .upsert(
      { story_id: storyId, viewer_id: viewerId },
      { onConflict: 'story_id,viewer_id', ignoreDuplicates: true },
    );
  if (error) throw error;
}

export async function listStoryViewers(storyId: string): Promise<StoryViewer[]> {
  const { data, error } = await getSupabaseClient()
    .from('story_views')
    .select('viewer_id, viewed_at, profiles!story_views_viewer_id_fkey!inner(username)')
    .eq('story_id', storyId)
    .order('viewed_at', { ascending: false });
  if (error) throw error;

  return data.map((view) => {
    const viewerProfile = Array.isArray(view.profiles) ? view.profiles[0] : view.profiles;
    if (!viewerProfile) throw new Error('A story viewer profile could not be loaded.');
    return {
      userId: view.viewer_id,
      username: `@${viewerProfile.username}`,
      viewedAt: view.viewed_at,
    };
  });
}

export async function countStoryReactions(storyId: string): Promise<number> {
  const { count, error } = await getSupabaseClient()
    .from('story_reactions')
    .select('story_id', { count: 'exact', head: true })
    .eq('story_id', storyId);
  if (error) throw error;
  return count ?? 0;
}

export async function setStoryReaction(
  storyId: string,
  reactorId: string,
  reaction: StoryReaction | null,
): Promise<void> {
  const supabase = getSupabaseClient();
  if (reaction === null) {
    const { error } = await supabase
      .from('story_reactions')
      .delete()
      .eq('story_id', storyId)
      .eq('reactor_id', reactorId);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from('story_reactions')
    .upsert(
      { story_id: storyId, reactor_id: reactorId, reaction },
      { onConflict: 'story_id,reactor_id' },
    );
  if (error) throw error;
}

export async function postStory(
  profile: AccountProfile,
  asset: ImagePickerAsset,
  caption = '',
): Promise<void> {
  if (asset.type !== 'image') {
    throw new Error('Choose a photo to share.');
  }
  const file = asset.file ?? new ExpoFile(asset.uri);
  const size = asset.fileSize ?? file.size;
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error('The selected photo size could not be determined.');
  }
  if (size > MAX_STORY_IMAGE_SIZE) {
    throw new Error('Photos must be 10 MB or smaller.');
  }
  const mimeType = asset.mimeType ?? file.type;
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!mimeType || !allowedTypes.includes(mimeType)) {
    throw new Error('This photo format is not supported.');
  }
  const normalizedCaption = caption.trim().slice(0, 500);
  const imageExtension = mimeType.split('/')[1] ?? 'jpg';
  const mediaPath = `${profile.id}/${Crypto.randomUUID()}.${imageExtension}`;
  const uploadedPaths: string[] = [];

  try {
    const supabase = getSupabaseClient();
    const { error: imageUploadError } = await supabase.storage
      .from('story-media')
      .upload(mediaPath, file, { contentType: mimeType });
    if (imageUploadError) throw imageUploadError;
    uploadedPaths.push(mediaPath);

    const { error: insertError } = await supabase.from('stories').insert({
      user_id: profile.id,
      media_path: mediaPath,
      media_type: 'image',
      caption: normalizedCaption || null,
    });
    if (insertError) throw insertError;
  } catch (error) {
    if (uploadedPaths.length > 0) {
      const { error: cleanupError } = await getSupabaseClient()
        .storage.from('story-media')
        .remove(uploadedPaths);
      if (cleanupError) {
        const message = error instanceof Error ? error.message : 'The story could not be shared.';
        throw new Error(`${message} Uploaded story files could not be removed: ${cleanupError.message}`);
      }
    }
    throw error;
  }
}
