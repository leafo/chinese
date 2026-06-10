import { useState, useCallback } from "react";
import styles from "./index.module.css";
import { PinyinInput } from "./PinyinInput";
import { matchPinyin, matchEnglish, comparePinyin } from "./matching";
import { useShaker } from "./util";

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
// for zh2en cards the user types the English meaning. Calls onCorrect when the
// typed answer matches.
export function AnswerInput({ word, direction, onCorrect, disabled }) {
  const [typingValue, setTypingValue] = useState('');
  const [shakeClass, shake] = useShaker();
  const [comparison, setComparison] = useState(null);
  const isZh2En = direction === 'zh2en';

  const handleSubmit = (e) => {
    e.preventDefault();
    if (disabled || !typingValue.trim()) return;

    const correct = isZh2En
      ? matchEnglish(typingValue, word.english)
      : matchPinyin(typingValue, word.pinyin);

    if (correct) {
      onCorrect();
    } else {
      if (!isZh2En) setComparison(comparePinyin(typingValue, word.pinyin));
      shake();
    }
  };

  const inputClassName = `${styles.typingInput} ${shakeClass} ${comparison ? styles.typingInputTransparent : ''}`;
  // Stable identities so PinyinInput's beforeinput listener attaches once per
  // mount rather than re-binding on every keystroke.
  const handleChange = useCallback((e) => { setTypingValue(e.target.value); setComparison(null); }, []);
  const handleKeyDown = useCallback(() => setComparison(null), []);

  return (
    <form className={styles.typingForm} onSubmit={handleSubmit}>
      <div className={styles.typingInputWrap}>
        {isZh2En ? (
          <input
            autoFocus
            className={inputClassName}
            value={typingValue}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Type English..."
          />
        ) : (
          <PinyinInput
            withHelp
            autoFocus
            className={inputClassName}
            value={typingValue}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Type pinyin..."
          />
        )}
        <PinyinFeedback comparison={comparison} />
      </div>
    </form>
  );
}
