import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import HanziWriter from "hanzi-writer";
import styles from "./index.module.css";
import { useRoute, updateRoute } from "./router";

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
// completed cleanly at the final (blind) tier. The Guided tier doubles as the
// introduction: showHintAfterMisses=0 means the stroke-hint animation plays
// for every stroke before you draw it, so seeing the order and tracing it
// happen on the same screen.
const TIERS = [
  {
    id: "guided",
    label: "Guided",
    hint: null,
    showOutline: true,
    showHintAfterMisses: 0,
    showReference: false,
    canShowNextStroke: true,
    canPeek: false,
  },
  {
    id: "memory",
    label: "Memory",
    hint: "No outline — write it from the printed reference. Peek if you really need to; using it blocks the Confident rating.",
    showOutline: false,
    showHintAfterMisses: false,
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

// A single quiz attempt at a given tier. Reports mistake count and whether the
// learner peeked at the outline so the session can gate the "Confident" rating.
function QuizCard({ character, tier, isNew, round, onComplete, onSkip }) {
  const targetRef = useRef(null);
  const writerRef = useRef(null);
  const peekedRef = useRef(false);
  const currentStrokeRef = useRef(0);
  const [status, setStatus] = useState("loading");
  const [peeked, setPeeked] = useState(false);

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    target.innerHTML = "";
    setStatus("loading");
    setPeeked(false);
    peekedRef.current = false;
    currentStrokeRef.current = 0;

    const writer = HanziWriter.create(target, character, {
      ...WRITER_BASE_OPTIONS,
      drawingWidth: 28,
      showCharacter: false,
      showOutline: tier.showOutline,
      highlightOnComplete: true,
      onLoadCharDataSuccess: () => setStatus("ready"),
      onLoadCharDataError: () => setStatus("error"),
    });
    writerRef.current = writer;

    writer.quiz({
      showHintAfterMisses: tier.showHintAfterMisses,
      onCorrectStroke: ({ strokeNum }) => {
        currentStrokeRef.current = strokeNum + 1;
      },
      onComplete: (summary) =>
        onCompleteRef.current?.({
          mistakes: summary.totalMistakes,
          peeked: peekedRef.current,
        }),
    });

    return () => {
      writerRef.current = null;
      target.innerHTML = "";
    };
  }, [character, tier, round]);

  const handlePeek = () => {
    peekedRef.current = true;
    setPeeked(true);
    writerRef.current?.showOutline();
  };

  const handleShowNextStroke = () => {
    // highlightStroke flashes the stroke briefly (same mechanism the quiz uses
    // for its after-miss hint) — doesn't disrupt the quiz state the way
    // animateStroke would.
    writerRef.current?.highlightStroke(currentStrokeRef.current);
  };

  const showPeekButton = tier.canPeek;
  const showStrokeButton = tier.canShowNextStroke;

  return (
    <div className={styles.writingWriter}>
      <div className={styles.writingTierLabel}>
        {isNew ? "New character · " : ""}
        {tier.label} tier
      </div>
      {tier.hint && <p className={styles.writingTierHint}>{tier.hint}</p>}
      {tier.showReference && (
        <div className={styles.writingReference} aria-label="Character to write">
          {character}
        </div>
      )}
      <div ref={targetRef} className={styles.writingTarget} />
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
        (showStrokeButton || showPeekButton) && (
          <div className={styles.writingControls}>
            {showStrokeButton && (
              <button
                type="button"
                className={styles.smallButton}
                disabled={status !== "ready"}
                onClick={handleShowNextStroke}
              >
                Show next stroke
              </button>
            )}
            {showPeekButton && (
              <button
                type="button"
                className={styles.smallButton}
                disabled={status !== "ready" || peeked}
                onClick={handlePeek}
              >
                {peeked ? "Outline shown" : "Peek at outline"}
              </button>
            )}
          </div>
        )
      )}
    </div>
  );
}

