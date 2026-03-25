import { IndexedDBStore } from './database';
import { getAllWords } from './words';
import { useAsync } from './util';
import React from 'react';

const STORE_NAME = 'flashcard_reviews';
export const store = new IndexedDBStore(STORE_NAME);

function nowISO() {
  return new Date().toISOString();
}

function addDaysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function createCard(wordId, direction) {
  return {
    key: `${wordId}-${direction}`,
    wordId,
    direction,
    easeFactor: 2.5,
    interval: 0,
    repetitions: 0,
    dueDate: nowISO(),
    lastReviewDate: null,
  };
}

export async function ensureCardsForAllWords() {
  const [words, existing] = await Promise.all([
    getAllWords(),
    store.getAll(),
  ]);

  const wordIds = new Set(words.map(word => word.id));
  const existingKeys = new Set(existing.map(card => card.key));
  const newCards = [];
  const staleCards = [];

  for (const card of existing) {
    if (!wordIds.has(card.wordId)) {
      staleCards.push(card);
    }
  }

  for (const word of words) {
    for (const dir of ['en2zh', 'zh2en']) {
      const key = `${word.id}-${dir}`;
      if (!existingKeys.has(key)) {
        newCards.push(createCard(word.id, dir));
      }
    }
  }

  await Promise.all([
    ...newCards.map(card => store.put(card)),
    ...staleCards.map(card => store.remove(card.key)),
  ]);
  return newCards.length;
}

export function computeNextReview(card, rating) {
  const now = nowISO();
  let { easeFactor, interval, repetitions } = card;

  switch (rating) {
    case 'again':
      repetitions = 0;
      interval = 0;
      easeFactor = Math.max(1.3, easeFactor - 0.2);
      break;
    case 'hard':
      interval = Math.max(1, Math.round(interval * 1.2));
      easeFactor = Math.max(1.3, easeFactor - 0.15);
      repetitions += 1;
      break;
    case 'good':
      if (repetitions === 0) interval = 1;
      else if (repetitions === 1) interval = 6;
      else interval = Math.round(interval * easeFactor);
      repetitions += 1;
      break;
    case 'easy':
      if (repetitions === 0) interval = 1;
      else if (repetitions === 1) interval = 6;
      else interval = Math.round(interval * easeFactor);
      interval = Math.round(interval * 1.3);
      easeFactor += 0.15;
      repetitions += 1;
      break;
  }

  return {
    ...card,
    easeFactor,
    interval,
    repetitions,
    dueDate: addDaysFromNow(interval),
    lastReviewDate: now,
  };
}

export function projectedInterval(card, rating) {
  return computeNextReview(card, rating).interval;
}

export async function rateCard(key, rating) {
  const card = await store.get(key);
  if (!card) throw new Error(`Card not found: ${key}`);
  const updated = computeNextReview(card, rating);
  await store.put(updated);
  return updated;
}

function wordMatchesCollections(word, collectionIds) {
  if (!collectionIds || collectionIds.length === 0) return true;
  const wordCollections = word.collection_ids || [];
  return collectionIds.some(id => wordCollections.includes(id));
}

async function buildWordMap(collectionIds) {
  const allWords = await getAllWords();
  return new Map(
    allWords
      .filter(word => wordMatchesCollections(word, collectionIds))
      .map(word => [word.id, word])
  );
}

export async function getDueCards(limit = 20, { collectionIds } = {}) {
  const now = nowISO();
  const [allDueCards, wordMap] = await Promise.all([
    store.getAll().then(cards => cards.filter(card => card.dueDate <= now)),
    buildWordMap(collectionIds),
  ]);

  const dueCards = allDueCards
    .filter(card => wordMap.has(card.wordId))
    .sort((a, b) => {
      if (a.repetitions === 0 && b.repetitions > 0) return 1;
      if (a.repetitions > 0 && b.repetitions === 0) return -1;
      if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
      return Math.random() - 0.5;
    });

  return dueCards.slice(0, limit).map(card => ({
    ...card,
    word: wordMap.get(card.wordId),
  }));
}

export async function getNextDueCard({ collectionIds } = {}) {
  const cards = await getDueCards(1, { collectionIds });
  return cards[0] || null;
}

export async function getStats({ collectionIds } = {}) {
  const now = nowISO();
  const [allCards, wordMap] = await Promise.all([
    store.getAll(),
    buildWordMap(collectionIds),
  ]);

  const cards = allCards.filter(c => wordMap.has(c.wordId));

  let due = 0, newCount = 0, learning = 0, mature = 0;
  for (const card of cards) {
    if (card.dueDate <= now) due++;
    if (card.repetitions === 0) newCount++;
    else if (card.interval >= 21) mature++;
    else learning++;
  }

  return { due, new: newCount, learning, mature, total: cards.length };
}

export async function deleteCardsForWord(wordId) {
  await Promise.all([
    store.remove(`${wordId}-en2zh`).catch(() => {}),
    store.remove(`${wordId}-zh2en`).catch(() => {}),
  ]);
}

export function useDependency() {
  const [version, setVersion] = React.useState(0);

  React.useEffect(() => {
    const handler = () => setVersion(v => v + 1);
    store.eventEmitter.subscribe('*', handler);
    return () => {
      store.eventEmitter.unsubscribe('*', handler);
    };
  }, []);

  return version;
}

export function useFlashcardStats(collectionIds) {
  const dbVersion = useDependency();
  const key = collectionIds ? collectionIds.join(',') : '';
  return useAsync(() => getStats({ collectionIds }), [dbVersion, key]);
}

export function useDueCards(limit = 20) {
  const dbVersion = useDependency();
  return useAsync(() => getDueCards(limit), [dbVersion, limit]);
}

export function formatInterval(days) {
  if (days === 0) return '<1d';
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}
