import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import styles from "./index.module.css";
import { useAllWords } from "./words";
import { useAllSentences } from "./sentences";
import { useCollections } from "./collections";
import { CollectionSelector } from "./CollectionSelector";
import { useConfig } from "./config";
import { DEFAULT_DISPLAY_SCRIPT, getPreferredChineseText } from "./display";
import { PlayButton } from "./PlayButton";
import { SyllablePicker } from "./SyllablePicker";
import { audioKey, playAudio, stopCurrentAudio, isInManifest, getCachedAudio } from "./audio";
import { useElapsedTimer } from "./useElapsedTimer";
import { useShaker } from "./util";
import {
  EXERCISE_TYPES,
  buildPool,
  buildQueue,
  buildFocusQueue,
  createSessionContext,
  retryExercise,
  itemKey,
} from "./exerciseSession";

const LENGTH_OPTIONS = [10, 20, 30];
const CHOICE_TYPES = new Set(['zh2en', 'en2zh', 'listen']);
// Exercise types whose prompt already played the word
const HEARD_TYPES = new Set(['zh2en', 'listen']);
// A retry lands a few exercises after the miss so it tests recall rather
// than the answer just shown; jitter keeps the distance unpredictable.
const RETRY_GAP = 3;
const RETRY_JITTER = 2;

function formatDuration(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// Only plays clips already cached or in the manifest, so mounting an exercise
// never spends a TTS call. The play button still generates on demand.
function useAutoPlay(item, enabled) {
  useEffect(() => {
    if (!enabled || !item?.pinyin) return;
    const text = audioKey(item.pinyin);
    const chineseText = item.simplified || item.traditional;
    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      const available = isInManifest(text) || Boolean(await getCachedAudio(text));
      if (cancelled || !available) return;
      await playAudio(text, { chineseText, signal: controller.signal });
    })().catch(() => {});

    return () => {
      cancelled = true;
      controller.abort();
      stopCurrentAudio();
    };
  }, [item, enabled]);
}

function ItemAnswer({ item, displayScript, autoPlay = false }) {
  useAutoPlay(item, autoPlay);
  return (
    <div className={styles.exerciseAnswer}>
      <span className={styles.exerciseAnswerChinese}>{getPreferredChineseText(item, displayScript)}</span>
      {item.pinyin && <span className={styles.exerciseAnswerPinyin}>{item.pinyin}</span>}
      <span className={styles.exerciseAnswerEnglish}>{item.english}</span>
      {item.pinyin && <PlayButton word={item} />}
    </div>
  );
}

function ChoiceExercise({ exercise, displayScript, selected, onSelect, answered }) {
  const { type, item, options } = exercise;
  useAutoPlay(item, type === 'listen' || type === 'zh2en');

  const optionClass = (option) => {
    const classes = [styles.exerciseChoice];
    if (answered) {
      if (option.id === item.id) classes.push(styles.exerciseChoiceCorrect);
      else if (option.id === selected) classes.push(styles.exerciseChoiceWrong);
    } else if (option.id === selected) {
      classes.push(styles.exerciseChoiceSelected);
    }
    return classes.join(' ');
  };

  return (
    <>
      <div className={styles.exercisePrompt}>
        {type === 'zh2en' && (
          <>
            <div className={styles.exerciseHint}>What does this mean?</div>
            <div className={styles.exercisePromptChinese}>{getPreferredChineseText(item, displayScript)}</div>
            <div className={styles.exercisePromptPinyin}>{item.pinyin}</div>
            {item.pinyin && <PlayButton word={item} />}
          </>
        )}
        {type === 'en2zh' && (
          <>
            <div className={styles.exerciseHint}>How do you say this in Chinese?</div>
            <div className={styles.exercisePromptEnglish}>{item.english}</div>
          </>
        )}
        {type === 'listen' && (
          <>
            <div className={styles.exerciseHint}>What did you hear?</div>
            <div className={styles.exerciseListen}>
              <PlayButton word={item} />
              <span className={styles.exerciseListenLabel}>Tap to play again</span>
            </div>
          </>
        )}
      </div>

      <ol className={styles.exerciseChoices}>
        {options.map((option, index) => (
          <li key={option.id}>
            <button
              type="button"
              className={optionClass(option)}
              onClick={() => onSelect(option.id)}
              disabled={Boolean(answered)}
            >
              <span className={styles.exerciseChoiceKey}>{index + 1}</span>
              {type === 'zh2en' ? (
                <span className={styles.exerciseChoiceText}>{option.english}</span>
              ) : (
                <span className={styles.exerciseChoiceText}>
                  <span className={styles.exerciseChoiceChinese}>{getPreferredChineseText(option, displayScript)}</span>
                  {type === 'en2zh' && <span className={styles.exerciseChoicePinyin}>{option.pinyin}</span>}
                </span>
              )}
            </button>
          </li>
        ))}
      </ol>
    </>
  );
}