// Self-rating after a quiz attempt. "Confident" advances a tier (or graduates)
// but is blocked if the attempt was messy or the outline was peeked at.
function RateCard({ character, tierIndex, result, onRate }) {
  const isBlind = tierIndex === TIERS.length - 1;
  const canConfident = !result.peeked && result.mistakes <= 2;

  let feedback;
  if (result.peeked) {
    feedback = "You peeked at the outline — practice it again before moving on.";
  } else if (result.mistakes === 0) {
    feedback = "Clean attempt — no mistakes.";
  } else {
    feedback = `Completed with ${result.mistakes} mistake${result.mistakes === 1 ? "" : "s"}.`;
  }

  useEffect(() => {
    const handleKey = (e) => {
      if (e.repeat) return;
      if (e.key === "1") { e.preventDefault(); onRate("again"); }
      if (e.key === "2") { e.preventDefault(); onRate("good"); }
      if (e.key === "3" && canConfident) { e.preventDefault(); onRate("confident"); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onRate, canConfident]);

  const confidentLockReason = result.peeked
    ? "You peeked"
    : "Too many mistakes";

  return (
    <>
      <div className={styles.writingWriter}>
        <div className={styles.writingRateChar}>{character}</div>
        <p className={styles.writingFeedback}>{feedback}</p>
      </div>
      <div className={styles.learnActions}>
        <button
          className={`${styles.ratingButton} ${styles.ratingAgain}`}
          onClick={() => onRate("again")}
        >
          <span className={styles.ratingLabel}>Again</span>
        </button>
        <button
          className={`${styles.ratingButton} ${styles.ratingGood}`}
          onClick={() => onRate("good")}
        >
          <span className={styles.ratingLabel}>Good</span>
        </button>
        <button
          className={`${styles.ratingButton} ${styles.ratingEasy}`}
          onClick={() => onRate("confident")}
          disabled={!canConfident}
        >
          <span className={styles.ratingLabel}>
            {isBlind ? "Confident — done" : "Confident"}
          </span>
          <span className={styles.ratingInterval}>
            {canConfident ? "Advances a tier" : confidentLockReason}
          </span>
        </button>
      </div>
    </>
  );
}

function WritingSession({ characters, onExit }) {
  const [cards, setCards] = useState(() => [newCard(characters[0])]);
  const [queue, setQueue] = useState(() => characters.slice(1));
  const [currentIndex, setCurrentIndex] = useState(0);
  const [result, setResult] = useState(null);
  const [round, setRound] = useState(0);
  const [done, setDone] = useState(false);
  const lastCharRef = useRef(null);

  const currentCard = currentIndex != null ? cards[currentIndex] : null;
  const graduatedCount = cards.filter((c) => c.graduated).length;

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

  const handleQuizComplete = useCallback((quizResult) => {
    setResult(quizResult);
  }, []);

  const handleRate = useCallback(
    (rating) => {
      const updatedCards = cards.map((c, i) => {
        if (i !== currentIndex) return c;
        let { tier, graduated } = c;
        if (rating === "again") {
          tier = Math.max(0, tier - 1);
        } else if (rating === "confident") {
          if (tier >= TIERS.length - 1) graduated = true;
          else tier += 1;
        }
        return { ...c, tier, graduated, practiceCount: c.practiceCount + 1 };
      });

      lastCharRef.current = currentCard.char;
      setResult(null);
      advance(updatedCards);
    },
    [cards, currentIndex, currentCard, advance]
  );

  const handleSkip = useCallback(() => {
    const updatedCards = cards.map((c, i) =>
      i === currentIndex ? { ...c, graduated: true } : c
    );
    lastCharRef.current = currentCard.char;
    setResult(null);
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

      {result ? (
        <RateCard
          key={`rate-${currentCard.char}-${round}`}
          character={currentCard.char}
          tierIndex={currentCard.tier}
          result={result}
          onRate={handleRate}
        />
      ) : (
        <QuizCard
          key={`quiz-${currentCard.char}-${currentCard.tier}-${round}`}
          character={currentCard.char}
          tier={TIERS[currentCard.tier]}
          isNew={currentCard.practiceCount === 0}
          round={round}
          onComplete={handleQuizComplete}
          onSkip={handleSkip}
        />
      )}
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
