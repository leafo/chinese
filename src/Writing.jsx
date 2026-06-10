import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import HanziWriter from "hanzi-writer";
import styles from "./index.module.css";
import { useRoute, updateRoute } from "./router";
import { gradeCharacterDrawing } from "./hanziFinalGrader";
import { useAllWords } from "./words";
import { audioKey, isInManifest } from "./audio";
import { CharacterAudioButton } from "./CharacterAudioButton";

// Built-in character sets the user can pick from. Each one renders as its own
// row with its characters visible and a Start button. The custom textarea is
// a separate section at the bottom.
const PRESETS = [
  {
    id: "numbers",
    label: "Numbers",
    characters: "一二三四五六七八九十百千",
  },
  {
    id: "common10",
    label: "Most common 10",
    characters: "的是不了人我在有他这",
  },
];

// How many non-graduated characters stay in active rotation at once. New
// characters are only introduced once an active one graduates, so you're
// always quizzed on something shortly after learning it while practicing a
// small set.
const INITIAL_BATCH_SIZE = 2;

// Scaffolding tiers, from most help to least. A character graduates once it is
// completed cleanly at the final (blind) tier. The Guided tier shows the
// outline to trace and lets you flash the next stroke; the Memory tier hides
// the outline and writes from the printed reference, with an optional peek that
// blocks advancement.
const TIERS = [
  {
    id: "guided",
    label: "Guided",
    hint: null,
    showOutline: true,
    showReference: false,
    canShowNextStroke: true,
    canPeek: false,
  },
  {
    id: "memory",
    label: "Memory",
    hint: "No outline — write it from the printed reference. Peek if you really need to; using it sends the character back a tier.",
    showOutline: false,
    showReference: true,
    canShowNextStroke: false,
    canPeek: true,
  },
];

const WRITER_BASE_OPTIONS = {
  width: 260,
  height: 260,
  padding: 10,
  strokeColor: "#0f172a",
  outlineColor: "#cbd5e1",
  radicalColor: "#7c3aed",
};

// Every failure reason gradeCharacterDrawing can surface on a drawn stroke gets
// an entry here so the legend explains every color the canvas can show. The
// reason string also derives the CSS class (writingUserStrokeError<Reason> /
// writingLegendSwatch<Reason>), so each reason needs matching classes in the
// stylesheet. ("missing" is reported via the stroke-count message, not a color.)
const ERROR_LEGEND = [
  { reason: "order", label: "Wrong order" },
  { reason: "backwards", label: "Backwards" },
  { reason: "direction", label: "Wrong direction" },
  { reason: "location", label: "Wrong location" },
  { reason: "shape", label: "Wrong shape" },
  { reason: "length", label: "Too short" },
  { reason: "extra", label: "Extra stroke" },
];

// Splits free-form text into a deduped list of individual CJK characters.
function parseCharacters(text) {
  const seen = new Set();
  const result = [];
  for (const ch of text) {
    if (/[㐀-鿿]/.test(ch) && !seen.has(ch)) {
      seen.add(ch);
      result.push(ch);
    }
  }
  return result;
}

function newCard(char) {
  return { char, tier: 0, graduated: false, practiceCount: 0 };
}

