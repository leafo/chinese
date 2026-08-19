import { useState, useCallback, useRef } from "react";
import styles from "./index.module.css";
import { PinyinInput } from "./PinyinInput";
import { SyllablePicker } from "./SyllablePicker";
import { matchPinyin, matchEnglish, comparePinyin } from "./matching";
import { useShaker } from "./util";

const PICKER_MODE_KEY = 'pinyinSyllablePicker';

export function PinyinFeedback({ comparison }) {
  if (!comparison) return null;
  return (
    <div className={styles.typingOverlay} aria-hidden>
      {comparison.map((entry, i) => (
        <span key={i} className={entry.correct ? undefined : styles.typingWrongChar}>
          {entry.char}
        </span>
      ))}
    </div>
  );
}

// A typing form for answering a flashcard. For en2zh cards the user types
// pinyin (with tone-mark input + per-character feedback on a wrong answer);
// for zh2en cards the user types the English meaning. Calls onCorrect(clean)
// when the typed answer matches; clean is false if the user submitted a wrong
// answer along the way or gave up. Escape on an empty input calls onGiveUp so
// the parent can show the solution — the user still has to type it.
export function AnswerInput({ word, direction, onCorrect, disabled, gaveUp, onGiveUp }) {
  const [typingValue, setTypingValue] = useState('');
  const [shakeClass, shake] = useShaker();
  const [comparison, setComparison] = useState(null);
  const [hadMistake, setHadMistake] = useState(false);
  const [pickerMode, setPickerMode] = useState(() => localStorage.getItem(PICKER_MODE_KEY) === '1');
  const isZh2En = direction === 'zh2en';

  const togglePickerMode = () => {
    setPickerMode((mode) => {
      localStorage.setItem(PICKER_MODE_KEY, mode ? '' : '1');
      return !mode;
    });
  };

  const typingValueRef = useRef('');
  typingValueRef.current = typingValue;
  const onGiveUpRef = useRef(onGiveUp);
  onGiveUpRef.current = onGiveUp;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (disabled || !typingValue.trim()) return;

    const correct = isZh2En
      ? matchEnglish(typingValue, word.english)
      : matchPinyin(typingValue, word.pinyin);

    if (correct) {
      onCorrect(!hadMistake && !gaveUp);
    } else {
      setHadMistake(true);
      if (!isZh2En) setComparison(comparePinyin(typingValue, word.pinyin));
      shake();
    }
  };

  const inputClassName = `${styles.typingInput} ${shakeClass} ${comparison ? styles.typingInputTransparent : ''}`;
  // Stable identities so PinyinInput's beforeinput listener attaches once per
  // mount rather than re-binding on every keystroke.
  const handleChange = useCallback((e) => { setTypingValue(e.target.value); setComparison(null); }, []);
  const handleKeyDown = useCallback((e) => {
    setComparison(null);
    if (e.key === 'Escape' && !typingValueRef.current.trim()) {
      e.preventDefault();
      onGiveUpRef.current?.();
    }
  }, []);

  if (isZh2En) {
    return (
      <form className={styles.typingForm} onSubmit={handleSubmit}>
        <div className={styles.typingInputWrap}>
          <input
            autoFocus
            className={inputClassName}
            value={typingValue}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={gaveUp ? "Type the answer shown above..." : "Type English..."}
          />
          <PinyinFeedback comparison={comparison} />
        </div>
      </form>
    );
  }

  return (
    <div className={styles.answerInputColumn}>
      {pickerMode ? (
        <SyllablePicker
          word={word}
          onCorrect={onCorrect}
          disabled={disabled}
          gaveUp={gaveUp}
        />
      ) : (
        <form className={styles.typingForm} onSubmit={handleSubmit}>
          <div className={styles.typingInputWrap}>
            <PinyinInput
              withHelp
              autoFocus
              className={inputClassName}
              value={typingValue}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder={gaveUp ? "Type the answer shown above..." : "Type pinyin..."}
            />
            <PinyinFeedback comparison={comparison} />
          </div>
        </form>
      )}
      <button
        type="button"
        className={styles.syllableModeToggle}
        onClick={togglePickerMode}
      >
        {pickerMode ? 'Use keyboard' : 'Use syllable buttons'}
      </button>
    </div>
  );
}