function WordBankExercise({ exercise, displayScript, built, onBuiltChange, answered }) {
  const { item, tiles, answer } = exercise;
  const usedIds = new Set(built.map(t => t.id));
  const [shakeClass, shake] = useShaker();
  const wasWrong = answered && !answered.correct;

  useEffect(() => {
    if (wasWrong) shake();
  }, [wasWrong, shake]);

  let firstWrong = -1;
  if (wasWrong) {
    firstWrong = built.findIndex((tile, i) => tile.text !== answer[i]);
  }
  const builtTileClass = (i) => {
    if (!wasWrong) return styles.wordbankBuiltTile;
    if (i === firstWrong) return styles.wordbankBuiltTileWrong;
    if (firstWrong === -1 || i < firstWrong) return styles.wordbankBuiltTileCorrect;
    return styles.wordbankBuiltTile;
  };

  return (
    <>
      <div className={styles.exercisePrompt}>
        <div className={styles.exerciseHint}>Build this sentence in Chinese</div>
        <div className={styles.exercisePromptEnglish}>{item.english}</div>
        {item.pinyin && <PlayButton word={item} />}
      </div>

      <div className={`${styles.wordbankBuilt} ${shakeClass}`}>
        {built.length === 0 ? (
          <span className={styles.syllableBuiltPlaceholder}>Tap the words in order...</span>
        ) : (
          built.map((tile, i) => (
            <button
              key={tile.id}
              type="button"
              className={builtTileClass(i)}
              onClick={() => onBuiltChange(built.filter(t => t.id !== tile.id))}
              disabled={Boolean(answered)}
            >
              {tile.text}
            </button>
          ))
        )}
      </div>

      <div className={styles.wordbankTiles}>
        {tiles.map(tile => (
          <button
            key={tile.id}
            type="button"
            className={usedIds.has(tile.id) ? styles.wordbankTileUsed : styles.wordbankTile}
            onClick={() => onBuiltChange([...built, tile])}
            disabled={Boolean(answered) || usedIds.has(tile.id)}
          >
            {tile.text}
          </button>
        ))}
      </div>
    </>
  );
}

function PinyinExercise({ exercise, displayScript, onAnswer, answered }) {
  const { item } = exercise;
  const [gaveUp, setGaveUp] = useState(false);
  return (
    <>
      <div className={styles.exercisePrompt}>
        <div className={styles.exerciseHint}>Tap the pinyin for this word</div>
        <div className={styles.exercisePromptChinese}>{getPreferredChineseText(item, displayScript)}</div>
        <div className={styles.exercisePromptEnglish}>{item.english}</div>
        {gaveUp && <div className={styles.giveUpAnswer}>{item.pinyin}</div>}
      </div>
      <SyllablePicker
        word={item}
        onCorrect={(clean) => onAnswer(true, { retry: !clean })}
        disabled={Boolean(answered)}
        gaveUp={gaveUp}
      />
      {!answered && !gaveUp && (
        <div className={styles.exerciseActions}>
          <button type="button" className={styles.secondaryButton} onClick={() => setGaveUp(true)}>
            I don't know
          </button>
        </div>
      )}
    </>
  );
}

