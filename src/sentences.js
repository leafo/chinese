import { IndexedDBStore } from './database';
import { useAsync, parseId, normalizeIds, useStoreDependency } from './util';

class Sentence {
  constructor(data) {
    Object.assign(this, data);
  }
}

const STORE_NAME = 'sentences';
export const store = new IndexedDBStore(STORE_NAME, Sentence);

export const insertSentence = async (sentence) => store.add({
  traditional: sentence.traditional || '',
  simplified: sentence.simplified || '',
  pinyin: sentence.pinyin || '',
  english: sentence.english || '',
  notes: sentence.notes || '',
  collection_ids: normalizeIds(sentence.collection_ids),
  word_ids: normalizeIds(sentence.word_ids),
});

export const updateSentence = async (sentence) => store.put({
  ...sentence,
  collection_ids: normalizeIds(sentence.collection_ids),
  word_ids: normalizeIds(sentence.word_ids),
});

export const deleteSentence = async (id) => store.remove(parseId(id));

export const findSentence = async (id) => {
  const result = await store.get(parseId(id));
  if (result != null) return result;
  throw new Error(`Failed to find sentence by ID ${id}`);
};

export async function getSentencesOrderedByIdDesc(limit, offset) {
  return store.queryOrderedDesc(limit, offset);
}

export async function getAllSentences() {
  return store.getAll();
}

export async function unassignCollectionFromSentences(collectionId) {
  const parsedId = parseId(collectionId);
  const sentences = await getAllSentences();
  const affected = sentences.filter(s => (s.collection_ids || []).includes(parsedId));
  if (affected.length === 0) return;

  const updated = affected.map(sentence => ({
    ...sentence,
    collection_ids: normalizeIds((sentence.collection_ids || []).filter(id => id !== parsedId)),
    word_ids: normalizeIds(sentence.word_ids),
  }));

  await store.putMany(updated);
}

export async function unassignWordFromSentences(wordId) {
  const parsedId = parseId(wordId);
  const sentences = await getAllSentences();
  const affected = sentences.filter(s => (s.word_ids || []).includes(parsedId));
  if (affected.length === 0) return;

  const updated = affected.map(sentence => ({
    ...sentence,
    collection_ids: normalizeIds(sentence.collection_ids),
    word_ids: normalizeIds((sentence.word_ids || []).filter(id => id !== parsedId)),
  }));

  await store.putMany(updated);
}

export const useDependency = () => useStoreDependency(store);

export function useSentence(sentenceId) {
  const dbVersion = useDependency();
  return useAsync(() => findSentence(sentenceId), [sentenceId, dbVersion]);
}

export function useSentences(limit = 100, offset = 0) {
  const dbVersion = useDependency();
  return useAsync(() => getSentencesOrderedByIdDesc(limit, offset), [limit, offset, dbVersion]);
}

export function useSentencesForWord(wordId) {
  const dbVersion = useDependency();
  return useAsync(async () => {
    const parsedId = parseId(wordId);
    const sentences = await getAllSentences();
    return sentences.filter(s => (s.word_ids || []).includes(parsedId));
  }, [wordId, dbVersion]);
}

export function useAllSentences() {
  const dbVersion = useDependency();
  return useAsync(() => getAllSentences(), [dbVersion]);
}
