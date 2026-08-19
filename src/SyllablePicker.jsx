import { useState, useMemo } from "react";
import styles from "./index.module.css";
import { stripPinyinTones, TONE_MAP, findToneVowelIndex } from "./PinyinInput";
import { matchPinyin } from "./matching";
import { useShaker } from "./util";

// Syllable segmentation for toned pinyin. Works on the tone-stripped
// lowercase string; indices map 1:1 back to the original text.
const SPLIT_FINALS = [
  'a', 'o', 'e', 'ai', 'ei', 'ao', 'ou', 'an', 'en', 'ang', 'eng', 'ong', 'er',
  'i', 'ia', 'ie', 'iao', 'iu', 'ian', 'in', 'iang', 'ing', 'iong',
  'u', 'ua', 'uo', 'uai', 'ui', 'uan', 'un', 'uang', 'ueng',
  'ü', 'üe', 'üan', 'ün',
  'ue', // üe as written after j/q/x/y (xué, yuè)
].sort((a, b) => b.length - a.length);
const SPLIT_INITIALS_2 = new Set(['zh', 'ch', 'sh']);
const SPLIT_INITIALS_1 = new Set('bpmfdtnlgkhjqxrzcsyw');

function syllableLengthsAt(s, i) {
  const initialLengths = [];
  if (SPLIT_INITIALS_2.has(s.slice(i, i + 2))) initialLengths.push(2);
  if (SPLIT_INITIALS_1.has(s[i])) initialLengths.push(1);
  initialLengths.push(0);

  const lengths = [];
  for (const il of initialLengths) {
    for (const final of SPLIT_FINALS) {
      if (s.startsWith(final, i + il)) lengths.push(il + final.length);
    }
  }
  return lengths.sort((a, b) => b - a);
}

// Split a chunk (no spaces/apostrophes) into syllable boundary offsets, or
// null if it can't be parsed. Picks the split with the fewest erhua "r"
// absorptions, then the fewest syllables, then greedy-longest syllables — so
// an "r" never steals the initial from a following syllable ("gōngrén" ->
// gōng rén) but is absorbed when nothing else parses ("diǎnr" -> diǎnr).
function splitChunk(s) {
  const memo = new Map();

  // Returns { ends, cost } for the cheapest split of s.slice(i), or null
  function go(i) {
    if (i === s.length) return { ends: [], cost: 0 };
    if (memo.has(i)) return memo.get(i);
    let best = null;
    for (const len of syllableLengthsAt(s, i)) {
      for (const absorbR of [0, 1]) {
        if (absorbR && s[i + len] !== 'r') continue;
        const end = i + len + absorbR;
        const rest = go(end);
        if (!rest) continue;
        const cost = absorbR * 1000 + 1 + rest.cost;
        // Strict < keeps the first (longest-syllable) split on cost ties
        if (!best || cost < best.cost) best = { ends: [end, ...rest.ends], cost };
      }
    }
    memo.set(i, best);
    return best;
  }

  return go(0)?.ends ?? null;
}

