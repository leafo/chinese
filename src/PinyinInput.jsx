import { useState, useRef, useEffect, useCallback } from "react";
import styles from "./index.module.css";
import { useModalDialog } from "./util";

const TONE_MAP = {
  a: ['ā', 'á', 'ǎ', 'à'],
  e: ['ē', 'é', 'ě', 'è'],
  i: ['ī', 'í', 'ǐ', 'ì'],
  o: ['ō', 'ó', 'ǒ', 'ò'],
  u: ['ū', 'ú', 'ǔ', 'ù'],
  ü: ['ǖ', 'ǘ', 'ǚ', 'ǜ'],
};

const VOWELS = 'aeiouü';
const INITIALS = new Set(['b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w']);
const DIGRAPH_INITIALS = new Set(['zh', 'ch', 'sh']);
const TONELESS_MAP = {
  ā: 'a',
  á: 'a',
  ǎ: 'a',
  à: 'a',
  ē: 'e',
  é: 'e',
  ě: 'e',
  è: 'e',
  ī: 'i',
  í: 'i',
  ǐ: 'i',
  ì: 'i',
  ō: 'o',
  ó: 'o',
  ǒ: 'o',
  ò: 'o',
  ū: 'u',
  ú: 'u',
  ǔ: 'u',
  ù: 'u',
  ǖ: 'ü',
  ǘ: 'ü',
  ǚ: 'ü',
  ǜ: 'ü',
};

function normalizePinyin(text) {
  return text.replace(/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜv]/g, (char) => TONELESS_MAP[char] || 'ü');
}

function normalizeChar(char) {
  return (TONELESS_MAP[char] || char).toLowerCase();
}

function isVowelChar(char) {
  return VOWELS.includes(normalizeChar(char)) || normalizeChar(char) === 'v';
}

function findToneVowelIndex(syllable) {
  // Rule 1: a or e gets the mark
  for (let i = 0; i < syllable.length; i++) {
    if (syllable[i] === 'a' || syllable[i] === 'e') return i;
  }
  // Rule 2: ou -> mark on o
  const ouIdx = syllable.indexOf('ou');
  if (ouIdx !== -1) return ouIdx;
  // Rule 3: last vowel gets the mark
  for (let i = syllable.length - 1; i >= 0; i--) {
    if (VOWELS.includes(syllable[i])) return i;
  }
  return -1;
}

function findSyllableStart(text, cursorPos) {
  let i = cursorPos - 2;
  if (i < 0) return -1;

  if (
    text[i] === 'g' &&
    i > 1 &&
    normalizeChar(text[i - 1]) === 'n' &&
    isVowelChar(text[i - 2])
  ) {
    i -= 2;
  } else if (
    (normalizeChar(text[i]) === 'n' || normalizeChar(text[i]) === 'r') &&
    i > 0 &&
    isVowelChar(text[i - 1])
  ) {
    i -= 1;
  }

  let sawVowel = false;
  while (i >= 0 && isVowelChar(text[i])) {
    sawVowel = true;
    i -= 1;
  }

  if (!sawVowel) {
    return -1;
  }

  if (i >= 1) {
    const digraph = `${normalizeChar(text[i - 1])}${normalizeChar(text[i])}`;
    if (DIGRAPH_INITIALS.has(digraph)) {
      return i - 1;
    }
  }

  if (i >= 0 && INITIALS.has(normalizeChar(text[i]))) {
    return i;
  }

  return i + 1;
}

function applyTone(text, cursorPos) {
  // Look backwards from cursor to find the tone digit
  if (cursorPos < 1) return null;

  const digit = text[cursorPos - 1];
  const toneNum = parseInt(digit);
  if (isNaN(toneNum) || toneNum < 0 || toneNum > 5) return null;

  const syllableStart = findSyllableStart(text, cursorPos);
  if (syllableStart === -1) return null;
  const syllable = text.slice(syllableStart, cursorPos - 1);
  const normalized = normalizePinyin(syllable);

  if (toneNum === 0 || toneNum === 5) {
    // Neutral tone: just remove the digit, keep normalization
    const before = text.slice(0, syllableStart) + normalized;
    const after = text.slice(cursorPos);
    return { value: before + after, cursor: before.length };
  }

  const vowelIdx = findToneVowelIndex(normalized);
  if (vowelIdx === -1) return null;

  const baseVowel = normalized[vowelIdx];
  const toned = TONE_MAP[baseVowel][toneNum - 1];
  const converted = normalized.slice(0, vowelIdx) + toned + normalized.slice(vowelIdx + 1);

  const before = text.slice(0, syllableStart) + converted;
  const after = text.slice(cursorPos);
  return { value: before + after, cursor: before.length };
}

