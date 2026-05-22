import { useState, useRef, useEffect, useMemo } from "react";
import styles from "./index.module.css";
import { useAllWords } from "./words";
import { useAllSentences } from "./sentences";
import {
  useAllAudio,
  generateAudioForWords,
  audioKey,
  deleteCachedAudio,
  playRecord,
  stopCurrentAudio,
} from "./audio";
import { AudioPlayIcon } from "./AudioPlayIcon";
import { useConfig } from "./config";
import { useRouteToggle } from "./router";
import { formatBytes } from "./util";
import { DEFAULT_DISPLAY_SCRIPT, getPreferredChineseText } from "./display";

// Cap rendered linked clips so a large cache doesn't make the page laggy.
// Orphan clips are always shown in full so they can all be cleaned up.
const CLIP_RENDER_LIMIT = 50;

function ClipPlayButton({ clip }) {
  const [playing, setPlaying] = useState(false);
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

  const handlePlay = () => {
    const audio = playRecord(clip);
    audioRef.current = audio;
    setPlaying(true);
    const done = () => {
      if (audioRef.current === audio) audioRef.current = null;
      if (mountedRef.current) setPlaying(false);
    };
    // 'pause' fires when another clip interrupts this one via stopCurrentAudio.
    audio.addEventListener('pause', done, { once: true });
    audio.addEventListener('ended', done, { once: true });
    audio.addEventListener('error', done, { once: true });
    audio.play().catch(done);
  };

  return (
    <button
      type="button"
      className={`${styles.smallButton} ${styles.playButton} ${styles.playButtonCached}`}
      onClick={handlePlay}
      disabled={playing}
      title="Play clip"
    >
      <AudioPlayIcon playing={playing} />
    </button>
  );
}

function ClipRow({ clip, entities }) {
  const orphan = entities.length === 0;
  const size = clip.blob?.size ? formatBytes(clip.blob.size) : (clip.url ? 'precomputed' : '—');
  const date = clip.createdAt ? new Date(clip.createdAt).toLocaleDateString() : '—';
  const label = orphan
    ? clip.text
    : entities.map(e => e.label).join('  ·  ');

  return (
    <li className={styles.audioItem}>
      <ClipPlayButton clip={clip} />
      <div className={styles.audioClipMain}>
        <span className={`${styles.audioClipText}${orphan ? ` ${styles.audioClipOrphan}` : ''}`}>
          {label}
        </span>
        {!orphan && <span className={styles.audioClipKey}>{clip.text}</span>}
      </div>
      <div className={styles.audioClipMeta}>
        <span>{clip.model || '—'}</span>
        <span>{size}</span>
        <span>{date}</span>
      </div>
      <div className={styles.wordActions}>
        <button
          type="button"
          className={styles.deleteButton}
          onClick={() => {
            if (confirm(`Delete the audio clip for "${clip.text}"? This can't be undone.`)) {
              deleteCachedAudio(clip.text);
            }
          }}
        >
          Delete
        </button>
      </div>
    </li>
  );
}

