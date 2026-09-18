// Pure helpers for building a Duolingo-style exercise session from the
// words and sentences in a set of collections. No React here so the queue
// generation is easy to reason about and test.

import { getPreferredChineseText } from './display';

export const EXERCISE_TYPES = [
  { id: 'zh2en', label: 'Chinese → English (choose)' },
  { id: 'en2zh', label: 'English → Chinese (choose)' },
  { id: 'listen', label: 'Listening (choose what you hear)' },
  { id: 'wordbank', label: 'Build the sentence' },
  { id: 'pinyin', label: 'Tap the pinyin' },
];

const OPTION_COUNT = 4;
const SENTENCE_SHARE = 0.35;
const WORDBANK_DISTRACTORS = 3;
const PUNCTUATION = /[，。？！、：；「」『』“”‘’…,.?!;:'"()（）\s]/;

export function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function pick(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function inCollections(item, collectionIds) {
  return (item.collection_ids || []).some(id => collectionIds.includes(id));
}

export function buildPool(allWords, allSentences, collectionIds) {
  return {
    words: (allWords || []).filter(w => inCollections(w, collectionIds)),
    sentences: (allSentences || []).filter(s => inCollections(s, collectionIds)),
  };
}

// Forward maximum matching of a sentence against the word list, in the given
// script. Unmatched characters become single-character tokens so every
// sentence can still be built from tiles.
export function tokenizeSentence(sentence, allWords, script) {
  const text = getPreferredChineseText(sentence, script);
  const byText = new Map();
  let maxLen = 1;
  for (const word of allWords) {
    const t = getPreferredChineseText(word, script);
    if (!t || PUNCTUATION.test(t)) continue;
    if (!byText.has(t)) byText.set(t, word);
    if (t.length > maxLen) maxLen = t.length;
  }

  const tokens = [];
  let i = 0;
  while (i < text.length) {
    if (PUNCTUATION.test(text[i])) {
      tokens.push({ text: text[i], punct: true });
      i += 1;
      continue;
    }
    let matched = false;
    for (let len = Math.min(maxLen, text.length - i); len >= 1; len--) {
      const slice = text.slice(i, i + len);
      if (byText.has(slice)) {
        tokens.push({ text: slice, punct: false });
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) {
      tokens.push({ text: text[i], punct: false });
      i += 1;
    }
  }
  return tokens;
}

// Cycles through a shuffled list so items are spread evenly before repeating.
function makeCycler(items) {
  let order = shuffle(items);
  let index = 0;
  return () => {
    if (order.length === 0) return null;
    if (index >= order.length) {
      order = shuffle(items);
      index = 0;
    }
    return order[index++];
  };
}

function distractorsFor(item, primary, fallback, count) {
  const same = (a, b) => a.id === b.id;
  const notItem = list => list.filter(x => !same(x, item));
  let candidates = shuffle(notItem(primary));
  if (candidates.length < count) {
    const extra = shuffle(notItem(fallback)).filter(x => !candidates.some(c => same(c, x)));
    candidates = [...candidates, ...extra];
  }
  return candidates.slice(0, count);
}

function choiceExercise(type, kind, item, pool, all) {
  const primary = kind === 'word' ? pool.words : pool.sentences;
  const fallback = kind === 'word' ? all.words : all.sentences;
  const distractors = distractorsFor(item, primary, fallback, OPTION_COUNT - 1);
  if (distractors.length < OPTION_COUNT - 1) return null;
  return {
    id: `${type}-${kind}-${item.id}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    kind,
    item,
    options: shuffle([item, ...distractors]),
  };
}

function wordbankExercise(sentence, pool, all, script) {
  const tokens = tokenizeSentence(sentence, all.words, script);
  const answerTokens = tokens.filter(t => !t.punct);
  if (answerTokens.length < 2) return null;

  const used = new Set(answerTokens.map(t => t.text));
  const distractorWords = shuffle([...pool.words, ...all.words])
    .map(w => getPreferredChineseText(w, script))
    .filter(t => t && !used.has(t) && !PUNCTUATION.test(t));
  const distractors = [...new Set(distractorWords)].slice(0, WORDBANK_DISTRACTORS);

  const tiles = shuffle([
    ...answerTokens.map((t, i) => ({ id: `a${i}`, text: t.text })),
    ...distractors.map((t, i) => ({ id: `d${i}`, text: t })),
  ]);

  return {
    id: `wordbank-${sentence.id}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'wordbank',
    kind: 'sentence',
    item: sentence,
    tokens,
    answer: answerTokens.map(t => t.text),
    tiles,
  };
}

function pinyinExercise(word) {
  if (!word.pinyin) return null;
  return {
    id: `pinyin-${word.id}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'pinyin',
    kind: 'word',
    item: word,
  };
}

function hasAudio(item) {
  return Boolean(item.pinyin);
}

// Builds one exercise of the given type. `item` is optional; when omitted a
// fresh item is drawn from the cyclers. Returns null if the pool can't
// support that type.
export function makeExercise(type, ctx, forcedItem = null) {
  const { pool, all, script, nextWord, nextSentence } = ctx;
  const wantSentence = () =>
    pool.sentences.length > 0 && (pool.words.length === 0 || Math.random() < SENTENCE_SHARE);

  switch (type) {
    case 'zh2en':
    case 'en2zh': {
      const kind = forcedItem ? forcedItem.kind : (wantSentence() ? 'sentence' : 'word');
      const item = forcedItem ? forcedItem.item : (kind === 'sentence' ? nextSentence() : nextWord());
      if (!item) return null;
      return choiceExercise(type, kind, item, pool, all);
    }
    case 'listen': {
      const kind = forcedItem ? forcedItem.kind : (wantSentence() ? 'sentence' : 'word');
      let item = forcedItem ? forcedItem.item : (kind === 'sentence' ? nextSentence() : nextWord());
      if (!item || !hasAudio(item)) return null;
      return choiceExercise(type, kind, item, pool, all);
    }
    case 'wordbank': {
      const item = forcedItem ? forcedItem.item : nextSentence();
      if (!item) return null;
      return wordbankExercise(item, pool, all, script);
    }
    case 'pinyin': {
      const item = forcedItem ? forcedItem.item : nextWord();
      if (!item) return null;
      return pinyinExercise(item);
    }
    default:
      return null;
  }
}

export function createSessionContext({ pool, all, script }) {
  return {
    pool,
    all,
    script,
    nextWord: makeCycler(pool.words),
    nextSentence: makeCycler(pool.sentences),
  };
}

export function buildQueue(ctx, enabledTypes, length) {
  const queue = [];
  const types = enabledTypes.filter(t => EXERCISE_TYPES.some(e => e.id === t));
  if (types.length === 0) return queue;

  let typeOrder = shuffle(types);
  let attempts = 0;
  while (queue.length < length && attempts < length * 6) {
    attempts++;
    const type = typeOrder[queue.length % typeOrder.length];
    const exercise = makeExercise(type, ctx);
    if (exercise) {
      queue.push(exercise);
    } else {
      // This type can't be built from the pool; drop it so we don't spin.
      typeOrder = typeOrder.filter(t => t !== type);
      if (typeOrder.length === 0) break;
    }
  }
  return queue;
}

// Rebuild a missed exercise with fresh distractors and tile order so the
// retry isn't answerable from memory of positions.
export function retryExercise(exercise, ctx) {
  return makeExercise(exercise.type, ctx, { item: exercise.item, kind: exercise.kind }) || exercise;
}

export function itemKey(exercise) {
  return `${exercise.kind}-${exercise.item.id}`;
}
