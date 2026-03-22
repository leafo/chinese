import { useState, useEffect, useRef, useCallback } from "react";
import styles from "./index.module.css";
import { playAudio, playOpenAiTts, useAudio, getCachedAudio, playBlob, stopCurrentAudio } from "./audio";

export function PlayButton({ text, autoPlay = false }) {
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

  useEffect(() => {
    if (!autoPlay || !text) return;

    let cancelled = false;
    getCachedAudio(text).then(record => {
      if (record && !cancelled && mountedRef.current) {
        const audio = playBlob(record.blob);
        trackAudio(audio);
        audio.play().catch(() => {
          if (mountedRef.current) {
            audioRef.current = null;
            setPlaying(false);
          }
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [autoPlay, text, trackAudio]);

  const handlePlay = async (e) => {
    e.stopPropagation();
    if (!text) return;

    setLoading(true);
    try {
      if (e.shiftKey) {
        await playOpenAiTts(text, { onStart: trackAudio });
      } else {
        await playAudio(text, { onStart: trackAudio });
      }
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
      disabled={loading || playing}
      title={cached ? 'Play audio' : 'Generate & play audio'}
    >
      {loading ? '...' : playing
        ? <svg width="10" height="10" viewBox="0 0 10 10"><rect width="10" height="10" fill="currentColor"/></svg>
        : <svg width="10" height="10" viewBox="0 0 10 10"><polygon points="0,0 10,5 0,10" fill="currentColor"/></svg>}
    </button>
  );
}
