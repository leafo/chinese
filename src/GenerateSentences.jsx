import { useState, useRef, useCallback, useEffect } from "react";
import styles from "./index.module.css";
import { useCollections } from "./collections";
import { CollectionSelector } from "./CollectionSelector";
import { getAllWords } from "./words";
import { generateSentences as geminiGenerateSentences, generateTts as geminiTts } from "./gemini";
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

function SentenceForm({ onComplete }) {
  const [collections, collectionsError, collectionsLoading] = useCollections();
  const [selectedCollectionIds, setSelectedCollectionIds] = useState([]);
  const [count, setCount] = useState('');
  const [additionalInstructions, setAdditionalInstructions] = useState('');
  const [sentenceProvider, setSentenceProvider] = useState('gemini');
  const [status, setStatus] = useState('idle'); // idle | generating | error
  const [error, setError] = useState(null);
  const [streamText, setStreamText] = useState('');
  const abortRef = useRef(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleToggleCollection = (id) => {
    setSelectedCollectionIds(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus('idle');
  };

  const handleGenerate = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('generating');
    setError(null);
    setStreamText('');

    try {
      const allWords = await getAllWords();
      const pinyinMap = {};
      for (const w of allWords) {
        if (w.simplified) pinyinMap[w.simplified] = w.pinyin;
        if (w.traditional) pinyinMap[w.traditional] = w.pinyin;
      }

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
        : geminiGenerateSentences;

      const result = await genFn(filteredWords, {
        count: count ? Number(count) : undefined,
        objectives: objectives || undefined,
        additionalInstructions: additionalInstructions.trim() || undefined,
        signal: controller.signal,
        onChunk: (_chunk, fullText) => {
          if (!controller.signal.aborted) {
            setStreamText(fullText);
          }
        },
      });

      if (controller.signal.aborted) return;

      const sentences = (result.sentences || []).map((s, i) => ({
        ...s,
        id: `gen-${Date.now()}-${i}`,
        audioBlob: null,
        audioStatus: 'idle',
        audioError: null,
      }));

      onComplete({ sentences, pinyinMap });
    } catch (err) {
      if (err.name === 'AbortError' || controller.signal.aborted) {
        setStatus('idle');
        return;
      }
      setError(err);
      setStatus('error');
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  };

  if (status === 'generating') {
    return (
      <StreamingPreview
        active={true}
        streamText={streamText}
        meta={count ? `Sentences: ${count}` : undefined}
        onCancel={handleCancel}
      />
    );
  }

  return (
    <div>
      {status === 'error' && (
        <div className={styles.errorBox} style={{ marginBottom: 12 }}>
          <p>{error?.message || String(error)}</p>
        </div>
      )}

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
    </div>
  );
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

function SentenceResults({ initialSentences, pinyinMap, onReset }) {
  const [displayScript] = useConfig('display_script');
  const [sentences, setSentences] = useState(initialSentences);
  const [ttsProvider, setTtsProvider] = useState('gemini');
  const [audioProgress, setAudioProgress] = useState(null);
  const abortRef = useRef(null);
  const preferredScript = displayScript || DEFAULT_DISPLAY_SCRIPT;

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      stopCurrentAudio();
    };
  }, []);

  const handleAudioReady = (sentenceId, blob) => {
    setSentences(prev => prev.map(s =>
      s.id === sentenceId ? { ...s, audioBlob: blob, audioStatus: 'ready' } : s
    ));
  };

  const handleCancelAudio = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setAudioProgress(null);
  };

  const handleGenerateAllAudio = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

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
          if (controller.signal.aborted) return;

          setSentences(prev => prev.map(s =>
            s.id === sentence.id ? { ...s, audioBlob: result.blob, audioStatus: 'ready' } : s
          ));
        } catch (err) {
          if (err.name === 'AbortError' || controller.signal.aborted) return;
          console.error(`Audio failed for sentence ${sentence.id}:`, err);
          setSentences(prev => prev.map(s =>
            s.id === sentence.id ? { ...s, audioStatus: 'error', audioError: err.message } : s
          ));
        }

        completed++;
        if (controller.signal.aborted) return;
        setAudioProgress({ completed, total });
      }
    };

    try {
      const workerCount = Math.min(AUDIO_CONCURRENCY, total);
      await Promise.all(Array.from({ length: workerCount }, () => worker()));

      if (!controller.signal.aborted) {
        setAudioProgress(null);
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  };

  const audioCount = sentences.filter(s => s.audioBlob).length;
  const uniqueWordsUsed = [...new Set(sentences.flatMap(s => s.words_used || []))];

  return (
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
            <button className={styles.secondaryButton} onClick={handleCancelAudio}>
              Cancel Audio
            </button>
          )}
          <button className={styles.secondaryButton} onClick={onReset}>
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
            onAudioReady={handleAudioReady}
          />
        ))}
      </div>
    </div>
  );
}

export function GenerateSentences() {
  const [result, setResult] = useState(null);

  return (
    <div>
      <div className={styles.sectionHeader}>
        <h2>Generate Sentences</h2>
      </div>

      <ApiKeyWarning />

      {result ? (
        <SentenceResults
          key={result.key}
          initialSentences={result.sentences}
          pinyinMap={result.pinyinMap}
          onReset={() => setResult(null)}
        />
      ) : (
        <SentenceForm
          onComplete={({ sentences, pinyinMap }) =>
            setResult({ sentences, pinyinMap, key: Date.now() })
          }
        />
      )}
    </div>
  );
}