function ExerciseSession({ initialQueue, ctx, displayScript, onFinish, onQuit }) {
  const [queue, setQueue] = useState(initialQueue);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [built, setBuilt] = useState([]);
  const [answered, setAnswered] = useState(null);
  const [missed, setMissed] = useState(() => new Map());
  const finished = index >= queue.length;
  const elapsedMs = useElapsedTimer(!finished);
  const elapsedRef = useRef(0);
  elapsedRef.current = elapsedMs;

  const exercise = queue[index];
  const originalCount = initialQueue.length;

  const canCheck = exercise && !answered && (
    (CHOICE_TYPES.has(exercise.type) && selected !== null) ||
    (exercise.type === 'wordbank' && built.length > 0)
  );

  // retry: answered correctly in the end but with mistakes along the way,
  // so it still comes back around and counts as missed.
  const submit = useCallback((correct, { retry = false } = {}) => {
    setAnswered({ correct, retry });
    if (!correct || retry) {
      setMissed(prev => {
        const next = new Map(prev);
        next.set(itemKey(exercise), { item: exercise.item, kind: exercise.kind });
        return next;
      });
    }
  }, [exercise]);

  const check = useCallback(() => {
    if (!canCheck) return;
    if (CHOICE_TYPES.has(exercise.type)) {
      submit(selected === exercise.item.id);
    } else if (exercise.type === 'wordbank') {
      submit(built.map(t => t.text).join('') === exercise.answer.join(''));
    }
  }, [canCheck, exercise, selected, built, submit]);

  const next = useCallback(() => {
    if (!answered) return;
    stopCurrentAudio();
    if (!answered.correct || answered.retry) {
      const retry = { ...retryExercise(exercise, ctx), retryOf: exercise.retryOf || exercise.id };
      setQueue(prev => {
        const at = Math.min(prev.length, index + 1 + RETRY_GAP + Math.floor(Math.random() * (RETRY_JITTER + 1)));
        return [...prev.slice(0, at), retry, ...prev.slice(at)];
      });
    }
    setAnswered(null);
    setSelected(null);
    setBuilt([]);
    setIndex(i => i + 1);
  }, [answered, exercise, ctx, index]);

  useEffect(() => {
    if (!finished) return;
    const missedOriginals = new Set(
      queue.filter(e => e.retryOf).map(e => e.retryOf)
    );
    onFinish({
      total: originalCount,
      firstTryCorrect: originalCount - missedOriginals.size,
      elapsedMs: elapsedRef.current,
      missed: [...missed.values()],
    });
  }, [finished]);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.repeat) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT') return;
      // A focused button already turns Enter into a click.
      if (e.key === 'Enter' && tag !== 'BUTTON') {
        e.preventDefault();
        if (answered) next();
        else check();
        return;
      }
      if (!answered && exercise && CHOICE_TYPES.has(exercise.type) && /^[1-4]$/.test(e.key)) {
        const option = exercise.options[Number(e.key) - 1];
        if (option) setSelected(option.id);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [answered, exercise, next, check]);

  if (!exercise) return null;

  return (
    <div className={styles.exerciseFrame}>
      <div className={styles.exerciseTopBar}>
        <button type="button" className={styles.exerciseQuit} onClick={onQuit} title="Quit session">×</button>
        <progress className={styles.exerciseProgress} value={index} max={queue.length} />
        <span className={styles.exerciseCounter}>{index + 1} / {queue.length}</span>
      </div>

      <div key={exercise.id} className={styles.exerciseBody}>
        {CHOICE_TYPES.has(exercise.type) && (
          <ChoiceExercise
            exercise={exercise}
            displayScript={displayScript}
            selected={selected}
            onSelect={setSelected}
            answered={answered}
          />
        )}
        {exercise.type === 'wordbank' && (
          <WordBankExercise
            exercise={exercise}
            displayScript={displayScript}
            built={built}
            onBuiltChange={setBuilt}
            answered={answered}
          />
        )}
        {exercise.type === 'pinyin' && (
          <PinyinExercise
            exercise={exercise}
            displayScript={displayScript}
            onAnswer={submit}
            answered={answered}
          />
        )}
      </div>

      {answered ? (
        <div className={answered.correct ? styles.exerciseFeedbackCorrect : styles.exerciseFeedbackWrong}>
          <div className={styles.exerciseFeedbackBody}>
            <div className={styles.exerciseFeedbackTitle}>
              {!answered.correct
                ? 'Not quite. The answer is:'
                : answered.retry ? 'Got there, with mistakes. This one will come back.' : 'Correct!'}
            </div>
            {(!answered.correct || exercise.type !== 'zh2en') && (
              <ItemAnswer
                item={exercise.item}
                displayScript={displayScript}
                autoPlay={!HEARD_TYPES.has(exercise.type)}
              />
            )}
          </div>
          <button type="button" className={styles.primaryButton} onClick={next}>
            Continue
          </button>
        </div>
      ) : exercise.type !== 'pinyin' && (
        <div className={styles.exerciseActions}>
          <button type="button" className={styles.primaryButton} onClick={check} disabled={!canCheck}>
            Check
          </button>
        </div>
      )}
    </div>
  );
}

