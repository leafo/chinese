import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import HanziWriter from "hanzi-writer";
import styles from "./index.module.css";

const DEFAULT_CHARACTERS = "一二三四五六七八九十";

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

// Renders a single HanziWriter quiz for one character. Keyed by `character`
// in the parent so the writer is rebuilt cleanly when the character changes.
function CharacterWriter({ character, onComplete }) {
  const targetRef = useRef(null);
  const writerRef = useRef(null);
  const [status, setStatus] = useState("loading");

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const startQuiz = useCallback(() => {
    const writer = writerRef.current;
    if (!writer) return;
    writer.quiz({
      showHintAfterMisses: 2,
      onComplete: () => onCompleteRef.current?.(),
    });
  }, []);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    target.innerHTML = "";
    setStatus("loading");

    const writer = HanziWriter.create(target, character, {
      width: 260,
      height: 260,
      padding: 10,
      showCharacter: false,
      showOutline: true,
      drawingWidth: 28,
      strokeColor: "#0f172a",
      outlineColor: "#cbd5e1",
      radicalColor: "#7c3aed",
      highlightOnComplete: true,
      onLoadCharDataSuccess: () => setStatus("ready"),
      onLoadCharDataError: () => setStatus("error"),
    });
    writerRef.current = writer;

    writer.quiz({
      showHintAfterMisses: 2,
      onComplete: () => onCompleteRef.current?.(),
    });

    return () => {
      writerRef.current = null;
      target.innerHTML = "";
    };
  }, [character]);

  return (
    <div className={styles.writingWriter}>
      <div ref={targetRef} className={styles.writingTarget} />
      {status === "loading" && (
        <p className={styles.writingStatus}>Loading stroke data…</p>
      )}
      {status === "error" && (
        <p className={styles.writingStatus}>
          No stroke data available for this character.
        </p>
      )}
      <div className={styles.writingControls}>
        <button
          type="button"
          className={styles.smallButton}
          disabled={status !== "ready"}
          onClick={() => writerRef.current?.animateCharacter()}
        >
          Show stroke order
        </button>
        <button
          type="button"
          className={styles.smallButton}
          disabled={status !== "ready"}
          onClick={startQuiz}
        >
          Restart character
        </button>
      </div>
    </div>
  );
}

function WritingSession({ characters, onExit }) {
  const [index, setIndex] = useState(0);
  const [doneIndexes, setDoneIndexes] = useState(() => new Set());

  const character = characters[index];
  const isDone = doneIndexes.has(index);
  const allDone = doneIndexes.size === characters.length;

  const handleComplete = useCallback(() => {
    setDoneIndexes((prev) => {
      if (prev.has(index)) return prev;
      const next = new Set(prev);
      next.add(index);
      return next;
    });
  }, [index]);

  const goPrev = () => setIndex((i) => Math.max(0, i - 1));
  const goNext = () => setIndex((i) => Math.min(characters.length - 1, i + 1));

  return (
    <div className={styles.flashcardContainer}>
      <div className={styles.flashcardProgress}>
        Writing practice — {index + 1}/{characters.length}
        {" · "}
        {doneIndexes.size} completed
        <button
          className={`${styles.smallButton} ${styles.writingExitButton}`}
          onClick={onExit}
        >
          Change characters
        </button>
      </div>

      <CharacterWriter
        key={character}
        character={character}
        onComplete={handleComplete}
      />

      {isDone && (
        <p className={styles.writingDone}>Nice — character complete!</p>
      )}

      <div className={styles.writingNav}>
        <button
          className={styles.smallButton}
          onClick={goPrev}
          disabled={index === 0}
        >
          Previous
        </button>
        <button
          className={styles.primaryButton}
          onClick={goNext}
          disabled={index === characters.length - 1}
        >
          Next character
        </button>
      </div>

      {allDone && (
        <p className={styles.writingDone}>
          All {characters.length} characters complete!
        </p>
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
        characters={sessionChars}
        onExit={() => setSessionChars(null)}
      />
    );
  }

  return (
    <div>
      <h2>Practice Writing</h2>
      <p className={styles.learnDescription}>
        Practice writing Chinese characters stroke by stroke. Enter the
        characters you want to practice below — any non-Chinese text is ignored,
        and duplicates are removed. Defaults to the numbers one through ten.
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
        className={styles.primaryButton}
        disabled={parsedPreview.length === 0}
        onClick={() => setSessionChars(parsedPreview)}
      >
        Start practice
      </button>
    </div>
  );
}
