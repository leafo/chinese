import { useState, useRef, useCallback, useEffect } from "react";
import styles from "./index.module.css";
import { useCollections } from "./collections";
import { CollectionSelector } from "./CollectionSelector";
import { getAllWords } from "./words";
import { generateSentences, generateTts as geminiTts } from "./gemini";
import { playBlob, stopCurrentAudio } from "./audio";
import { useConfig } from "./config";
import { ApiKeyWarning } from "./ApiKeyWarning";
import { DEFAULT_DISPLAY_SCRIPT, getPreferredChineseText } from "./display";
import { StreamingPreview } from "./StreamingPreview";

const AUDIO_CONCURRENCY = 3;

async function getTtsFunction(provider) {
  if (provider === 'openai') {
    const { generateTts } = await import('./openai.js');
    return generateTts;
  }
  return geminiTts;
}

function SentencePlayButton({ sentence, onAudioReady, ttsProvider }) {
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const mountedRef = useRef(true);
  const audioRef = useRef(null);
  const requestAbortRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      requestAbortRef.current?.abort();
      audioRef.current?.pause();
    };
  }, []);

  const trackAudio = useCallback((audio) => {
    audioRef.current = audio;
    setPlaying(true);

    const cleanup = () => {
      if (audioRef.current === audio) audioRef.current = null;
      if (mountedRef.current) setPlaying(false);
    };

    audio.addEventListener('ended', cleanup, { once: true });
    audio.addEventListener('error', cleanup, { once: true });
    audio.addEventListener('pause', cleanup, { once: true });
  }, []);

  const handlePlay = async (e) => {
    e.stopPropagation();

    if (sentence.audioBlob) {
      const audio = playBlob(sentence.audioBlob);
      trackAudio(audio);
      await audio.play();
      return;
    }

    setLoading(true);
    requestAbortRef.current?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;

    try {
      const tts = await getTtsFunction(ttsProvider);
      const result = await tts(sentence.simplified, { signal: controller.signal });
      if (mountedRef.current && !controller.signal.aborted) {
        onAudioReady(sentence.id, result.blob);
        const audio = playBlob(result.blob);
        trackAudio(audio);
        await audio.play();
      }
    } catch (err) {
      if (err.name === 'AbortError' || controller.signal.aborted) {
        return;
      }
      console.error('Sentence audio failed:', err);
      if (mountedRef.current) {
        audioRef.current = null;
        setPlaying(false);
      }
    } finally {
      if (requestAbortRef.current === controller) {
        requestAbortRef.current = null;
      }
      if (mountedRef.current) setLoading(false);
    }
  };

  return (
    <button
      className={`${styles.smallButton} ${styles.playButton} ${sentence.audioBlob ? styles.playButtonCached : ''}`}
      onClick={handlePlay}
      disabled={loading || playing}
      title={sentence.audioBlob ? 'Play audio' : 'Generate & play audio'}
    >
      {loading ? '...' : playing
        ? <svg width="10" height="10" viewBox="0 0 10 10"><rect width="10" height="10" fill="currentColor"/></svg>
        : <svg width="10" height="10" viewBox="0 0 10 10"><polygon points="0,0 10,5 0,10" fill="currentColor"/></svg>}
    </button>
  );
}

