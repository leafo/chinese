import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import HanziWriter from "hanzi-writer";
import styles from "./index.module.css";

const DEFAULT_CHARACTERS = "一二三四五六七八九十";

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
  const [inputValue, setInputValue] = useState(DEFAULT_CHARACTERS);
  const [sessionChars, setSessionChars] = useState(null);

  const parsedPreview = useMemo(
    () => parseCharacters(inputValue),
    [inputValue]
  );

  if (sessionChars) {
    return (
      <WritingSession
        key={sessionChars.join("")}
        characters={sessionChars}
        onExit={() => setSessionChars(null)}
      />
    );
  }

  return (
    <div>
      <h2>Practice Writing</h2>
      <p className={styles.learnDescription}>
        Learn to write Chinese characters. Each new character starts at the
        Guided tier with the outline visible — flash the next stroke any time,
        and a hint shows after any wrong stroke. Once you can write it
        confidently you advance to the Memory tier: no outline, just the
        printed character as a reference. Peek is still available there if you
        really need it, but using it blocks the Confident rating, so the
        character is only mastered once you can write it from memory. New
        characters are introduced a couple at a time, so you're quizzed on
        each one soon after learning it while practicing the others. Nothing
        is saved between sessions.
      </p>
      <div className={styles.formField}>
        <label htmlFor="writing-chars">Characters to practice</label>
        <textarea
          id="writing-chars"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          rows={3}
        />
      </div>
      <p className={styles.formHint}>
        {parsedPreview.length > 0
          ? `${parsedPreview.length} character${parsedPreview.length === 1 ? "" : "s"}: ${parsedPreview.join(" ")}`
          : "No Chinese characters detected."}
      </p>
      <button
        className={`${styles.primaryButton} ${styles.writingStartButton}`}
        disabled={parsedPreview.length === 0}
        onClick={() => setSessionChars(parsedPreview)}
      >
        Start learning
      </button>
    </div>
  );
}
