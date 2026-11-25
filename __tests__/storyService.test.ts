jest.mock('../src/services/supabase', () => ({
  getSupabaseClient: jest.fn(),
}));

jest.mock('expo-file-system', () => ({
  File: class ExpoFile {
    size = 0;
    type = 'video/mp4';
    arrayBuffer = jest.fn().mockResolvedValue(new ArrayBuffer(0));
  },
}));

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(),
}));

import { getSupabaseClient } from '../src/services/supabase';
import type { ImagePickerAsset } from 'expo-image-picker';
import type { AccountProfile } from '../src/services/accountService';
import {
  deleteOwnStory,
  listActiveStoryOwnerIds,
  MAX_STORY_IMAGE_SIZE,
  postStory,
} from '../src/services/storyService';

const mockGetSupabaseClient = jest.mocked(getSupabaseClient);

describe('active story contacts', () => {
  it('returns unique owners with active stories', async () => {
    const activeQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      gt: jest.fn().mockResolvedValue({
        data: [{ user_id: 'user-1' }, { user_id: 'user-1' }, { user_id: 'user-2' }],
        error: null,
      }),
    };
    mockGetSupabaseClient.mockReturnValue({
      from: jest.fn(() => activeQuery),
    } as never);

    await expect(listActiveStoryOwnerIds()).resolves.toEqual(['user-1', 'user-2']);
    expect(activeQuery.eq).toHaveBeenCalledWith('media_type', 'image');
    expect(activeQuery.gt).toHaveBeenCalledWith('expires_at', expect.any(String));
  });
});

describe('story deletion', () => {
  it('deletes only the owner-selected story and removes its media', async () => {
    const storyQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: { media_path: 'user-1/story.png', music_path: 'user-1/music/song.mp3' },
        error: null,
      }),
      delete: jest.fn().mockReturnThis(),
    };
    storyQuery.maybeSingle
      .mockResolvedValueOnce({
        data: { media_path: 'user-1/story.png', music_path: 'user-1/music/song.mp3' },
        error: null,
      })
      .mockResolvedValueOnce({ data: { id: 'story-1' }, error: null });
    const remove = jest.fn().mockResolvedValue({ error: null });
    const from = jest.fn()
      .mockReturnValueOnce(storyQuery)
      .mockReturnValueOnce(storyQuery);
    mockGetSupabaseClient.mockReturnValue({
      from,
      storage: { from: jest.fn(() => ({ remove })) },
    } as never);

    await expect(deleteOwnStory('user-1', 'story-1')).resolves.toBeNull();
    expect(storyQuery.eq).toHaveBeenNthCalledWith(1, 'id', 'story-1');
    expect(storyQuery.eq).toHaveBeenNthCalledWith(2, 'user_id', 'user-1');
    expect(storyQuery.eq).toHaveBeenNthCalledWith(3, 'id', 'story-1');
    expect(storyQuery.eq).toHaveBeenNthCalledWith(4, 'user_id', 'user-1');
    expect(remove).toHaveBeenCalledWith(['user-1/story.png', 'user-1/music/song.mp3']);
  });
});

describe('photo story uploads', () => {
  const profile: AccountProfile = {
    id: 'user-1',
    email: 'user@example.com',
    username: '@user1',
    displayName: 'User',
    biography: '',
    avatarPath: null,
    avatarUrl: null,
    publicKey: 'public-key',
    themePalette: 'savanna',
    discoverable: true,
    disappearingAfterSeconds: 0,
    notificationsEnabled: true,
    showNotificationPreviews: true,
    biometricLock: false,
  };

  const makeImage = (fileSize: number): ImagePickerAsset => ({
    uri: 'file:///story.png',
    width: 640,
    height: 480,
    type: 'image',
    fileSize,
    mimeType: 'image/png',
  });

  it('creates a captioned photo story without soundtrack media', async () => {
    const upload = jest.fn().mockResolvedValue({ error: null });
    const insert = jest.fn().mockResolvedValue({ error: null });
    mockGetSupabaseClient.mockReturnValue({
      storage: { from: jest.fn(() => ({ upload })) },
      from: jest.fn(() => ({ insert })),
    } as never);

    await expect(postStory(profile, makeImage(100), 'A beautiful day')).resolves.toBeUndefined();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/^user-1\//),
      expect.anything(),
      { contentType: 'image/png' },
    );
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      media_type: 'image',
      caption: 'A beautiful day',
    }));
    expect(insert.mock.calls[0][0]).not.toHaveProperty('music_path');
  });

  it('rejects video story uploads', async () => {
    await expect(postStory(profile, {
      ...makeImage(100),
      type: 'video',
      mimeType: 'video/mp4',
    })).rejects.toThrow('Choose a photo to share.');
  });

  it('removes the uploaded photo when the story record cannot be created', async () => {
    const upload = jest.fn().mockResolvedValue({ error: null });
    const insertError = new Error('Story record could not be created.');
    const insert = jest.fn().mockResolvedValue({ error: insertError });
    const remove = jest.fn().mockResolvedValue({ error: null });
    mockGetSupabaseClient.mockReturnValue({
      storage: { from: jest.fn(() => ({ upload, remove })) },
      from: jest.fn(() => ({ insert })),
    } as never);

    await expect(postStory(profile, makeImage(100), 'A beautiful day')).rejects.toBe(insertError);
    expect(remove).toHaveBeenCalledWith([expect.stringMatching(/^user-1\//)]);
  });

  it('keeps the existing 10 MB photo limit', async () => {
    await expect(postStory(profile, makeImage(MAX_STORY_IMAGE_SIZE + 1))).rejects.toThrow(
      'Photos must be 10 MB or smaller.',
    );
  });
});