function SentenceCard({ sentence, index, displayScript, pinyinMap, ttsProvider, onAudioReady }) {
  const chineseText = getPreferredChineseText(sentence, displayScript);

  return (
    <div className={styles.sentenceCard}>
      <div className={styles.sentenceMain}>
        <div className={styles.sentenceIndex}>{index + 1}</div>
        <div className={styles.sentenceContent}>
          <div className={styles.sentenceChinese}>
            <SentencePlayButton
              sentence={sentence}
              ttsProvider={ttsProvider}
              onAudioReady={onAudioReady}
            />
            <span>{chineseText}</span>
          </div>
          <div className={styles.sentencePinyin}>{sentence.pinyin}</div>
          <div className={styles.sentenceEnglish}>{sentence.english}</div>
          {sentence.words_used && sentence.words_used.length > 0 && (
            <div className={styles.sentenceWordsUsed}>
              {sentence.words_used.map((word, i) => (
                <span key={i} className={styles.tag} title={pinyinMap?.[word]}>{word}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function GenerateSentences() {
  const [collections, collectionsError, collectionsLoading] = useCollections();
  const [displayScript] = useConfig('display_script');
  const [selectedCollectionIds, setSelectedCollectionIds] = useState([]);
  const [count, setCount] = useState('');
  const [additionalInstructions, setAdditionalInstructions] = useState('');
  const [sentences, setSentences] = useState([]);
  const [generationStatus, setGenerationStatus] = useState('idle');
  const [generationError, setGenerationError] = useState(null);

  const [audioProgress, setAudioProgress] = useState(null);
  const [streamText, setStreamText] = useState('');
  const [ttsProvider, setTtsProvider] = useState('gemini');
  const [sentenceProvider, setSentenceProvider] = useState('gemini');
  const [pinyinMap, setPinyinMap] = useState({});
  const abortRef = useRef(null);
  const runRef = useRef(0);
  const preferredScript = displayScript || DEFAULT_DISPLAY_SCRIPT;

  const invalidateActiveWork = useCallback(({ invalidateRun = false } = {}) => {
    if (invalidateRun) {
      runRef.current += 1;
    }

    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      invalidateActiveWork({ invalidateRun: true });
      stopCurrentAudio();
    };
  }, [invalidateActiveWork]);

  const handleToggleCollection = (id) => {
    setSelectedCollectionIds(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  const handleGenerate = async () => {
    invalidateActiveWork({ invalidateRun: true });
    const runId = runRef.current;

    setGenerationStatus('generating');
    setGenerationError(null);
    setSentences([]);
    setAudioProgress(null);
    setStreamText('');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const allWords = await getAllWords();
      const lookup = {};
      for (const w of allWords) {
        if (w.simplified) lookup[w.simplified] = w.pinyin;
        if (w.traditional) lookup[w.traditional] = w.pinyin;
      }
      setPinyinMap(lookup);

      const filteredWords = selectedCollectionIds.length > 0
        ? allWords.filter(w =>
            w.collection_ids?.some(id => selectedCollectionIds.includes(id))
          )
        : allWords;

      if (filteredWords.length === 0) {
        throw new Error('No words found in the selected collections.');
      }

      const objectives = selectedCollectionIds.length > 0 && collections
        ? collections
            .filter(c => selectedCollectionIds.includes(c.id) && c.objectives)
            .map(c => c.objectives)
            .join('\n')
        : '';

      const genFn = sentenceProvider === 'openai'
        ? (await import('./openai.js')).generateSentences
        : generateSentences;

      const result = await genFn(filteredWords, {
        count: count ? Number(count) : undefined,
        objectives: objectives || undefined,
        additionalInstructions: additionalInstructions.trim() || undefined,
        signal: controller.signal,
        onChunk: (_chunk, fullText) => {
          if (abortRef.current === controller && !controller.signal.aborted) {
            setStreamText(fullText);
          }
        },
      });

      if (controller.signal.aborted || runRef.current !== runId) return;

      const enriched = (result.sentences || []).map((s, i) => ({
        ...s,
        id: `${runId}-${i}`,
        audioBlob: null,
        audioStatus: 'idle',
        audioError: null,
      }));

      if (runRef.current !== runId || controller.signal.aborted) return;
      setSentences(enriched);
      setGenerationStatus('done');
    } catch (err) {
      if (err.name === 'AbortError' || controller.signal.aborted) {
        if (runRef.current === runId) {
          setGenerationStatus('idle');
        }
        return;
      }
      if (runRef.current !== runId) return;
      setGenerationError(err);
      setGenerationStatus('error');
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setAudioProgress(null);

    if (generationStatus === 'generating') {
      setGenerationStatus('idle');
    }
  };

  const handleSentenceAudioReady = (sentenceId, blob) => {
    setSentences(prev => prev.map((s) =>
      s.id === sentenceId ? { ...s, audioBlob: blob, audioStatus: 'ready' } : s
    ));
  };

  const handleGenerateAllAudio = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const runId = runRef.current;

    const toGenerate = sentences.filter(s => !s.audioBlob);
    const total = toGenerate.length;
    let completed = 0;

    setAudioProgress({ completed: 0, total });

    const tts = await getTtsFunction(ttsProvider);
    const queue = [...toGenerate];
    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < queue.length) {
        if (controller.signal.aborted) return;

        const current = nextIndex++;
        const sentence = queue[current];

        try {
          const result = await tts(sentence.simplified, { signal: controller.signal });
          if (controller.signal.aborted || runRef.current !== runId) return;

          setSentences(prev => prev.map(s =>
            s.id === sentence.id ? { ...s, audioBlob: result.blob, audioStatus: 'ready' } : s
          ));
        } catch (err) {
          if (err.name === 'AbortError' || controller.signal.aborted) return;
          if (runRef.current !== runId) return;
          console.error(`Audio failed for sentence ${sentence.id}:`, err);
          setSentences(prev => prev.map(s =>
            s.id === sentence.id ? { ...s, audioStatus: 'error', audioError: err.message } : s
          ));
        }

        completed++;
        if (controller.signal.aborted || runRef.current !== runId) return;
        setAudioProgress({ completed, total });
      }
    };

    try {
      const workerCount = Math.min(AUDIO_CONCURRENCY, total);
      await Promise.all(Array.from({ length: workerCount }, () => worker()));

      if (!controller.signal.aborted && runRef.current === runId) {
        setAudioProgress(null);
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  };

  const handleReset = () => {
    invalidateActiveWork({ invalidateRun: true });
    stopCurrentAudio();
    setSentences([]);
    setGenerationStatus('idle');
    setGenerationError(null);
    setAudioProgress(null);
  };

  const audioCount = sentences.filter(s => s.audioBlob).length;
  const uniqueWordsUsed = [...new Set(sentences.flatMap(s => s.words_used || []))];

  return (
    <div>
      <div className={styles.sectionHeader}>
        <h2>Generate Sentences</h2>
      </div>

      <ApiKeyWarning />

      {generationStatus === 'idle' && sentences.length === 0 && (
        <div className={styles.form}>
          <div className={styles.formField}>
            <label>Collections</label>
            <CollectionSelector
              collections={collections}
              loading={collectionsLoading}
              error={collectionsError}
              selectedIds={selectedCollectionIds}
              onToggle={handleToggleCollection}
              emptyMessage="No collections yet. Create one in the Collections tab."
            />
            {selectedCollectionIds.length === 0 && collections?.length > 0 && (
              <p className={styles.formHint}>No collections selected — will use all words.</p>
            )}
          </div>

          <div className={styles.formField}>
            <label>Number of sentences</label>
            <input
              type="number"
              min={1}
              max={50}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              placeholder="Optional"
            />
          </div>

          <div className={styles.formField}>
            <label>Additional instructions (optional)</label>
            <textarea
              rows={3}
              placeholder="e.g. Focus on food-related topics, use past tense..."
              value={additionalInstructions}
              onChange={(e) => setAdditionalInstructions(e.target.value)}
            />
          </div>

          <div className={styles.formField}>
            <label>Provider</label>
            <select value={sentenceProvider} onChange={e => setSentenceProvider(e.target.value)}>
              <option value="gemini">Gemini</option>
              <option value="openai">OpenAI</option>
            </select>
          </div>

          <div className={styles.formActions}>
            <div />
            <button className={styles.primaryButton} onClick={handleGenerate}>
              Generate Sentences
            </button>
          </div>
        </div>
      )}

      <StreamingPreview
        active={generationStatus === 'generating'}
        streamText={streamText}
        meta={count ? `Sentences: ${count}` : undefined}
        onCancel={handleCancel}
      />

      {generationStatus === 'error' && (
        <div>
          <div className={styles.errorBox}>
            <p>{generationError?.message || String(generationError)}</p>
          </div>
          <button className={styles.primaryButton} onClick={handleReset} style={{ marginTop: 12 }}>
            Try Again
          </button>
        </div>
      )}

      {generationStatus === 'done' && sentences.length > 0 && (
        <div>
          <div className={styles.sentenceToolbar}>
            <p className={styles.formHint}>
              Generated {sentences.length} sentences using {uniqueWordsUsed.length} vocabulary words
            </p>
            <div className={styles.sentenceToolbarActions}>
              <select value={ttsProvider} onChange={e => setTtsProvider(e.target.value)}>
                <option value="gemini">Gemini TTS</option>
                <option value="openai">OpenAI TTS</option>
              </select>
              {audioCount < sentences.length && !abortRef.current && (
                <button className={styles.primaryButton} onClick={handleGenerateAllAudio}>
                  Generate All Audio ({sentences.length - audioCount} remaining)
                </button>
              )}
              {abortRef.current && (
                <button className={styles.secondaryButton} onClick={handleCancel}>
                  Cancel Audio
                </button>
              )}
              <button className={styles.secondaryButton} onClick={handleReset}>
                New Generation
              </button>
            </div>
          </div>

          {audioProgress && audioProgress.total > 0 && (
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{ width: `${(audioProgress.completed / audioProgress.total) * 100}%` }}
              />
            </div>
          )}

          <div className={styles.sentenceList}>
            {sentences.map((sentence, index) => (
              <SentenceCard
                key={sentence.id}
                sentence={sentence}
                index={index}
                displayScript={preferredScript}
                pinyinMap={pinyinMap}
                ttsProvider={ttsProvider}
                onAudioReady={handleSentenceAudioReady}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