// A full-character attempt. The learner draws every stroke without interruption,
// then the saved strokes are graded together after Submit.
function DrawingQuizCard({ character, word, tier, isNew, round, onComplete, onSkip }) {
  const outlineRef = useRef(null);
  const outlineWriterRef = useRef(null);
  const activePointerRef = useRef(null);
  const activeStrokeRef = useRef(null);
  const peekedRef = useRef(false);
  const [status, setStatus] = useState("loading");
  const [peeked, setPeeked] = useState(false);
  const [showOutline, setShowOutline] = useState(tier.showOutline);
  const [strokes, setStrokes] = useState([]);
  const [activeStroke, setActiveStroke] = useState(null);
  const [feedback, setFeedback] = useState("");
  const [strokeErrors, setStrokeErrors] = useState(() => ({}));
  const [submitting, setSubmitting] = useState(false);

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const target = outlineRef.current;
    if (!target) return;
    target.innerHTML = "";
    setStatus("loading");
    setPeeked(false);
    setShowOutline(tier.showOutline);
    setStrokes([]);
    setActiveStroke(null);
    setFeedback("");
    setStrokeErrors({});
    peekedRef.current = false;

    const writer = HanziWriter.create(target, character, {
      ...WRITER_BASE_OPTIONS,
      showCharacter: false,
      // Always render the outline; the showOutline state drives its visibility
      // via the writingTargetHidden opacity class (single source of truth).
      showOutline: true,
      onLoadCharDataSuccess: () => setStatus("ready"),
      onLoadCharDataError: () => setStatus("error"),
    });
    outlineWriterRef.current = writer;

    return () => {
      outlineWriterRef.current = null;
      target.innerHTML = "";
    };
  }, [character, tier, round]);

  const handlePeek = () => {
    peekedRef.current = true;
    setPeeked(true);
    setShowOutline((visible) => !visible);
  };

  const handleShowNextStroke = () => {
    outlineWriterRef.current?.highlightStroke(strokes.length);
  };

  const getSvgPoint = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * WRITER_BASE_OPTIONS.width,
      y: ((event.clientY - rect.top) / rect.height) * WRITER_BASE_OPTIONS.height,
    };
  };

  const handlePointerDown = (event) => {
    if (status !== "ready" || submitting) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = getSvgPoint(event);
    activePointerRef.current = event.pointerId;
    activeStrokeRef.current = [point];
    setActiveStroke([point]);
    setFeedback("");
    setStrokeErrors({});
  };

  const handlePointerMove = (event) => {
    if (activePointerRef.current !== event.pointerId || !activeStrokeRef.current) return;
    const point = getSvgPoint(event);
    const nextStroke = [...activeStrokeRef.current, point];
    activeStrokeRef.current = nextStroke;
    setActiveStroke(nextStroke);
  };

  const finishStroke = (event) => {
    if (activePointerRef.current !== event.pointerId || !activeStrokeRef.current) return;
    const finishedStroke = activeStrokeRef.current;
    activePointerRef.current = null;
    activeStrokeRef.current = null;
    setActiveStroke(null);
    if (finishedStroke.length >= 2) {
      setStrokes((prev) => [...prev, finishedStroke]);
    }
  };

  const handleUndo = () => {
    setStrokes((prev) => prev.slice(0, -1));
    setFeedback("");
    setStrokeErrors({});
  };

  const handleClear = () => {
    setStrokes([]);
    setActiveStroke(null);
    setFeedback("");
    setStrokeErrors({});
  };

  const handleSubmit = async () => {
    if (strokes.length === 0 || submitting) {
      setFeedback("Draw the character before submitting.");
      return;
    }

    setSubmitting(true);
    setFeedback("Checking...");
    try {
      const grade = await gradeCharacterDrawing(character, strokes, {
        ...WRITER_BASE_OPTIONS,
        isOutlineVisible: showOutline,
      });

      if (!grade.passed) {
        const nextStrokeErrors = {};
        for (const result of grade.strokeResults) {
          if (!result.passed) nextStrokeErrors[result.strokeNum] = result.reason;
        }
        for (let i = grade.expectedStrokeCount; i < grade.drawnStrokeCount; i++) {
          nextStrokeErrors[i] = "extra";
        }
        setStrokeErrors(nextStrokeErrors);

        const strokeText =
          grade.failedStrokeCount === 1 ? "1 stroke needs work" : `${grade.failedStrokeCount} strokes need work`;
        const countText =
          grade.drawnStrokeCount === grade.expectedStrokeCount
            ? strokeText
            : `Expected ${grade.expectedStrokeCount} strokes, got ${grade.drawnStrokeCount}.`;
        setFeedback(`${countText} Clear and try again.`);
        return;
      }

      onCompleteRef.current?.({
        mistakes: 0,
        peeked: peekedRef.current,
        passed: true,
        grade,
      });
    } catch (error) {
      console.error(error);
      setFeedback("Could not check this drawing.");
    } finally {
      setSubmitting(false);
    }
  };

  const showPeekButton = tier.canPeek;
  const showStrokeButton = tier.canShowNextStroke;

  // Committed strokes only change when a stroke is added, undone, cleared, or
  // graded, so memoize them; an in-progress stroke fires many pointermove
  // renders and is drawn separately to keep those renders cheap.
  const committedPolylines = useMemo(() => {
    const classNameFor = (strokeIndex) => {
      const reason = strokeErrors[strokeIndex];
      if (!reason) return styles.writingUserStroke;
      return [
        styles.writingUserStroke,
        styles.writingUserStrokeFailed,
        styles[`writingUserStrokeError${reason[0].toUpperCase()}${reason.slice(1)}`],
      ]
        .filter(Boolean)
        .join(" ");
    };
    return strokes.map((stroke, strokeIndex) => (
      <polyline
        key={strokeIndex}
        points={stroke.map((point) => `${point.x},${point.y}`).join(" ")}
        className={classNameFor(strokeIndex)}
      />
    ));
  }, [strokes, strokeErrors]);

  return (
    <div className={styles.writingWriter}>
      <div className={styles.writingTierRow}>
        <div className={styles.writingTierLabel}>
          {isNew ? "New character · " : ""}
          {tier.label} tier
        </div>
        <CharacterAudioButton word={word} autoPlay />
      </div>
      {tier.hint && <p className={styles.writingTierHint}>{tier.hint}</p>}
      {tier.showReference && (
        <div className={styles.writingReference} aria-label="Character to write">
          {character}
        </div>
      )}
      <div className={styles.writingPad}>
        <div
          ref={outlineRef}
          className={`${styles.writingTarget} ${showOutline ? "" : styles.writingTargetHidden}`}
          aria-hidden={!showOutline}
        />
        <svg
          className={styles.writingCanvas}
          viewBox={`0 0 ${WRITER_BASE_OPTIONS.width} ${WRITER_BASE_OPTIONS.height}`}
          role="img"
          aria-label={`Drawing pad for ${character}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
        >
          <line x1="130" y1="0" x2="130" y2="260" className={styles.writingGuideLine} />
          <line x1="0" y1="130" x2="260" y2="130" className={styles.writingGuideLine} />
          {committedPolylines}
          {activeStroke && (
            <polyline
              points={activeStroke.map((point) => `${point.x},${point.y}`).join(" ")}
              className={styles.writingUserStroke}
            />
          )}
        </svg>
      </div>
      <div className={styles.writingLegend} aria-label="Writing error legend">
        {ERROR_LEGEND.map((item) => (
          <span key={item.reason} className={styles.writingLegendItem}>
            <span
              className={`${styles.writingLegendSwatch} ${styles[`writingLegendSwatch${item.reason[0].toUpperCase()}${item.reason.slice(1)}`]}`}
              aria-hidden
            />
            {item.label}
          </span>
        ))}
      </div>
      {status === "loading" && (
        <p className={styles.writingStatus}>Loading stroke data…</p>
      )}
      {status === "error" ? (
        <>
          <p className={styles.writingStatus}>
            No stroke data available for this character.
          </p>
          <button type="button" className={styles.smallButton} onClick={onSkip}>
            Skip character
          </button>
        </>
      ) : (
        <>
          {feedback && <p className={styles.writingStatus}>{feedback}</p>}
          <div className={styles.writingControls}>
            {showStrokeButton && (
              <button
                type="button"
                className={styles.smallButton}
                disabled={status !== "ready" || submitting}
                onClick={handleShowNextStroke}
              >
                Show next stroke
              </button>
            )}
            {showPeekButton && (
              <button
                type="button"
                className={styles.smallButton}
                disabled={status !== "ready" || submitting}
                onClick={handlePeek}
              >
                {showOutline ? "Hide outline" : peeked ? "Show outline" : "Peek at outline"}
              </button>
            )}
            <button
              type="button"
              className={styles.smallButton}
              disabled={strokes.length === 0 || submitting}
              onClick={handleUndo}
            >
              Undo stroke
            </button>
            <button
              type="button"
              className={styles.smallButton}
              disabled={(strokes.length === 0 && !activeStroke) || submitting}
              onClick={handleClear}
            >
              Clear
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={status !== "ready" || submitting}
              onClick={handleSubmit}
            >
              Submit
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function WritingSession({ characters, onExit }) {
  const [cards, setCards] = useState(() => [newCard(characters[0])]);
  const [queue, setQueue] = useState(() => characters.slice(1));
  const [currentIndex, setCurrentIndex] = useState(0);
  const [round, setRound] = useState(0);
  const [done, setDone] = useState(false);
  const lastCharRef = useRef(null);

  const currentCard = currentIndex != null ? cards[currentIndex] : null;
  const graduatedCount = cards.filter((c) => c.graduated).length;

  // Resolve each character to a vocabulary entry so we can offer pronunciation
  // audio (which is keyed by pinyin). Built once from the loaded word list; for
  // a character with multiple readings, prefer the one whose clip is precomputed.
  const [words] = useAllWords();
  const wordByChar = useMemo(() => {
    const map = new Map();
    const charHasAudio = new Set();
    for (const word of words || []) {
      const hasAudio = Boolean(word.pinyin && isInManifest(audioKey(word.pinyin)));
      for (const text of [word.simplified, word.traditional]) {
        if (!text) continue;
        if (!map.has(text) || (hasAudio && !charHasAudio.has(text))) {
          map.set(text, word);
          if (hasAudio) charHasAudio.add(text);
        }
      }
    }
    return map;
  }, [words]);
  const currentWord = currentCard ? wordByChar.get(currentCard.char) : null;

  // Least-practiced non-graduated card, avoiding an immediate repeat.
  const pickNext = useCallback((cardList) => {
    const candidates = cardList
      .map((c, i) => ({ c, i }))
      .filter((x) => !x.c.graduated);
    if (candidates.length === 0) return null;

    const pool =
      candidates.length > 1
        ? candidates.filter((x) => x.c.char !== lastCharRef.current)
        : candidates;

    let min = Infinity;
    for (const x of pool) {
      if (x.c.practiceCount < min) min = x.c.practiceCount;
    }
    const lowest = pool.filter((x) => x.c.practiceCount === min);
    return lowest[Math.floor(Math.random() * lowest.length)].i;
  }, []);

  // After a rating, decide what to render next: refill the active batch from
  // the queue if it has room, otherwise pick another non-graduated card.
  const advance = useCallback(
    (updatedCards) => {
      const activeCount = updatedCards.filter((c) => !c.graduated).length;
      if (activeCount < INITIAL_BATCH_SIZE && queue.length > 0) {
        const [nextChar, ...restQueue] = queue;
        const withNew = [...updatedCards, newCard(nextChar)];
        setCards(withNew);
        setQueue(restQueue);
        setCurrentIndex(withNew.length - 1);
        setRound((r) => r + 1);
        return;
      }

      setCards(updatedCards);
      const next = pickNext(updatedCards);
      if (next == null) {
        setDone(true);
      } else {
        setCurrentIndex(next);
        setRound((r) => r + 1);
      }
    },
    [queue, pickNext]
  );

  const handleQuizComplete = useCallback(
    (quizResult) => {
      const updatedCards = cards.map((c, i) => {
        if (i !== currentIndex) return c;
        let { tier, graduated } = c;
        if (tier === 0) {
          tier = 1;
        } else if (!quizResult.peeked) {
          if (tier >= TIERS.length - 1) graduated = true;
          else tier += 1;
        } else {
          tier = Math.max(0, tier - 1);
        }
        return { ...c, tier, graduated, practiceCount: c.practiceCount + 1 };
      });

      lastCharRef.current = currentCard.char;
      advance(updatedCards);
    },
    [cards, currentIndex, currentCard, advance]
  );

  const handleSkip = useCallback(() => {
    const updatedCards = cards.map((c, i) =>
      i === currentIndex ? { ...c, graduated: true } : c
    );
    lastCharRef.current = currentCard.char;
    advance(updatedCards);
  }, [cards, currentIndex, currentCard, advance]);

  if (done) {
    return (
      <div className={styles.flashcardSummary}>
        <h2>Session Complete</h2>
        <p>
          {graduatedCount} of {characters.length} character
          {characters.length === 1 ? "" : "s"} mastered
        </p>
        <div className={styles.flashcardActions}>
          <button className={styles.primaryButton} onClick={onExit}>
            Done
          </button>
        </div>
      </div>
    );
  }

  if (!currentCard) return null;

  return (
    <div className={styles.flashcardContainer}>
      <div className={styles.flashcardProgress}>
        Writing — {graduatedCount}/{characters.length} mastered · {currentCard.char} ({TIERS[currentCard.tier].label})
        <button
          className={`${styles.smallButton} ${styles.writingExitButton}`}
          onClick={() => setDone(true)}
        >
          End session
        </button>
      </div>

      <DrawingQuizCard
        key={`quiz-${currentCard.char}-${currentCard.tier}-${round}`}
        character={currentCard.char}
        word={currentWord}
        tier={TIERS[currentCard.tier]}
        isNew={currentCard.practiceCount === 0}
        round={round}
        onComplete={handleQuizComplete}
        onSkip={handleSkip}
      />
    </div>
  );
}

export function Writing() {
  const route = useRoute(["writing", "chars"]);
  const [customInput, setCustomInput] = useState(() => route.chars || "");

  const customPreview = useMemo(
    () => parseCharacters(customInput),
    [customInput]
  );

  // Resolve the active session from the URL so the browser back button
  // exits cleanly back to the setup screen and session URLs are shareable.
  let sessionChars = null;
  if (route.writing === "custom") {
    const parsed = parseCharacters(route.chars || "");
    if (parsed.length > 0) sessionChars = parsed;
  } else if (route.writing) {
    const preset = PRESETS.find((p) => p.id === route.writing);
    if (preset) sessionChars = parseCharacters(preset.characters);
  }

  if (sessionChars) {
    return (
      <WritingSession
        key={`${route.writing}:${route.chars || ""}`}
        characters={sessionChars}
        onExit={() => updateRoute({ writing: false, chars: false })}
      />
    );
  }

  const startPreset = (preset) => {
    updateRoute({ writing: preset.id, chars: false });
  };

  const startCustom = () => {
    updateRoute({ writing: "custom", chars: customInput });
  };

  return (
    <div>
      <h2>Practice Writing</h2>
      <p className={styles.learnDescription}>
        Trace Chinese characters with stroke-order guidance, then write them
        from memory.
      </p>

      <ul className={styles.writingPresetList}>
        {PRESETS.map((preset) => {
          const chars = parseCharacters(preset.characters);
          return (
            <li key={preset.id} className={styles.writingPresetItem}>
              <div className={styles.writingPresetInfo}>
                <div className={styles.writingPresetName}>
                  {preset.label}
                  <span className={styles.writingPresetCount}>
                    {chars.length} character{chars.length === 1 ? "" : "s"}
                  </span>
                </div>
                {preset.description && (
                  <div className={styles.writingPresetDescription}>
                    {preset.description}
                  </div>
                )}
                <div className={styles.writingPresetChars}>
                  {chars.join(" ")}
                </div>
              </div>
              <button
                className={styles.primaryButton}
                onClick={() => startPreset(preset)}
              >
                Start
              </button>
            </li>
          );
        })}
      </ul>

      <div className={styles.writingCustomSection}>
        <h3 className={styles.writingCustomHeading}>Custom</h3>
        <div className={styles.formField}>
          <label htmlFor="writing-chars">Characters to practice</label>
          <textarea
            id="writing-chars"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            rows={3}
          />
        </div>
        <p className={styles.formHint}>
          {customPreview.length > 0
            ? `${customPreview.length} character${customPreview.length === 1 ? "" : "s"}: ${customPreview.join(" ")}`
            : "Type any Chinese characters you want to practice."}
        </p>
        <button
          className={`${styles.primaryButton} ${styles.writingStartButton}`}
          disabled={customPreview.length === 0}
          onClick={startCustom}
        >
          Start learning
        </button>
      </div>
    </div>
  );
}
