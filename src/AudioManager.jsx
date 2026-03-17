import { useState, useRef, useEffect } from "react";
import styles from "./index.module.css";
import { useWords } from "./words";
import { useAudio, playAudio, getCachedAudio, generateAudioForWords } from "./audio";
import { useConfig } from "./config";
import { DEFAULT_DISPLAY_SCRIPT, getPreferredChineseText } from "./display";

function AudioWordRow({ word, preferredScript }) {
  const text = getPreferredChineseText(word, preferredScript);
  const [cached] = useAudio(text);
  const [playing, setPlaying] = useState(false);
  const [generating, setGenerating] = useState(false);

  const handlePlay = async () => {
    if (!text) return;
    setGenerating(true);
    try {
      const audio = await playAudio(text);
      setPlaying(true);
      setGenerating(false);
      audio.addEventListener('ended', () => setPlaying(false), { once: true });
      audio.addEventListener('error', () => setPlaying(false), { once: true });
    } catch (err) {
      console.error('Audio playback failed:', err);
      setGenerating(false);
    }
  };

  return (
    <li className={styles.audioItem}>
      <span className={styles.audioStatus}>
        {cached ? '\u2713' : '\u2014'}
      </span>
      <span className={styles.wordChinese} style={{ fontSize: 18 }}>{text}</span>
      <span className={styles.wordPinyin}>{word.pinyin}</span>
      <span className={styles.wordEnglish}>{word.english}</span>
      <div className={styles.wordActions}>
        <button
          className={`${styles.smallButton} ${styles.playButton} ${cached ? styles.playButtonCached : ''}`}
          onClick={handlePlay}
          disabled={generating || playing}
        >
          {generating ? '...' : playing ? '\u25A0' : '\u25B6'}
        </button>
      </div>
    </li>
  );
}

export function AudioManager() {
  const [words, error, loading] = useWords(100, 0);
  const [displayScript] = useConfig("display_script");
  const [bulkProgress, setBulkProgress] = useState(null);
  const [bulkError, setBulkError] = useState(null);
  const abortRef = useRef(null);
  const preferredScript = displayScript || DEFAULT_DISPLAY_SCRIPT;

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleGenerateAll = async () => {
    if (!words || words.length === 0) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setBulkProgress({ completed: 0, total: words.length, current: '' });
    setBulkError(null);

    try {
      await generateAudioForWords(words, {
        signal: controller.signal,
        onProgress: (completed, total, current) => {
          if (!controller.signal.aborted) {
            setBulkProgress({ completed, total, current });
          }
        },
      });

      if (!controller.signal.aborted) {
        setBulkProgress(null);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setBulkError(err.message || String(err));
        setBulkProgress(null);
      }
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBulkProgress(null);
  };

  if (loading) return <p>Loading words...</p>;
  if (error) return <p>Error loading words: {error.message}</p>;

  return (
    <div>
      <div className={styles.sectionHeader}>
        <h2>Audio</h2>
        <div className={styles.importToolbarActions}>
          {bulkProgress ? (
            <button className={styles.cancelButton} onClick={handleCancel}>
              Cancel
            </button>
          ) : (
            <button
              className={styles.addButton}
              onClick={handleGenerateAll}
              disabled={!words || words.length === 0}
            >
              Generate All Missing
            </button>
          )}
        </div>
      </div>

      {bulkProgress && (
        <div className={styles.processingState}>
          <p>Generating audio: {bulkProgress.completed}/{bulkProgress.total}</p>
          {bulkProgress.current && (
            <div className={styles.processingMeta}>
              <span>Current: {bulkProgress.current}</span>
            </div>
          )}
          <div className={styles.progressBar}>
            <div
              className={styles.progressFill}
              style={{ width: `${(bulkProgress.completed / bulkProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {bulkError && (
        <div className={styles.errorBox}>
          <p>{bulkError}</p>
        </div>
      )}

      {(!words || words.length === 0) ? (
        <div className={styles.emptyState}>
          <p>No words yet</p>
          <p>Add words first, then generate audio</p>
        </div>
      ) : (
        <ul className={styles.wordList}>
          {words.map(word => (
            <AudioWordRow key={word.id} word={word} preferredScript={preferredScript} />
          ))}
        </ul>
      )}
    </div>
  );
}
