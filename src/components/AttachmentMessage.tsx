import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import * as Sharing from 'expo-sharing';
import { AppColors } from '../theme/colors';
import { AttachmentEnvelope, downloadAttachment } from '../services/attachmentService';

const VOICE_WAVE_HEIGHTS = [7, 11, 15, 9, 17, 12, 8, 14, 10, 6];

export function AttachmentMessage({
  envelope,
  colors,
  outgoing,
}: {
  envelope: AttachmentEnvelope;
  colors: AppColors;
  outgoing: boolean;
}) {
  const [uri, setUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [playWhenReady, setPlayWhenReady] = useState(false);
  const player = useAudioPlayer(uri);
  const playerStatus = useAudioPlayerStatus(player);
  const styles = createStyles(colors, outgoing);

  useEffect(() => {
    if (!playWhenReady || !uri) return;
    if (playerStatus.error) {
      setError(`Voice note could not be played: ${playerStatus.error}`);
      setPlayWhenReady(false);
      return;
    }
    if (!playerStatus.isLoaded) return;

    const startPlayback = async () => {
      try {
        if (playerStatus.didJustFinish) await player.seekTo(0);
        player.play();
        setPlayWhenReady(false);
      } catch (playError) {
        setError(playError instanceof Error ? playError.message : 'Voice note could not be played.');
        setPlayWhenReady(false);
      }
    };
    startPlayback();
  }, [playWhenReady, player, playerStatus.didJustFinish, playerStatus.error, playerStatus.isLoaded, uri]);

  useEffect(() => {
    if (!uri?.startsWith('blob:')) return;
    return () => URL.revokeObjectURL(uri);
  }, [uri]);

  const load = async () => {
    if (uri) return uri;
    setLoading(true);
    setError(null);
    try {
      const downloaded = await downloadAttachment(envelope);
      setUri(downloaded);
      return downloaded;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Attachment could not be opened.');
      return null;
    } finally {
      setLoading(false);
    }
  };

  const open = async () => {
    const fileUri = await load();
    if (!fileUri) return;
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, { mimeType: envelope.mimeType });
      } else {
        await Linking.openURL(fileUri);
      }
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : 'The file could not be opened.');
    }
  };

  const toggleVoice = async () => {
    if (!uri) {
      if (await load()) setPlayWhenReady(true);
      return;
    }
    setError(null);
    if (playerStatus.playing) {
      setPlayWhenReady(false);
      player.pause();
    } else {
      setPlayWhenReady(true);
    }
  };

  const cyclePlaybackRate = () => {
    const nextRate = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
    player.setPlaybackRate(nextRate);
    setPlaybackRate(nextRate);
  };

  if (envelope.kind === 'image') {
    return (
      <View style={styles.container}>
        {uri ? (
          <Image source={{ uri }} style={styles.image} resizeMode="cover" />
        ) : (
          <Pressable style={styles.attachmentAction} onPress={load} disabled={loading}>
            <View style={styles.iconTile}>
              <Ionicons name="image-outline" size={21} color={colors.red} />
            </View>
            <View style={styles.fileCopy}>
              <Text style={styles.fileName}>Photo</Text>
              <Text style={styles.fileHint}>{loading ? 'Loading photo…' : 'Tap to view'}</Text>
            </View>
            <Ionicons name="chevron-forward" size={17} color={colors.muted} />
          </Pressable>
        )}
        {envelope.caption ? <Text style={styles.caption}>{envelope.caption}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }

  if (envelope.kind === 'voice') {
    return (
      <View style={styles.container}>
        <View style={styles.voiceRow}>
          <Pressable
            style={styles.voicePlayButton}
            onPress={toggleVoice}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel={playerStatus.playing ? 'Pause voice note' : 'Play voice note'}>
            <Ionicons name={playerStatus.playing ? 'pause' : 'play'} size={20} color={colors.red} />
          </Pressable>
          <View style={styles.voiceContent}>
            <View style={styles.voiceTitleRow}>
              <Ionicons name="mic-outline" size={14} color={outgoing ? colors.onPrimary : colors.muted} />
              <Text style={styles.voiceTitle}>Voice note</Text>
              {envelope.durationMillis ? (
                <Text style={styles.durationText}>{formatDuration(envelope.durationMillis)}</Text>
              ) : null}
            </View>
            <VoiceWaveform playing={playerStatus.playing} outgoing={outgoing} colors={colors} />
            <Text style={styles.fileHint}>
              {loading
                ? 'Downloading…'
                : uri && !playerStatus.isLoaded
                  ? 'Preparing audio…'
                  : playerStatus.playing
                    ? 'Playing'
                    : 'Tap play to listen'}
            </Text>
          </View>
          <Pressable
            style={[styles.speedButton, !uri && styles.disabled]}
            onPress={cyclePlaybackRate}
            disabled={!uri || loading || !playerStatus.isLoaded}
            accessibilityRole="button"
            accessibilityLabel={`Voice note speed ${playbackRate} times`}>
            <Text style={styles.speedText}>{playbackRate}x</Text>
          </Pressable>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Pressable style={styles.attachmentAction} onPress={open} disabled={loading}>
        <View style={styles.iconTile}>
          <Ionicons name="document-text-outline" size={21} color={colors.red} />
        </View>
        <View style={styles.fileCopy}>
          <Text style={styles.fileName} numberOfLines={1}>{envelope.name}</Text>
          <Text style={styles.fileHint}>{loading ? 'Opening document…' : 'Tap to open'}</Text>
        </View>
        <Ionicons name="open-outline" size={17} color={colors.muted} />
      </Pressable>
      {envelope.caption ? <Text style={styles.caption}>{envelope.caption}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function VoiceWaveform({
  playing,
  outgoing,
  colors,
}: {
  playing: boolean;
  outgoing: boolean;
  colors: AppColors;
}) {
  const scales = useRef(VOICE_WAVE_HEIGHTS.map(() => new Animated.Value(0.35))).current;
  const styles = createStyles(colors, outgoing);

  useEffect(() => {
    if (!playing) {
      scales.forEach((scale, index) => scale.setValue(0.25 + (VOICE_WAVE_HEIGHTS[index] ?? 8) / 30));
      return;
    }

    const animation = Animated.loop(
      Animated.stagger(
        75,
        scales.map((scale, index) => Animated.sequence([
          Animated.timing(scale, {
            toValue: 0.3 + (VOICE_WAVE_HEIGHTS[index] ?? 8) / 20,
            duration: 140,
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 0.2,
            duration: 170,
            useNativeDriver: true,
          }),
        ])),
      ),
    );
    animation.start();
    return () => animation.stop();
  }, [playing, scales]);

  return (
    <View
      style={styles.waveform}
      accessible
      accessibilityLabel={playing ? 'Voice note waveform playing' : 'Voice note waveform'}>
      {scales.map((scale, index) => (
        <Animated.View
          key={index}
          style={[
            styles.waveBar,
            {
              backgroundColor: outgoing ? colors.onPrimary : colors.red,
              height: VOICE_WAVE_HEIGHTS[index],
              transform: [{ scaleY: scale }],
            },
            playing ? styles.waveBarPlaying : styles.waveBarIdle,
          ]}
        />
      ))}
    </View>
  );
}

function formatDuration(durationMillis: number): string {
  const totalSeconds = Math.floor(durationMillis / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

const createStyles = (colors: AppColors, outgoing: boolean) => StyleSheet.create({
  container: { minWidth: 180, maxWidth: 260 },
  image: { width: 230, height: 190, borderRadius: 12, marginBottom: 4 },
  attachmentAction: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconTile: { width: 38, height: 38, borderRadius: 12, backgroundColor: outgoing ? 'rgba(255,255,255,0.2)' : colors.softSurface, alignItems: 'center', justifyContent: 'center' },
  fileCopy: { flex: 1, minWidth: 0, gap: 2 },
  fileName: { color: outgoing ? colors.onPrimary : colors.text, fontSize: 13, fontWeight: '800' },
  fileHint: { color: outgoing ? colors.onPrimary : colors.muted, fontSize: 10 },
  voiceRow: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 54 },
  voicePlayButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: outgoing ? 'rgba(255,255,255,0.2)' : colors.softSurface, alignItems: 'center', justifyContent: 'center' },
  voiceContent: { flex: 1, minWidth: 0, gap: 3 },
  voiceTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  voiceTitle: { flex: 1, color: outgoing ? colors.onPrimary : colors.text, fontSize: 12, fontWeight: '800' },
  waveform: { height: 18, flexDirection: 'row', alignItems: 'center', gap: 2 },
  waveBar: { width: 3, borderRadius: 2 },
  waveBarPlaying: { opacity: 1 },
  waveBarIdle: { opacity: 0.55 },
  speedButton: { width: 42, height: 32, borderRadius: 12, backgroundColor: outgoing ? 'rgba(255,255,255,0.2)' : colors.softSurface, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.55 },
  speedText: { color: outgoing ? colors.onPrimary : colors.text, fontSize: 12, fontWeight: '900' },
  durationText: { color: outgoing ? colors.onPrimary : colors.muted, fontSize: 10, marginLeft: 2 },
  caption: { color: outgoing ? colors.onPrimary : colors.text, fontSize: 12, lineHeight: 17, marginTop: 5 },
  error: { color: outgoing ? colors.onPrimary : colors.red, fontSize: 12, marginTop: 4 },
});
