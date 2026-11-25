import { useCallback, useEffect, useRef, useState } from 'react';
import { AccountProfile } from '../services/accountService';
import { createTypingChannel } from '../services/messagingService';
import { isSupabaseConfigured } from '../services/supabase';

export function useTypingIndicator(
  profile: AccountProfile | null,
  participantId: string | null,
): {
  isParticipantTyping: boolean;
  typingError: string | null;
  updateTyping: (isTyping: boolean) => void;
} {
  const [isParticipantTyping, setIsParticipantTyping] = useState(false);
  const [typingError, setTypingError] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<typeof createTypingChannel> | null>(null);
  const channelReady = useRef(false);
  const typingStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteTypingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSentAt = useRef(0);

  const sendTypingSignal = useCallback((isTyping: boolean) => {
    const channel = channelRef.current;
    if (!channel || !channelReady.current || !profile) return;

    channel.send({
      type: 'broadcast',
      event: 'typing',
      payload: { userId: profile.id, isTyping },
    }).then((result) => {
      if (result !== 'ok') setTypingError('Typing updates are temporarily unavailable.');
      else setTypingError(null);
    }).catch(() => {
      setTypingError('Typing updates are temporarily unavailable.');
    });
  }, [profile]);

  const updateTyping = useCallback((isTyping: boolean) => {
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
    if (isTyping) {
      const now = Date.now();
      if (now - lastTypingSentAt.current >= 900) {
        lastTypingSentAt.current = now;
        sendTypingSignal(true);
      }
      typingStopTimer.current = setTimeout(() => sendTypingSignal(false), 1600);
    } else {
      sendTypingSignal(false);
    }
  }, [sendTypingSignal]);

  useEffect(() => {
    setIsParticipantTyping(false);
    setTypingError(null);
    lastTypingSentAt.current = 0;
    if (!profile || !participantId || participantId === profile.id || !isSupabaseConfigured) return;

    let active = true;
    const channel = createTypingChannel(profile.id, participantId, (typing) => {
      if (!active) return;
      if (remoteTypingTimer.current) clearTimeout(remoteTypingTimer.current);
      setIsParticipantTyping(typing);
      if (typing) {
        remoteTypingTimer.current = setTimeout(() => setIsParticipantTyping(false), 3500);
      }
    });
    channelRef.current = channel;
    channel.subscribe((status) => {
      if (!active) return;
      if (status === 'SUBSCRIBED') {
        channelReady.current = true;
        setTypingError(null);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        channelReady.current = false;
        setTypingError('Typing updates are temporarily unavailable.');
      }
    });

    return () => {
      active = false;
      channelReady.current = false;
      channelRef.current = null;
      if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
      if (remoteTypingTimer.current) clearTimeout(remoteTypingTimer.current);
      channel.unsubscribe();
    };
  }, [participantId, profile]);

  return { isParticipantTyping, typingError, updateTyping };
}
