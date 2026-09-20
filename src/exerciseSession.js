// Session building for the Exercise tab: pools, queue, retries. No React so
// it can run under node.

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

function inCollections(item, collectionIds) {
  return (item.collection_ids || []).some(id => collectionIds.includes(id));
}

export function buildPool(allWords, allSentences, collectionIds) {
  return {
    words: (allWords || []).filter(w => inCollections(w, collectionIds)),
    sentences: (allSentences || []).filter(s => inCollections(s, collectionIds)),
  };
}

// Forward maximum matching against the word list. Characters no word covers
// become single-character tokens so every sentence can still be tiled.
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

// Shuffled round-robin, so nothing repeats before everything has been drawn.
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

// Two entries can share a gloss ("not") or the same characters, and either
// would show up as an identical option scored wrong, so candidates are
// deduped by every text they could be displayed as.
function displayTexts(item) {
  return [item.english, item.simplified, item.traditional]
    .filter(Boolean)
    .map(t => t.trim().toLowerCase());
}

function distractorsFor(item, primary, fallback, count) {
  const seen = new Set(displayTexts(item));
  const seenIds = new Set([item.id]);
  const result = [];
  for (const candidate of [...shuffle(primary), ...shuffle(fallback)]) {
    if (result.length >= count) break;
    if (seenIds.has(candidate.id)) continue;
    const texts = displayTexts(candidate);
    if (texts.some(t => seen.has(t))) continue;
    seenIds.add(candidate.id);
    for (const t of texts) seen.add(t);
    result.push(candidate);
  }
  return result;
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

// forcedItem replays a specific item (retries) instead of drawing a new one.
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
      if (forcedItem && forcedItem.kind !== 'sentence') return null;
      const item = forcedItem ? forcedItem.item : nextSentence();
      if (!item) return null;
      return wordbankExercise(item, pool, all, script);
    }
    case 'pinyin': {
      if (forcedItem && forcedItem.kind !== 'word') return null;
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

// makeExercise can fail for one item (no pinyin, sentence too short to tile)
// without the type being unbuildable, so a type is only dropped after
// several misses.
const BUILD_RETRIES = 8;

export function buildQueue(ctx, enabledTypes, length) {
  const queue = [];
  const types = enabledTypes.filter(t => EXERCISE_TYPES.some(e => e.id === t));
  if (types.length === 0) return queue;

  let typeOrder = shuffle(types);
  while (queue.length < length && typeOrder.length > 0) {
    const type = typeOrder[queue.length % typeOrder.length];
    let exercise = null;
    for (let i = 0; i < BUILD_RETRIES && !exercise; i++) {
      exercise = makeExercise(type, ctx);
    }
    if (exercise) {
      queue.push(exercise);
    } else {
      typeOrder = typeOrder.filter(t => t !== type);
    }
  }
  return queue;
}

// Every item in every enabled type it fits, arranged round-robin across items
// so the same one never comes up twice in a row. Used for the follow-up
// session on a summary's missed list, where the pool is usually tiny.
export function buildFocusQueue(ctx, enabledTypes, items, maxLength) {
  const types = enabledTypes.filter(t => EXERCISE_TYPES.some(e => e.id === t));
  const perItem = shuffle(items).map(({ item, kind }) =>
    shuffle(types)
      .map(type => makeExercise(type, ctx, { item, kind }))
      .filter(Boolean)
  );
  const queue = [];
  const longest = Math.max(0, ...perItem.map(list => list.length));
  for (let round = 0; round < longest; round++) {
    for (const list of perItem) {
      if (list[round]) queue.push(list[round]);
    }
  }
  return queue.slice(0, maxLength);
}

// Fresh distractors and tile order, so a retry can't be answered by position.
export function retryExercise(exercise, ctx) {
  return makeExercise(exercise.type, ctx, { item: exercise.item, kind: exercise.kind }) || exercise;
}

export function itemKey(exercise) {
  return `${exercise.kind}-${exercise.item.id}`;
}