function ExerciseSummary({ result, displayScript, onAgain, onPracticeMissed, onChange }) {
  const accuracy = result.total > 0 ? Math.round((result.firstTryCorrect / result.total) * 100) : 0;
  return (
    <div className={styles.exerciseSummary}>
      <h2>Session complete</h2>
      <div className={styles.flashcardStatsGrid}>
        <div className={styles.flashcardStat}>
          <div className={styles.exerciseStatValue}>{accuracy}%</div>
          <div className={styles.exerciseStatLabel}>Accuracy</div>
        </div>
        <div className={styles.flashcardStat}>
          <div className={styles.exerciseStatValue}>{result.total}</div>
          <div className={styles.exerciseStatLabel}>Exercises</div>
        </div>
        <div className={styles.flashcardStat}>
          <div className={styles.exerciseStatValue}>{result.total - result.firstTryCorrect}</div>
          <div className={styles.exerciseStatLabel}>Missed</div>
        </div>
        <div className={styles.flashcardStat}>
          <div className={styles.exerciseStatValue}>{formatDuration(result.elapsedMs)}</div>
          <div className={styles.exerciseStatLabel}>Time</div>
        </div>
      </div>

      {result.missed.length > 0 && (
        <>
          <h3>Review these</h3>
          <ul className={styles.exerciseMissedList}>
            {result.missed.map(({ item, kind }) => (
              <li key={`${kind}-${item.id}`}>
                <ItemAnswer item={item} displayScript={displayScript} />
              </li>
            ))}
          </ul>
        </>
      )}

      <div className={styles.exerciseActions}>
        {result.missed.length > 0 && (
          <button type="button" className={styles.primaryButton} onClick={onPracticeMissed}>Practice missed</button>
        )}
        <button
          type="button"
          className={result.missed.length > 0 ? styles.secondaryButton : styles.primaryButton}
          onClick={onAgain}
        >Again</button>
        <button type="button" className={styles.secondaryButton} onClick={onChange}>Change chapters</button>
      </div>
    </div>
  );
}

