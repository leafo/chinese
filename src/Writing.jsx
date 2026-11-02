import { useState, useEffect, useRef, useMemo } from "react";
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

const LINE_LENGTHS = [5, 10, 20];
const DEFAULT_LINE_LENGTH = 10;

// Share of the line that has a model to write over. It fades halfway through
// that stretch and the remaining cells are blank.
const GUIDED_FRACTION = 0.4;
const FADED_GHOST_OPACITY = 0.45;

// Only the opening cells are graded as they are written. Checking the rest
// would break the rhythm of the line, but an unchecked first attempt lets a bad
// stroke order get repeated for the whole line.
const CHECKED_CELLS = 1;

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
// stylesheet. ("missing" is reported in the feedback text, not a color.)
const ERROR_LEGEND = [
  { reason: "order", label: "Wrong order" },
  { reason: "backwards", label: "Backwards" },
  { reason: "direction", label: "Wrong direction" },
  { reason: "location", label: "Wrong location" },
  { reason: "shape", label: "Wrong shape" },
  { reason: "length", label: "Too short" },
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

function parseLineLength(value) {
  const length = Number(value);
  return LINE_LENGTHS.includes(length) ? length : DEFAULT_LINE_LENGTH;
}

function ghostOpacity(cellIndex, lineLength) {
  const guidedCells = Math.ceil(lineLength * GUIDED_FRACTION);
  if (cellIndex >= guidedCells) return 0;
  return cellIndex < guidedCells / 2 ? 1 : FADED_GHOST_OPACITY;
}

function capitalize(text) {
  return `${text[0].toUpperCase()}${text.slice(1)}`;
}

function strokeErrorsFor(grade) {
  const errors = {};
  for (const result of grade.strokeResults) {
    if (!result.passed && result.reason !== "missing") {
      errors[result.strokeNum] = result.reason;
    }
  }
  return errors;
}

function describeGrade(grade) {
  if (grade.passed) return "All strokes look right.";
  if (grade.drawnStrokeCount < grade.expectedStrokeCount) {
    return `Expected ${grade.expectedStrokeCount} strokes, got ${grade.drawnStrokeCount}.`;
  }
  const count = grade.failedStrokeCount;
  return count === 1 ? "1 stroke needs work." : `${count} strokes need work.`;
}

// Mean distance from the model across all strokes, used to pick the attempt to
// circle. Failed attempts are excluded because their distances include missing
// strokes (Infinity) and strokes matched against the wrong position.
function attemptDistance(grade) {
  const total = grade.strokeResults.reduce((sum, result) => sum + result.avgDist, 0);
  return total / grade.strokeResults.length;
}

function summarizeLine(grades) {
  let bestIndex = null;
  let passCount = 0;
  grades.forEach((grade, index) => {
    if (!grade.passed) return;
    passCount += 1;
    if (bestIndex == null || attemptDistance(grade) < attemptDistance(grades[bestIndex])) {
      bestIndex = index;
    }
  });
  return { grades, bestIndex, passCount };
}

function InkStrokes({ strokes, errors }) {
  return strokes.map((stroke, strokeIndex) => {
    const reason = errors?.[strokeIndex];
    const className = reason
      ? `${styles.writingUserStroke} ${styles.writingUserStrokeFailed} ${styles[`writingUserStrokeError${capitalize(reason)}`]}`
      : styles.writingUserStroke;
    return (
      <polyline
        key={strokeIndex}
        points={stroke.map((point) => `${point.x},${point.y}`).join(" ")}
        className={className}
      />
    );
  });
}

function LineCell({ strokes, errors, isCurrent, isBest, isFailed, isSelected, disabled, onSelect, label }) {
  const className = [
    styles.writingLineCell,
    isCurrent && styles.writingLineCellCurrent,
    isFailed && styles.writingLineCellFailed,
    isSelected && styles.writingLineCellSelected,
    isBest && styles.writingLineCellBest,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type="button" className={className} disabled={disabled} onClick={onSelect} aria-label={label}>
      <svg viewBox={`0 0 ${WRITER_BASE_OPTIONS.width} ${WRITER_BASE_OPTIONS.height}`} aria-hidden>
        <line x1="130" y1="0" x2="130" y2="260" className={styles.writingLineCellGuide} />
        <line x1="0" y1="130" x2="260" y2="130" className={styles.writingLineCellGuide} />
        {strokes && <InkStrokes strokes={strokes} errors={errors} />}
      </svg>
    </button>
  );
}

// One character's line: repeated attempts that are graded together at the end.
function FillLine({ character, word, lineLength, isLast, onDone, onSkip }) {
  const outlineRef = useRef(null);
  const outlineWriterRef = useRef(null);
  const activePointerRef = useRef(null);
  const activeStrokeRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const [expectedStrokeCount, setExpectedStrokeCount] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [strokes, setStrokes] = useState([]);
  const [activeStroke, setActiveStroke] = useState(null);
  const [strokeErrors, setStrokeErrors] = useState(null);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [review, setReview] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [showModel, setShowModel] = useState(true);

  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const target = outlineRef.current;
    if (!target) return;

    // HanziWriter mutates its mount node directly and keeps doing so
    // asynchronously while animations run. Give it a dedicated child node that
    // React never reconciles, so an in-flight animation can't desync React's
    // view of the DOM and crash on unmount with "removeChild ... not a child".
    let cancelled = false;
    const mount = document.createElement("div");
    target.appendChild(mount);

    const writer = HanziWriter.create(mount, character, {
      ...WRITER_BASE_OPTIONS,
      showCharacter: false,
      // Always rendered; ghost opacity on the wrapper decides how much shows.
      showOutline: true,
      strokeAnimationSpeed: 1.5,
      delayBetweenStrokes: 250,
      onLoadCharDataSuccess: (data) => {
        if (cancelled) return;
        setExpectedStrokeCount(data.strokes.length);
        setStatus("ready");
      },
      onLoadCharDataError: () => {
        if (!cancelled) setStatus("error");
      },
    });
    outlineWriterRef.current = writer;

    return () => {
      // Stop any running stroke animation before tearing the node down so its
      // requestAnimationFrame loop can't fire against a detached DOM subtree.
      cancelled = true;
      outlineWriterRef.current = null;
      try {
        writer.pauseAnimation();
      } catch {
        // pauseAnimation throws if no animation is in flight; nothing to stop.
      }
      if (mount.parentNode === target) target.removeChild(mount);
    };
  }, [character]);

  const gradeAttempt = (attempt, cellIndex) =>
    gradeCharacterDrawing(character, attempt, {
      ...WRITER_BASE_OPTIONS,
      isOutlineVisible: ghostOpacity(cellIndex, lineLength) > 0,
    });

  const finishLine = async (finalAttempts) => {
    setBusy(true);
    setFeedback("");
    try {
      // Grading is synchronous and a full line of a complex character takes
      // long enough to freeze a phone, so yield to paint between attempts.
      const grades = [];
      for (let index = 0; index < finalAttempts.length; index++) {
        await new Promise((resolve) => setTimeout(resolve));
        grades.push(await gradeAttempt(finalAttempts[index], index));
      }
      const summary = summarizeLine(grades);
      const firstFailed = grades.findIndex((grade) => !grade.passed);
      setReview(summary);
      setSelectedIndex(firstFailed >= 0 ? firstFailed : summary.bestIndex);
      setShowModel(true);
    } catch (error) {
      console.error(error);
      setFeedback("Could not check this line.");
    } finally {
      setBusy(false);
    }
  };

  const commitAttempt = async (attempt) => {
    const cellIndex = attempts.length;

    if (cellIndex < CHECKED_CELLS) {
      setBusy(true);
      try {
        const grade = await gradeAttempt(attempt, cellIndex);
        if (!grade.passed) {
          setStrokeErrors(strokeErrorsFor(grade));
          setFeedback(`${describeGrade(grade)} Fix this before filling the line.`);
          const firstFailed = grade.strokeResults.find((result) => !result.passed);
          outlineWriterRef.current?.highlightStroke(firstFailed.strokeNum);
          return;
        }
      } catch (error) {
        console.error(error);
        setFeedback("Could not check this drawing.");
        return;
      } finally {
        setBusy(false);
      }
    }

    const nextAttempts = [...attempts, attempt];
    setAttempts(nextAttempts);
    setStrokes([]);
    setFeedback("");
    if (nextAttempts.length >= lineLength) await finishLine(nextAttempts);
  };

  const getSvgPoint = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * WRITER_BASE_OPTIONS.width,
      y: ((event.clientY - rect.top) / rect.height) * WRITER_BASE_OPTIONS.height,
    };
  };

  const handlePointerDown = (event) => {
    if (status !== "ready" || busy || review || attempts.length >= lineLength) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = getSvgPoint(event);
    activePointerRef.current = event.pointerId;
    activeStrokeRef.current = [point];
    setActiveStroke([point]);
    if (strokeErrors) {
      setStrokes([]);
      setStrokeErrors(null);
      setFeedback("");
    }
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
    if (finishedStroke.length < 2) return;

    const nextStrokes = [...strokes, finishedStroke];
    setStrokes(nextStrokes);
    if (nextStrokes.length >= expectedStrokeCount) commitAttempt(nextStrokes);
  };

  // Backing up from an empty cell reopens the previous attempt, since a cell
  // completes on its last stroke and leaves no chance to undo before it moves on.
  const handleUndo = () => {
    setStrokeErrors(null);
    setFeedback("");
    if (strokes.length > 0) {
      setStrokes(strokes.slice(0, -1));
    } else {
      setStrokes(attempts[attempts.length - 1].slice(0, -1));
      setAttempts(attempts.slice(0, -1));
    }
  };

  const handleClear = () => {
    setStrokes([]);
    setStrokeErrors(null);
    setFeedback("");
  };

  const handleRedoLine = () => {
    setAttempts([]);
    setStrokes([]);
    setStrokeErrors(null);
    setFeedback("");
    setReview(null);
    setSelectedIndex(null);
  };

  // Plays over the wrapper's ghost opacity, so a blank cell still shows it.
  const handleAnimateStrokes = () => {
    const writer = outlineWriterRef.current;
    if (!writer) return;
    setAnimating(true);
    writer.animateCharacter({
      // The card may have advanced and torn this writer down mid-animation.
      onComplete: () => {
        if (outlineWriterRef.current !== writer) return;
        writer.hideCharacter();
        setAnimating(false);
      },
    });
  };

  const cellIndex = attempts.length;
  const lineFull = cellIndex >= lineLength;
  const selectedGrade = review && selectedIndex != null ? review.grades[selectedIndex] : null;
  const selectedErrors = selectedGrade ? strokeErrorsFor(selectedGrade) : null;
  const shouldRedo = review != null && review.passCount < lineLength / 2;

  const padOpacity = review
    ? showModel ? 1 : 0
    : animating ? 1 : ghostOpacity(Math.min(cellIndex, lineLength - 1), lineLength);

  // Committed strokes only change when a stroke is added, undone, cleared, or
  // graded, so memoize them; an in-progress stroke fires many pointermove
  // renders and is drawn separately to keep those renders cheap.
  const committedInk = useMemo(() => {
    if (review) {
      return selectedIndex == null ? null : (
        <InkStrokes strokes={attempts[selectedIndex]} errors={selectedErrors} />
      );
    }
    return <InkStrokes strokes={strokes} errors={strokeErrors} />;
  }, [review, selectedIndex, attempts, strokes, strokeErrors]);

  const legendItems = review
    ? ERROR_LEGEND.filter((item) => selectedErrors && Object.values(selectedErrors).includes(item.reason))
    : ERROR_LEGEND.filter((item) => strokeErrors && Object.values(strokeErrors).includes(item.reason));

  return (
    <div className={styles.writingWriter}>
      <div className={styles.writingDrillRow}>
        <div className={styles.writingReference} aria-label="Character to write">
          {character}
        </div>
        <div className={styles.writingDrillInfo}>
          <div className={styles.writingDrillLabel}>
            {review ? "Check your line" : `Cell ${Math.min(cellIndex + 1, lineLength)} of ${lineLength}`}
          </div>
          {word && <div className={styles.writingDrillWord}>{word.pinyin} · {word.english}</div>}
        </div>
        <CharacterAudioButton word={word} autoPlay />
      </div>

      <div className={styles.writingPad}>
        <div
          ref={outlineRef}
          className={styles.writingTarget}
          style={{ opacity: padOpacity }}
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
          {committedInk}
          {activeStroke && <InkStrokes strokes={[activeStroke]} />}
        </svg>
      </div>

      {legendItems.length > 0 && (
        <div className={styles.writingLegend} aria-label="Writing error legend">
          {legendItems.map((item) => (
            <span key={item.reason} className={styles.writingLegendItem}>
              <span
                className={`${styles.writingLegendSwatch} ${styles[`writingLegendSwatch${capitalize(item.reason)}`]}`}
                aria-hidden
              />
              {item.label}
            </span>
          ))}
        </div>
      )}

      <div className={styles.writingLine}>
        {Array.from({ length: lineLength }, (_, index) => {
          const grade = review?.grades[index];
          return (
            <LineCell
              key={index}
              strokes={attempts[index]}
              errors={grade && strokeErrorsFor(grade)}
              isCurrent={!review && index === cellIndex}
              isBest={review?.bestIndex === index}
              isFailed={grade != null && !grade.passed}
              isSelected={review != null && selectedIndex === index}
              disabled={!review}
              onSelect={() => setSelectedIndex(index)}
              label={`Attempt ${index + 1}`}
            />
          );
        })}
      </div>

      {status === "loading" && <p className={styles.writingStatus}>Loading stroke data…</p>}
      {feedback && <p className={styles.writingStatus}>{feedback}</p>}
      {busy && lineFull && <p className={styles.writingStatus}>Checking your line…</p>}

      {review && (
        <p className={styles.writingStatus}>
          {review.passCount} of {lineLength} passed
          {review.bestIndex != null ? ", best attempt circled." : "."}
          {selectedGrade ? ` Attempt ${selectedIndex + 1}: ${describeGrade(selectedGrade)}` : ""}
        </p>
      )}

      {status === "error" ? (
        <>
          <p className={styles.writingStatus}>No stroke data available for this character.</p>
          <button type="button" className={styles.smallButton} onClick={onSkip}>
            Skip character
          </button>
        </>
      ) : review ? (
        <div className={styles.writingControls}>
          <button type="button" className={styles.smallButton} onClick={() => setShowModel((visible) => !visible)}>
            {showModel ? "Hide model" : "Show model"}
          </button>
          <button
            type="button"
            className={shouldRedo ? styles.primaryButton : styles.smallButton}
            onClick={handleRedoLine}
          >
            Redo line
          </button>
          <button
            type="button"
            className={shouldRedo ? styles.smallButton : styles.primaryButton}
            onClick={() => onDoneRef.current({ character, passCount: review.passCount, lineLength })}
          >
            {isLast ? "Finish" : "Next character"}
          </button>
        </div>
      ) : (
        <div className={styles.writingControls}>
          <button
            type="button"
            className={styles.smallButton}
            disabled={status !== "ready" || busy || animating}
            onClick={handleAnimateStrokes}
          >
            Play strokes
          </button>
          <button
            type="button"
            className={styles.smallButton}
            disabled={busy || (strokes.length === 0 && cellIndex === 0)}
            onClick={handleUndo}
          >
            Undo
          </button>
          <button
            type="button"
            className={styles.smallButton}
            disabled={busy || strokes.length === 0}
            onClick={handleClear}
          >
            Clear
          </button>
          <button
            type="button"
            className={styles.smallButton}
            disabled={busy || strokes.length === 0 || strokeErrors != null}
            onClick={() => commitAttempt(strokes)}
          >
            Next cell
          </button>
          {lineFull && !busy && (
            <button type="button" className={styles.primaryButton} onClick={() => finishLine(attempts)}>
              Check line
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function WritingSession({ characters, lineLength, onExit }) {
  const [charIndex, setCharIndex] = useState(0);
  const [results, setResults] = useState([]);
  const [done, setDone] = useState(false);

  const character = characters[charIndex];

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

  const moveOn = () => {
    if (charIndex + 1 >= characters.length) setDone(true);
    else setCharIndex(charIndex + 1);
  };

  const handleLineDone = (result) => {
    setResults([...results, result]);
    moveOn();
  };

  if (done) {
    return (
      <div className={styles.flashcardSummary}>
        <h2>Session Complete</h2>
        <p>
          {results.length} of {characters.length} character
          {characters.length === 1 ? "" : "s"} drilled
        </p>
        {results.length > 0 && (
          <ul className={styles.writingResultList}>
            {results.map((result) => (
              <li key={result.character}>
                <span className={styles.writingResultChar}>{result.character}</span>
                {result.passCount}/{result.lineLength}
              </li>
            ))}
          </ul>
        )}
        <div className={styles.flashcardActions}>
          <button className={styles.primaryButton} onClick={onExit}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.flashcardContainer}>
      <div className={styles.flashcardProgress}>
        Writing — character {charIndex + 1} of {characters.length}
        <button
          className={`${styles.smallButton} ${styles.writingExitButton}`}
          onClick={() => setDone(true)}
        >
          End session
        </button>
      </div>

      <FillLine
        key={character}
        character={character}
        word={wordByChar.get(character)}
        lineLength={lineLength}
        isLast={charIndex === characters.length - 1}
        onDone={handleLineDone}
        onSkip={moveOn}
      />
    </div>
  );
}

export function Writing() {
  const route = useRoute(["writing", "chars", "reps"]);
  const [customInput, setCustomInput] = useState(() => route.chars || "");
  const [lineLength, setLineLength] = useState(() => parseLineLength(route.reps));

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
        key={`${route.writing}:${route.chars || ""}:${route.reps || ""}`}
        characters={sessionChars}
        lineLength={parseLineLength(route.reps)}
        onExit={() => updateRoute({ writing: false, chars: false, reps: false })}
      />
    );
  }

  const startPreset = (preset) => {
    updateRoute({ writing: preset.id, chars: false, reps: lineLength });
  };

  const startCustom = () => {
    updateRoute({ writing: "custom", chars: customInput, reps: lineLength });
  };

  return (
    <div>
      <h2>Practice Writing</h2>
      <p className={styles.learnDescription}>
        Fill a line with each character. The model fades out as you go, and the
        whole line gets marked at the end.
      </p>

      <div className={styles.formField}>
        <label htmlFor="writing-line-length">Line length</label>
        <select
          id="writing-line-length"
          value={lineLength}
          onChange={(e) => setLineLength(parseLineLength(e.target.value))}
        >
          {LINE_LENGTHS.map((length) => (
            <option key={length} value={length}>
              {length} repetitions
            </option>
          ))}
        </select>
      </div>

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