const EXAMPLES = [
  ['ma1', 'mā', '1st tone (flat)'],
  ['ma2', 'má', '2nd tone (rising)'],
  ['ma3', 'mǎ', '3rd tone (dipping)'],
  ['ma4', 'mà', '4th tone (falling)'],
  ['ma5', 'ma', '5th tone (neutral)'],
  ['nv3', 'nǚ', 'v becomes ü'],
];

function PinyinHelpDialog({ onClose }) {
  const dialogRef = useModalDialog();

  return (
    <dialog
      ref={dialogRef}
      className={styles.modalDialog}
      onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={styles.modalHeader}>
        <h3>Pinyin Input</h3>
        <button type="button" className={styles.secondaryButton} onClick={onClose}>Close</button>
      </div>
      <div className={styles.modalBody}>
        <p>Type pinyin followed by a tone number <strong>(1-5)</strong> to insert tone marks automatically.</p>
        <table className={styles.pinyinHelpTable}>
          <thead>
            <tr>
              <th>You type</th>
              <th>Result</th>
              <th>Tone</th>
            </tr>
          </thead>
          <tbody>
            {EXAMPLES.map(([input, output, desc]) => (
              <tr key={input}>
                <td><code>{input}</code></td>
                <td>{output}</td>
                <td>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>Separate syllables with spaces: <code>ni3 hao3</code> becomes <strong>nǐ hǎo</strong></p>
      </div>
    </dialog>
  );
}

export function PinyinInput({ value, onChange, withHelp, ...props }) {
  const [helpOpen, setHelpOpen] = useState(false);
  const inputRef = useRef(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  const handleBeforeInput = useCallback((e) => {
    if (e.inputType !== 'deleteContentBackward') return;
    const input = e.target;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const val = valueRef.current;

    let charToCheck, replaceStart, cursorAfter;

    if (start === end) {
      // Caret deletion (physical keyboard): check char before cursor
      if (start === 0) return;
      charToCheck = val[start - 1];
      replaceStart = start - 1;
      cursorAfter = start;
    } else if (end - start === 1) {
      // Selection deletion (touch keyboard): check the selected char
      charToCheck = val[start];
      replaceStart = start;
      cursorAfter = start + 1;
    } else {
      return;
    }

    const base = TONELESS_MAP[charToCheck];
    if (!base) return;

    e.preventDefault();
    const newValue = val.slice(0, replaceStart) + base + val.slice(replaceStart + 1);
    onChange({ target: { value: newValue } });
    requestAnimationFrame(() => {
      input.setSelectionRange(cursorAfter, cursorAfter);
    });
  }, [onChange]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.addEventListener('beforeinput', handleBeforeInput);
    return () => input.removeEventListener('beforeinput', handleBeforeInput);
  }, [handleBeforeInput]);

  const handleChange = (e) => {
    const input = e.target;
    const newValue = input.value;
    const cursor = input.selectionStart;

    const result = applyTone(newValue, cursor);
    if (result) {
      onChange({ target: { value: result.value } });
      requestAnimationFrame(() => {
        input.setSelectionRange(result.cursor, result.cursor);
      });
    } else {
      onChange(e);
    }
  };

  const input = (
    <input
      ref={inputRef}
      value={value}
      onChange={handleChange}
      {...props}
    />
  );

  if (!withHelp) return input;

  return (
    <>
      <div className={styles.pinyinInputWrapper}>
        {input}
        <button
          type="button"
          className={styles.pinyinHelpButton}
          onClick={() => setHelpOpen(true)}
          title="Pinyin input help"
        >?</button>
      </div>
      {helpOpen && <PinyinHelpDialog onClose={() => setHelpOpen(false)} />}
    </>
  );
}