function ExerciseStart({
  collections, loading, selectedIds, onToggle,
  length, onLengthChange, enabledTypes, onToggleType, pool, onStart,
}) {
  const canStart = selectedIds.length > 0 && enabledTypes.length > 0 &&
    (pool.words.length > 0 || pool.sentences.length > 0);

  return (
    <div>
      <h2>Exercise</h2>
      <p className={styles.learnDescription}>
        A quick mixed practice session built from the words and sentences in the
        chapters you pick. Missed exercises come back around until you get them right.
      </p>

      <h3 className={styles.exerciseSectionTitle}>Chapters</h3>
      <CollectionSelector
        collections={collections}
        loading={loading}
        selectedIds={selectedIds}
        onToggle={onToggle}
      />
      <p className={styles.formHint}>
        {pool.words.length} words, {pool.sentences.length} sentences selected
      </p>

      <div className={styles.learnOptions}>
        <div className={styles.formField}>
          <label htmlFor="exercise-length">Session length</label>
          <select id="exercise-length" value={length} onChange={e => onLengthChange(Number(e.target.value))}>
            {LENGTH_OPTIONS.map(n => <option key={n} value={n}>{n} exercises</option>)}
          </select>
        </div>
        <div className={styles.exerciseTypeList}>
          {EXERCISE_TYPES.map(t => (
            <label key={t.id} className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={enabledTypes.includes(t.id)}
                onChange={() => onToggleType(t.id)}
              />
              <span>{t.label}</span>
            </label>
          ))}
        </div>
      </div>

      <button type="button" className={styles.primaryButton} onClick={onStart} disabled={!canStart}>
        Start
      </button>
    </div>
  );
}

export function Exercise() {
  const [displayScript] = useConfig("display_script");
  const script = displayScript || DEFAULT_DISPLAY_SCRIPT;
  const [collections, , collectionsLoading] = useCollections();
  const [allWords] = useAllWords();
  const [allSentences] = useAllSentences();

  const [selectedIds, setSelectedIds] = useState([]);
  const [length, setLength] = useState(20);
  const [enabledTypes, setEnabledTypes] = useState(EXERCISE_TYPES.map(t => t.id));
  const [session, setSession] = useState(null);
  const [result, setResult] = useState(null);

  const collectionsWithContent = useMemo(() => {
    if (!collections) return collections;
    const ids = new Set();
    for (const item of [...(allWords || []), ...(allSentences || [])]) {
      for (const id of item.collection_ids || []) ids.add(id);
    }
    return collections.filter(c => ids.has(c.id));
  }, [collections, allWords, allSentences]);

  const pool = useMemo(
    () => buildPool(allWords, allSentences, selectedIds),
    [allWords, allSentences, selectedIds]
  );

  const toggle = (setter) => (id) => setter(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  );

  const all = { words: allWords || [], sentences: allSentences || [] };

  const startSession = () => {
    const ctx = createSessionContext({ pool, all, script });
    const queue = buildQueue(ctx, enabledTypes, length);
    if (queue.length === 0) return;
    setResult(null);
    setSession({ ctx, queue, nonce: Date.now() });
  };

  const startFocusSession = (items) => {
    const focusPool = {
      words: items.filter(m => m.kind === 'word').map(m => m.item),
      sentences: items.filter(m => m.kind === 'sentence').map(m => m.item),
    };
    const ctx = createSessionContext({ pool: focusPool, all, script });
    const queue = buildFocusQueue(ctx, enabledTypes, items, length);
    if (queue.length === 0) return;
    setResult(null);
    setSession({ ctx, queue, nonce: Date.now(), focus: items });
  };

  if (result) {
    return (
      <ExerciseSummary
        result={result}
        displayScript={script}
        onAgain={() => (result.focus ? startFocusSession(result.focus) : startSession())}
        onPracticeMissed={() => startFocusSession(result.missed)}
        onChange={() => { setResult(null); setSession(null); }}
      />
    );
  }

  if (session) {
    return (
      <ExerciseSession
        key={session.nonce}
        initialQueue={session.queue}
        ctx={session.ctx}
        displayScript={script}
        onFinish={(r) => { setResult({ ...r, focus: session.focus }); setSession(null); }}
        onQuit={() => setSession(null)}
      />
    );
  }

  return (
    <ExerciseStart
      collections={collectionsWithContent}
      loading={collectionsLoading}
      selectedIds={selectedIds}
      onToggle={toggle(setSelectedIds)}
      length={length}
      onLengthChange={setLength}
      enabledTypes={enabledTypes}
      onToggleType={toggle(setEnabledTypes)}
      pool={pool}
      onStart={startSession}
    />
  );
}