// Split toned pinyin like "shénme" or "nǎ guó rén" into syllables.
export function splitPinyinSyllables(pinyin) {
  const syllables = [];
  for (const chunk of pinyin.split(/[\s'’]+/).filter(Boolean)) {
    const normalized = stripPinyinTones(chunk).toLowerCase();
    const boundaries = splitChunk(normalized);
    if (!boundaries) {
      // Unparseable (rare); treat the whole chunk as one syllable
      syllables.push(chunk);
      continue;
    }
    let start = 0;
    for (const end of boundaries) {
      syllables.push(chunk.slice(start, end));
      start = end;
    }
  }
  return syllables;
}

const TONED_CHARS = Object.values(TONE_MAP).flat();

function detectTone(syllable) {
  for (const char of syllable) {
    const idx = TONED_CHARS.indexOf(char);
    if (idx !== -1) return (idx % 4) + 1;
  }
  return 0;
}

// Apply a tone (1-4, or 0 for neutral) to a toneless lowercase syllable
function toneSyllable(base, tone) {
  if (tone === 0) return base;
  const idx = findToneVowelIndex(base);
  if (idx === -1) return base;
  return base.slice(0, idx) + TONE_MAP[base[idx]][tone - 1] + base.slice(idx + 1);
}

// Filler syllables used to pad the tile grid for short words
const COMMON_SYLLABLES = [
  'de', 'le', 'shì', 'bù', 'yī', 'rén', 'hǎo', 'zhōng', 'guó', 'xiǎo',
  'dà', 'shàng', 'xià', 'tā', 'men', 'lái', 'qù', 'yǒu', 'hěn', 'duō',
];

const MIN_TILES = 9;
const TONE_VARIANTS_PER_SYLLABLE = 2;

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function buildTiles(correctSyllables) {
  const tiles = [];
  const seen = new Set();
  const add = (syllable) => {
    const key = syllable.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    tiles.push(syllable);
  };

  for (const syllable of correctSyllables) add(syllable);

  // Distractors: other tones of each correct syllable's base
  const usedBases = new Set();
  for (const syllable of correctSyllables) {
    const base = stripPinyinTones(syllable).toLowerCase();
    usedBases.add(base);
    const otherTones = shuffle([0, 1, 2, 3, 4].filter(t => t !== detectTone(syllable)));
    for (const tone of otherTones.slice(0, TONE_VARIANTS_PER_SYLLABLE)) {
      add(toneSyllable(base, tone));
    }
  }

  // Pad with unrelated common syllables so short words still get a real grid
  for (const syllable of shuffle(COMMON_SYLLABLES)) {
    if (tiles.length >= MIN_TILES) break;
    if (usedBases.has(stripPinyinTones(syllable))) continue;
    add(syllable);
  }

  return shuffle(tiles);
}

// Tap-to-build pinyin answer input: shows the word's syllables mixed with
// distractor tiles (mostly tone variants). Auto-checks once enough syllables
// are placed; a wrong answer shakes and drops the wrong syllables, keeping
// the correct prefix.
export function SyllablePicker({ word, onCorrect, disabled, gaveUp }) {
  const { correctSyllables, tiles } = useMemo(() => {
    const variant = (word.pinyin || '').split('/')[0].trim();
    const correct = splitPinyinSyllables(variant);
    return { correctSyllables: correct, tiles: buildTiles(correct) };
  }, [word.id, word.pinyin]);

  const [built, setBuilt] = useState([]);
  const [hadMistake, setHadMistake] = useState(false);
  const [shakeClass, shake] = useShaker();

  const handleTile = (syllable) => {
    if (disabled) return;
    const next = [...built, syllable];
    if (next.length < correctSyllables.length) {
      setBuilt(next);
      return;
    }
    if (matchPinyin(next.join(' '), word.pinyin)) {
      onCorrect(!hadMistake && !gaveUp);
    } else {
      setHadMistake(true);
      let keep = 0;
      while (keep < next.length && next[keep].toLowerCase() === correctSyllables[keep].toLowerCase()) keep++;
      setBuilt(next.slice(0, keep));
      shake();
    }
  };

  return (
    <div className={styles.syllablePicker}>
      <div className={`${styles.syllableBuilt} ${shakeClass}`}>
        {built.length > 0 ? (
          <span className={styles.syllableBuiltText}>{built.join(' ')}</span>
        ) : (
          <span className={styles.syllableBuiltPlaceholder}>
            {gaveUp ? 'Tap the syllables shown above...' : 'Tap syllables...'}
          </span>
        )}
        <button
          type="button"
          className={styles.syllableBackspace}
          onClick={() => setBuilt(built.slice(0, -1))}
          disabled={disabled || built.length === 0}
          aria-label="Remove last syllable"
        >⌫</button>
      </div>
      <div className={styles.syllableTiles}>
        {tiles.map((syllable) => (
          <button
            key={syllable}
            type="button"
            className={styles.syllableTile}
            onClick={() => handleTile(syllable)}
            disabled={disabled}
          >{syllable}</button>
        ))}
      </div>
    </div>
  );
}
