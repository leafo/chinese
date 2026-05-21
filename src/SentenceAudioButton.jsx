import { useState, useEffect, useRef, useCallback } from "react";
import styles from "./index.module.css";
import { audioKey, playAudio, useAudio, stopCurrentAudio } from "./audio";
import { AudioPlayIcon } from "./AudioPlayIcon";

export function SentenceAudioButton({ sentence }) {
  const text = sentence.pinyin ? audioKey(sentence.pinyin) : '';
  const chineseText = sentence.simplified || sentence.traditional;
  const [cached] = useAudio(text);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);
  const audioRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (audioRef.current) {
        stopCurrentAudio();
        audioRef.current = null;
      }
    };
  }, []);

  const trackAudio = useCallback((audio) => {
    audioRef.current = audio;
    setPlaying(true);

    const cleanup = () => {
      if (audioRef.current === audio) audioRef.current = null;
      if (mountedRef.current) setPlaying(false);
    };

    audio.addEventListener('pause', cleanup, { once: true });
    audio.addEventListener('ended', cleanup, { once: true });
    audio.addEventListener('error', cleanup, { once: true });
  }, []);

  const handlePlay = async (e) => {
    e.stopPropagation();
    if (!text || !chineseText) return;

    setLoading(true);
    try {
      await playAudio(text, { onStart: trackAudio, chineseText, force: e.altKey });
    } catch (err) {
      console.error('Audio playback failed:', err);
      if (mountedRef.current) {
        audioRef.current = null;
        setPlaying(false);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  return (
    <button
      className={`${styles.smallButton} ${styles.playButton} ${cached ? styles.playButtonCached : ''}`}
      onClick={handlePlay}
      disabled={loading || playing || !text || !chineseText}
      title={`${cached ? 'Play audio' : 'Generate & play audio'} (Alt-click: regenerate)`}
    >
      <AudioPlayIcon loading={loading} playing={playing} />
    </button>
  );
}
