import { IndexedDBStore } from './database';
import { useAsync } from './util';
import React from 'react';

class Word {
  constructor(data) {
    Object.assign(this, data);
  }
}

const STORE_NAME = 'words';
export const store = new IndexedDBStore(STORE_NAME, Word);

const parseId = id => {
  const parsed = parseInt(id, 10);
  if (isNaN(parsed)) {
    throw new Error('Invalid ID: ID must be an integer');
  }
  return parsed;
};

const normalizeCollectionIds = (collectionIds = []) => {
  if (!Array.isArray(collectionIds)) {
    return [];
  }

  return [...new Set(
    collectionIds
      .map(id => parseInt(id, 10))
      .filter(id => !isNaN(id))
  )];
};

export const insertWord = async (word) => store.add({
  traditional: word.traditional || '',
  simplified: word.simplified || '',
  pinyin: word.pinyin || '',
  english: word.english || '',
  notes: word.notes || '',
  collection_ids: normalizeCollectionIds(word.collection_ids),
});

export const updateWord = async (word) => store.put({
  ...word,
  collection_ids: normalizeCollectionIds(word.collection_ids),
});
export const deleteWord = async (id) => store.remove(parseId(id));

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

export async function unassignCollectionFromWords(collectionId) {
  const parsedId = parseId(collectionId);
  const words = await getAllWords();
  const affectedWords = words.filter(word => (word.collection_ids || []).includes(parsedId));

  await Promise.all(affectedWords.map(word => updateWord({
    ...word,
    collection_ids: (word.collection_ids || []).filter(id => id !== parsedId),
  })));
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

export function useWord(wordId) {
  const dbVersion = useDependency();
  return useAsync(() => findWord(wordId), [wordId, dbVersion]);
}

export function useWords(limit = 50, offset = 0) {
  const dbVersion = useDependency();
  return useAsync(() => getWordsOrderedByIdDesc(limit, offset), [limit, offset, dbVersion]);
}
