import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import styles from "./index.module.css";
import { useAllSentences } from "./sentences";
import { useCollections } from "./collections";
import { CollectionSelector } from "./CollectionSelector";
import { useConfig } from "./config";
import { DEFAULT_DISPLAY_SCRIPT, getPreferredChineseText } from "./display";
import {
  audioKey, getOrGenerateAudio, playRecord, stopCurrentAudio, isInManifest, useCachedAudioKeys,
} from "./audio";
import { AudioPlayIcon } from "./AudioPlayIcon";

const DEFAULT_SETTINGS = {
  collectionIds: [],
  order: 'shuffle',
  auto: false,
  plays: 1,
  gapSeconds: 4,
  holdSeconds: 5,
  loop: false,
  showChinese: false,
};

const GAP_OPTIONS = [2, 4, 6, 8];
const HOLD_OPTIONS = [3, 5, 8];
// Silence between repeats when a sentence plays more than once
const REPEAT_PAUSE_MS = 700;

// Reveal stages: nothing, what was said (characters + pinyin), what it means
const REVEAL_SAID = 1;
const REVEAL_MEANING = 2;

function shuffle(list) {
  const result = [...list];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Resolves when the clip finishes, is stopped, or fails, so callers can just
// await it in sequence. Checks for cancellation after loading so a clip that
// was still loading when the user skipped or quit never starts.
async function playToEnd(sentence, isCancelled, onPlaying) {
  let record;
  try {
    record = await getOrGenerateAudio(audioKey(sentence.pinyin), {
      chineseText: sentence.simplified || sentence.traditional,
    });
  } catch (err) {
    console.error('Audio playback failed:', err);
    return;
  }
  if (isCancelled()) return;

  const audio = playRecord(record);
  onPlaying(true);
  await new Promise(resolve => {
    for (const event of ['ended', 'pause', 'error']) {
      audio.addEventListener(event, resolve, { once: true });
    }
    audio.play().catch(resolve);
  });
  onPlaying(false);
}

function buildQueue(sentences, settings, collections) {
  if (settings.order === 'shuffle') return shuffle(sentences);

  const position = new Map(collections.map((c, i) => [c.id, i]));
  const chapterIndex = (sentence) => Math.min(
    ...(sentence.collection_ids || []).map(id => position.get(id) ?? Infinity)
  );
  return [...sentences].sort((a, b) => chapterIndex(a) - chapterIndex(b) || a.id - b.id);
}

function ListenSession({ queue, settings, onSettingsChange, chapterName, displayScript, onFinish, onQuit }) {
  const [index, setIndex] = useState(0);
  const [reveal, setReveal] = useState(0);
  const [paused, setPaused] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [audioDone, setAudioDone] = useState(false);
  // A new nonce restarts playback, even when the index doesn't change
  const [playRequest, setPlayRequest] = useState({ nonce: 0, count: settings.plays });
  const sentence = queue[index];

  const goTo = useCallback((nextIndex) => {
    if (nextIndex < 0) return;
    if (nextIndex >= queue.length) {
      if (!settings.loop) {
        onFinish(queue.length);
        return;
      }
      nextIndex = 0;
    }
    setIndex(nextIndex);
    setReveal(0);
    setPlayRequest(r => ({ nonce: r.nonce + 1, count: settings.plays }));
  }, [queue.length, settings.loop, settings.plays, onFinish]);

  // The auto timer calls through a ref so unrelated re-renders don't restart it
  const goToRef = useRef(goTo);
  goToRef.current = goTo;

  const replay = () => setPlayRequest(r => ({ nonce: r.nonce + 1, count: 1 }));

  const advance = () => {
    if (reveal >= REVEAL_MEANING) goTo(index + 1);
    else setReveal(settings.auto ? REVEAL_MEANING : reveal + 1);
  };

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    setAudioDone(false);

    (async () => {
      for (let i = 0; i < playRequest.count; i++) {
        if (i > 0) await new Promise(resolve => { timer = setTimeout(resolve, REPEAT_PAUSE_MS); });
        if (cancelled) return;
        await playToEnd(sentence, () => cancelled, setPlaying);
        if (cancelled) return;
      }
      setAudioDone(true);
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      stopCurrentAudio();
    };
  }, [sentence, playRequest]);

  useEffect(() => {
    if (!settings.auto || paused || !audioDone) return;
    const timer = reveal < REVEAL_MEANING
      ? setTimeout(() => setReveal(REVEAL_MEANING), settings.gapSeconds * 1000)
      : setTimeout(() => goToRef.current(index + 1), settings.holdSeconds * 1000);
    return () => clearTimeout(timer);
  }, [settings.auto, settings.gapSeconds, settings.holdSeconds, paused, audioDone, reveal, index]);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT') return;
      if (e.key === ' ' || e.key === 'Enter') {
        // A focused button already turns these into a click.
        if (tag === 'BUTTON') return;
        e.preventDefault();
        advance();
      } else if (e.key === 'r') {
        replay();
      } else if (e.key === 'ArrowRight') {
        goTo(index + 1);
      } else if (e.key === 'ArrowLeft') {
        goTo(index - 1);
      } else if (e.key === 'p' && settings.auto) {
        setPaused(p => !p);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  const showChinese = settings.showChinese || reveal >= REVEAL_SAID;
  let advanceLabel = 'Next';
  if (reveal < REVEAL_MEANING) {
    if (settings.auto) advanceLabel = 'Reveal';
    else if (reveal < REVEAL_SAID) advanceLabel = settings.showChinese ? 'Show pinyin' : 'Show sentence';
    else advanceLabel = 'Show meaning';
  }

  return (
    <div className={styles.exerciseFrame}>
      <div className={styles.exerciseTopBar}>
        <button type="button" className={styles.exerciseQuit} onClick={onQuit} title="Stop listening">×</button>
        <progress className={styles.exerciseProgress} value={index} max={queue.length} />
        <span className={styles.exerciseCounter}>{index + 1} / {queue.length}</span>
      </div>

      <div className={styles.exercisePrompt}>
        {chapterName(sentence) && <div className={styles.listenChapter}>{chapterName(sentence)}</div>}
        <div className={styles.exerciseListen}>
          <button
            type="button"
            className={`${styles.smallButton} ${styles.playButton} ${styles.playButtonCached}`}
            onClick={replay}
            disabled={playing}
            title="Replay (R)"
          >
            <AudioPlayIcon playing={playing} />
          </button>
          <span className={styles.exerciseListenLabel}>Tap to play again</span>
        </div>
        {showChinese && (
          <div className={styles.exercisePromptChinese}>{getPreferredChineseText(sentence, displayScript)}</div>
        )}
        {reveal >= REVEAL_SAID && <div className={styles.exercisePromptPinyin}>{sentence.pinyin}</div>}
        {reveal >= REVEAL_MEANING && <div className={styles.listenEnglish}>{sentence.english}</div>}
        {!showChinese && <div className={styles.exerciseHint}>What did you hear?</div>}
      </div>

      <div className={styles.listenControls}>
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={settings.auto}
            onChange={e => { setPaused(false); onSettingsChange({ auto: e.target.checked }); }}
          />
          <span>Auto</span>
        </label>
        {settings.auto && (
          <button type="button" className={styles.secondaryButton} onClick={() => setPaused(p => !p)} title="Pause (P)">
            {paused ? 'Resume' : 'Pause'}
          </button>
        )}
        <div className={styles.listenControlsEnd}>
          <button type="button" className={styles.secondaryButton} onClick={() => goTo(index - 1)} disabled={index === 0} title="Previous (←)">
            Back
          </button>
          <button type="button" className={styles.primaryButton} onClick={advance} title="Space">
            {advanceLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function ListenStart({ collections, loading, settings, onSettingsChange, counts, onStart }) {
  const toggleCollection = (id) => onSettingsChange({
    collectionIds: settings.collectionIds.includes(id)
      ? settings.collectionIds.filter(x => x !== id)
      : [...settings.collectionIds, id],
  });
  const allSelected = collections?.length > 0 && collections.every(c => settings.collectionIds.includes(c.id));

  return (
    <div>
      <h2>Listen</h2>
      <p className={styles.learnDescription}>
        Listening comprehension practice. Each sentence plays with the text hidden;
        work out what you heard, then reveal what was said and what it means.
      </p>

      <div className={styles.sectionHeader}>
        <h3 className={styles.exerciseSectionTitle}>Chapters</h3>
        {collections?.length > 0 && (
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => onSettingsChange({ collectionIds: allSelected ? [] : collections.map(c => c.id) })}
          >{allSelected ? 'Clear all' : 'Select all'}</button>
        )}
      </div>
      <CollectionSelector
        collections={collections}
        loading={loading}
        selectedIds={settings.collectionIds}
        onToggle={toggleCollection}
        emptyMessage="No collections with sentences yet."
      />
      <p className={styles.formHint}>
        {counts.playable} sentences with audio
        {counts.missingAudio > 0 && ` (${counts.missingAudio} without audio will be skipped)`}
      </p>

      <div className={styles.learnOptions}>
        <div className={styles.listenOptionGrid}>
          <div className={styles.formField}>
            <label htmlFor="listen-order">Order</label>
            <select id="listen-order" value={settings.order} onChange={e => onSettingsChange({ order: e.target.value })}>
              <option value="shuffle">Shuffled</option>
              <option value="book">Book order</option>
            </select>
          </div>
          <div className={styles.formField}>
            <label htmlFor="listen-plays">Play each sentence</label>
            <select id="listen-plays" value={settings.plays} onChange={e => onSettingsChange({ plays: Number(e.target.value) })}>
              <option value={1}>Once</option>
              <option value={2}>Twice</option>
            </select>
          </div>
          {settings.auto && (
            <>
              <div className={styles.formField}>
                <label htmlFor="listen-gap">Think time before reveal</label>
                <select id="listen-gap" value={settings.gapSeconds} onChange={e => onSettingsChange({ gapSeconds: Number(e.target.value) })}>
                  {GAP_OPTIONS.map(n => <option key={n} value={n}>{n} seconds</option>)}
                </select>
              </div>
              <div className={styles.formField}>
                <label htmlFor="listen-hold">Show answer for</label>
                <select id="listen-hold" value={settings.holdSeconds} onChange={e => onSettingsChange({ holdSeconds: Number(e.target.value) })}>
                  {HOLD_OPTIONS.map(n => <option key={n} value={n}>{n} seconds</option>)}
                </select>
              </div>
            </>
          )}
        </div>
        <div className={styles.exerciseTypeList}>
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={settings.auto} onChange={e => onSettingsChange({ auto: e.target.checked })} />
            <span>Auto mode: reveal and move on by itself</span>
          </label>
          {settings.auto && (
            <label className={styles.checkboxRow}>
              <input type="checkbox" checked={settings.loop} onChange={e => onSettingsChange({ loop: e.target.checked })} />
              <span>Start over when finished</span>
            </label>
          )}
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={settings.showChinese} onChange={e => onSettingsChange({ showChinese: e.target.checked })} />
            <span>Show the characters while listening</span>
          </label>
        </div>
      </div>

      <button type="button" className={styles.primaryButton} onClick={onStart} disabled={counts.playable === 0}>
        Start
      </button>
    </div>
  );
}

export function Listen() {
  const [displayScript] = useConfig("display_script");
  const script = displayScript || DEFAULT_DISPLAY_SCRIPT;
  const [savedSettings, setSavedSettings] = useConfig("listen_settings");
  const [collections, , collectionsLoading] = useCollections();
  const [allSentences] = useAllSentences();
  const [cachedKeys] = useCachedAudioKeys();

  const [session, setSession] = useState(null);
  const [finished, setFinished] = useState(null);

  const settings = { ...DEFAULT_SETTINGS, ...savedSettings };
  const updateSettings = (changes) => setSavedSettings({ ...settings, ...changes });

  const collectionsWithSentences = useMemo(() => {
    if (!collections) return collections;
    const ids = new Set((allSentences || []).flatMap(s => s.collection_ids || []));
    return collections.filter(c => ids.has(c.id));
  }, [collections, allSentences]);

  const selectedKey = settings.collectionIds.join(',');
  const { playable, missingAudio } = useMemo(() => {
    const selected = new Set(settings.collectionIds);
    const inChapters = (allSentences || []).filter(s => (s.collection_ids || []).some(id => selected.has(id)));
    const hasAudio = (s) => {
      const key = s.pinyin ? audioKey(s.pinyin) : '';
      return Boolean(key) && (isInManifest(key) || Boolean(cachedKeys?.has(key)));
    };
    const withAudio = inChapters.filter(hasAudio);
    return { playable: withAudio, missingAudio: inChapters.length - withAudio.length };
  }, [allSentences, cachedKeys, selectedKey]);

  const chapterName = useCallback((sentence) => {
    const ids = new Set(settings.collectionIds);
    const match = (collections || []).find(c => ids.has(c.id) && (sentence.collection_ids || []).includes(c.id));
    return match?.name || '';
  }, [collections, selectedKey]);

  const start = () => {
    const queue = buildQueue(playable, settings, collectionsWithSentences || []);
    if (queue.length === 0) return;
    setFinished(null);
    setSession({ queue, nonce: Date.now() });
  };

  const handleFinish = useCallback((count) => {
    setSession(null);
    setFinished(count);
  }, []);

  if (session) {
    return (
      <ListenSession
        key={session.nonce}
        queue={session.queue}
        settings={settings}
        onSettingsChange={updateSettings}
        chapterName={chapterName}
        displayScript={script}
        onFinish={handleFinish}
        onQuit={() => setSession(null)}
      />
    );
  }

  if (finished != null) {
    return (
      <div className={styles.exerciseSummary}>
        <h2>Done</h2>
        <p className={styles.learnDescription}>You listened to {finished} sentence{finished === 1 ? '' : 's'}.</p>
        <div className={styles.importToolbarActions}>
          <button type="button" className={styles.secondaryButton} onClick={() => setFinished(null)}>Change settings</button>
          <button type="button" className={styles.primaryButton} onClick={start}>Listen again</button>
        </div>
      </div>
    );
  }

  return (
    <ListenStart
      collections={collectionsWithSentences}
      loading={collectionsLoading}
      settings={settings}
      onSettingsChange={updateSettings}
      counts={{ playable: playable.length, missingAudio }}
      onStart={start}
    />
  );
}
