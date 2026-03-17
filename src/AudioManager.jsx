import { useState, useRef, useEffect } from "react";
import styles from "./index.module.css";
import { useWords } from "./words";
import { useAudio, useAudioStats, playAudio, playOpenAiTts, getCachedAudio, generateAudioForWords } from "./audio";
import { useConfig } from "./config";
import { DEFAULT_DISPLAY_SCRIPT, getPreferredChineseText } from "./display";

function AudioWordRow({ word, preferredScript }) {
  const text = getPreferredChineseText(word, preferredScript);
  const [cached] = useAudio(text);
  const [playing, setPlaying] = useState(false);
  const [generating, setGenerating] = useState(false);

  const handlePlay = async (e) => {
    if (!text) return;
    setGenerating(true);
    try {
      const audio = e.shiftKey
        ? await playOpenAiTts(text)
        : await playAudio(text);
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
  const [audioStats] = useAudioStats();
  const [displayScript] = useConfig("display_script");
  const [bulkProgress, setBulkProgress] = useState(null);
  const [bulkError, setBulkError] = useState(null);
  const [bulkSummary, setBulkSummary] = useState(null);
  const abortRef = useRef(null);
  const preferredScript = displayScript || DEFAULT_DISPLAY_SCRIPT;
  const audioSummary = audioStats
    ? `${audioStats.clipCount} clips, ${formatBytes(audioStats.totalBytes)} stored`
    : 'Loading audio cache...';

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleGenerateAll = async () => {
    if (!words || words.length === 0) return;

    const audioJobs = await Promise.all(words.map(async (word) => {
      const text = getPreferredChineseText(word, preferredScript);
      if (!text) {
        return null;
      }

      const cached = await getCachedAudio(text);
      if (cached) {
        return null;
      }

      return { ...word, audioText: text };
    }));
    const missingWords = audioJobs.filter(Boolean);
    if (missingWords.length === 0) {
      setBulkProgress(null);
      setBulkSummary({ completed: 0, succeeded: 0, failed: 0, total: 0, failures: [] });
      setBulkError('Completed: 0. Failed: 0.');
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setBulkProgress({
      completed: 0,
      succeeded: 0,
      failed: 0,
      total: missingWords.length,
      activeJobs: [],
      current: '',
      failures: [],
    });
    setBulkError(null);
    setBulkSummary(null);

    try {
      const result = await generateAudioForWords(missingWords, {
        signal: controller.signal,
        getText: (word) => word.audioText,
        onProgress: (progress) => {
          if (!controller.signal.aborted) {
            setBulkProgress(progress);
          }
        },
      });

      if (!controller.signal.aborted) {
        setBulkProgress(null);
        setBulkSummary(result);
        setBulkError(`Completed: ${result.succeeded}. Failed: ${result.failed}.`);
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
        <div>
          <h2>Audio</h2>
          <p className={styles.sectionMeta}>{audioSummary}</p>
        </div>
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
          <p>Generating audio</p>
          <div className={styles.processingMeta}>
            <span>Completed: {bulkProgress.succeeded}</span>
            <span>Failed: {bulkProgress.failed}</span>
            <span>Processed: {bulkProgress.completed}/{bulkProgress.total}</span>
          </div>
          {bulkProgress.activeJobs.length > 0 && (
            <div className={styles.processingDetails}>
              <p>Active Jobs</p>
              <ul className={styles.processingList}>
                {bulkProgress.activeJobs.map((job) => (
                  <li key={job}>{job}</li>
                ))}
              </ul>
            </div>
          )}
          {bulkProgress.failures.length > 0 && (
            <div className={styles.processingDetails}>
              <p>Failures</p>
              <ul className={styles.processingList}>
                {bulkProgress.failures.map((failure, index) => (
                  <li key={`${failure.text || 'empty'}-${index}`}>
                    {failure.text || '(empty text)'}: {failure.error}
                  </li>
                ))}
              </ul>
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

      {bulkSummary?.failures?.length > 0 && !bulkProgress && (
        <div className={styles.processingState}>
          <p>Failed Jobs</p>
          <ul className={styles.processingList}>
            {bulkSummary.failures.map((failure, index) => (
              <li key={`${failure.text || 'empty'}-${index}`}>
                {failure.text || '(empty text)'}: {failure.error}
              </li>
            ))}
          </ul>
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

function formatBytes(bytes) {
  if (bytes === 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** exponent);

  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}