export function AudioManager() {
  const [words, wordsError, wordsLoading] = useAllWords();
  const [sentences, sentencesError, sentencesLoading] = useAllSentences();
  const [clips, clipsError, clipsLoading] = useAllAudio();
  const [displayScript] = useConfig("display_script");
  const [bulkProgress, setBulkProgress] = useState(null);
  const [bulkError, setBulkError] = useState(null);
  const [bulkSummary, setBulkSummary] = useState(null);
  const [showOrphansOnly, setShowOrphansOnly] = useRouteToggle('orphans');
  const abortRef = useRef(null);
  const preferredScript = displayScript || DEFAULT_DISPLAY_SCRIPT;

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Map each normalized pinyin key to the words/sentences that use it, so a
  // cached clip can be shown alongside what it belongs to.
  const entityIndex = useMemo(() => {
    const map = new Map();
    const add = (item, type) => {
      if (!item.pinyin) return;
      const key = audioKey(item.pinyin);
      if (!key) return;
      const label = getPreferredChineseText(item, preferredScript) || item.pinyin;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ type, label });
    };
    (words || []).forEach(w => add(w, 'word'));
    (sentences || []).forEach(s => add(s, 'sentence'));
    return map;
  }, [words, sentences, preferredScript]);

  const { linkedClips, orphanClips } = useMemo(() => {
    const sorted = [...(clips || [])].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const linked = [];
    const orphans = [];
    for (const clip of sorted) {
      if (entityIndex.has(clip.text)) linked.push(clip);
      else orphans.push(clip);
    }
    return { linkedClips: linked, orphanClips: orphans };
  }, [clips, entityIndex]);

  // One representative word/sentence per pinyin key that has no cached clip.
  const missingItems = useMemo(() => {
    const clipKeys = new Set((clips || []).map(c => c.text));
    const byKey = new Map();
    const consider = (item) => {
      if (!item.pinyin) return;
      const key = audioKey(item.pinyin);
      if (!key || clipKeys.has(key) || byKey.has(key)) return;
      byKey.set(key, item);
    };
    (words || []).forEach(consider);
    (sentences || []).forEach(consider);
    return [...byKey.values()];
  }, [clips, words, sentences]);

  const totalBytes = useMemo(
    () => (clips || []).reduce((sum, c) => sum + (c.blob?.size || 0), 0),
    [clips],
  );

  const handleGenerateAll = async () => {
    if (missingItems.length === 0) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setBulkProgress({
      completed: 0,
      succeeded: 0,
      failed: 0,
      total: missingItems.length,
      activeJobs: [],
      current: '',
      failures: [],
    });
    setBulkError(null);
    setBulkSummary(null);

    try {
      const result = await generateAudioForWords(missingItems, {
        signal: controller.signal,
        getText: (item) => getPreferredChineseText(item, preferredScript),
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

  const handleDeleteOrphans = async () => {
    if (orphanClips.length === 0) return;
    if (!confirm(`Delete ${orphanClips.length} orphaned audio clip${orphanClips.length === 1 ? '' : 's'}?`)) {
      return;
    }
    await Promise.all(orphanClips.map(clip => deleteCachedAudio(clip.text)));
    setShowOrphansOnly(false);
  };

  const loading = (wordsLoading && !words) || (sentencesLoading && !sentences) || (clipsLoading && !clips);
  const error = wordsError || sentencesError || clipsError;
  if (loading) return <p>Loading audio cache...</p>;
  if (error) return <p>Error loading audio: {error.message}</p>;

  return (
    <div>
      <div className={styles.sectionHeader}>
        <div>
          <h2>
            Audio
            {showOrphansOnly && (
              <span className={styles.filterIndicator}>
                {' — '}Orphans
                <button className={styles.clearFilter} onClick={() => setShowOrphansOnly(false)}>×</button>
              </span>
            )}
          </h2>
          <p className={styles.sectionMeta}>
            {(clips || []).length} clips · {formatBytes(totalBytes)} stored · {missingItems.length} missing
            {orphanClips.length > 0 && (
              <>
                {' · '}
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => setShowOrphansOnly(true)}
                >
                  {orphanClips.length} orphaned
                </button>
              </>
            )}
          </p>
        </div>
        <div className={styles.importToolbarActions}>
          {bulkProgress ? (
            <button className={styles.secondaryButton} onClick={handleCancel}>
              Cancel
            </button>
          ) : showOrphansOnly ? (
            <button
              className={styles.primaryButton}
              onClick={handleDeleteOrphans}
              disabled={orphanClips.length === 0}
            >
              Delete {orphanClips.length} Orphans
            </button>
          ) : (
            <button
              className={styles.primaryButton}
              onClick={handleGenerateAll}
              disabled={missingItems.length === 0}
            >
              Generate {missingItems.length} Missing
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

      {showOrphansOnly ? (
        orphanClips.length === 0 ? (
          <div className={styles.emptyState}>
            <p>No orphaned clips</p>
          </div>
        ) : (
          <ul className={styles.wordList}>
            {orphanClips.map(clip => (
              <ClipRow key={clip.text} clip={clip} entities={[]} />
            ))}
          </ul>
        )
      ) : linkedClips.length === 0 ? (
        <div className={styles.emptyState}>
          <p>No audio clips yet</p>
          <p>Generate audio for your words and sentences to populate the cache</p>
        </div>
      ) : (
        <>
          {linkedClips.length > CLIP_RENDER_LIMIT && (
            <p className={styles.wordFilterCount}>
              Showing first {CLIP_RENDER_LIMIT} of {linkedClips.length} clips
            </p>
          )}
          <ul className={styles.wordList}>
            {linkedClips.slice(0, CLIP_RENDER_LIMIT).map(clip => (
              <ClipRow key={clip.text} clip={clip} entities={entityIndex.get(clip.text)} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
