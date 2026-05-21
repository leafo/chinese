import { IndexedDBStore } from './database';
import { useAsync, parseId, normalizeIds, useStoreDependency } from './util';
import { deleteCardsForWord } from './flashcardData';
import { unassignWordFromSentences } from './sentences';

class Word {
  constructor(data) {
    Object.assign(this, data);
  }
}

const STORE_NAME = 'words';
export const store = new IndexedDBStore(STORE_NAME, Word);

export const insertWord = async (word) => store.add({
  traditional: word.traditional || '',
  simplified: word.simplified || '',
  pinyin: word.pinyin || '',
  english: word.english || '',
  notes: word.notes || '',
  collection_ids: normalizeIds(word.collection_ids),
});

export const updateWord = async (word) => store.put({
  ...word,
  collection_ids: normalizeIds(word.collection_ids),
});
export const deleteWord = async (id) => {
  const parsedId = parseId(id);
  await deleteCardsForWord(parsedId);
  await unassignWordFromSentences(parsedId);
  return store.remove(parsedId);
};

export const findWord = async (id) => {
  const result = await store.get(parseId(id));
  if (result != null) return result;
  throw new Error(`Failed to find word by ID ${id}`);
};

export async function getWordsOrderedByIdDesc(limit, offset) {
  return store.queryOrderedDesc(limit, offset);
}

export async function getAllWords() {
  return store.getAll();
}

export async function bulkUpdateCollections(wordIds, collectionId, action) {
  const parsedCollectionId = parseId(collectionId);
  const words = await getAllWords();
  const targetWords = words.filter(w => wordIds.includes(w.id));
  if (targetWords.length === 0) return;

  const updated = targetWords.map(word => {
    const currentIds = word.collection_ids || [];
    const nextIds = action === 'add'
      ? [...currentIds, parsedCollectionId]
      : currentIds.filter(id => id !== parsedCollectionId);
    return { ...word, collection_ids: normalizeIds(nextIds) };
  });

  await store.putMany(updated);
}

export async function unassignCollectionFromWords(collectionId) {
  const parsedId = parseId(collectionId);
  const words = await getAllWords();
  const affectedIds = words
    .filter(w => (w.collection_ids || []).includes(parsedId))
    .map(w => w.id);
  if (affectedIds.length === 0) return;
  await bulkUpdateCollections(affectedIds, collectionId, 'remove');
}

export const useDependency = () => useStoreDependency(store);

export function useWord(wordId) {
  const dbVersion = useDependency();
  return useAsync(() => findWord(wordId), [wordId, dbVersion]);
}

export function useWords(limit = 50, offset = 0) {
  const dbVersion = useDependency();
  return useAsync(() => getWordsOrderedByIdDesc(limit, offset), [limit, offset, dbVersion]);
}

export function useAllWords() {
  const dbVersion = useDependency();
  return useAsync(() => getAllWords(), [dbVersion]);
}
