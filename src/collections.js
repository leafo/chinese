import { IndexedDBStore } from './database';
import { useAsync, parseId, useStoreDependency } from './util';
import { unassignCollectionFromWords } from './words';
import { unassignCollectionFromSentences } from './sentences';

class Collection {
  constructor(data) {
    Object.assign(this, data);
  }
}

const STORE_NAME = 'collections';
export const store = new IndexedDBStore(STORE_NAME, Collection);

export const insertCollection = async (collection) => store.add({
  name: collection.name || '',
  notes: collection.notes || '',
  objectives: collection.objectives || '',
});

export const updateCollection = async (collection) => store.put(collection);
export const deleteCollection = async (id) => {
  const parsedId = parseId(id);
  await unassignCollectionFromWords(parsedId);
  await unassignCollectionFromSentences(parsedId);
  return store.remove(parsedId);
};

export const findCollection = async (id) => {
  const result = await store.get(parseId(id));
  if (result != null) return result;
  throw new Error(`Failed to find collection by ID ${id}`);
};

export async function getAllCollections() {
  return store.getAll();
}

export const useDependency = () => useStoreDependency(store);

export function useCollections() {
  const dbVersion = useDependency();
  return useAsync(() => getAllCollections(), [dbVersion]);
}

export function useCollection(collectionId) {
  const dbVersion = useDependency();
  return useAsync(() => findCollection(collectionId), [collectionId, dbVersion]);
}
