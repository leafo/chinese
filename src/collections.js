import { IndexedDBStore } from './database';
import { useAsync } from './util';
import React from 'react';

class Collection {
  constructor(data) {
    Object.assign(this, data);
  }
}

const STORE_NAME = 'collections';
export const store = new IndexedDBStore(STORE_NAME, Collection);

const parseId = id => {
  const parsed = parseInt(id, 10);
  if (isNaN(parsed)) {
    throw new Error('Invalid ID: ID must be an integer');
  }
  return parsed;
};

export const insertCollection = async (collection) => store.add({
  name: collection.name || '',
});

export const updateCollection = async (collection) => store.put(collection);
export const deleteCollection = async (id) => store.remove(parseId(id));

export const findCollection = async (id) => {
  const result = await store.get(parseId(id));
  if (result != null) return result;
  throw new Error(`Failed to find collection by ID ${id}`);
};

export async function getAllCollections() {
  return store.getAll();
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

export function useCollections() {
  const dbVersion = useDependency();
  return useAsync(() => getAllCollections(), [dbVersion]);
}

export function useCollection(collectionId) {
  const dbVersion = useDependency();
  return useAsync(() => findCollection(collectionId), [collectionId, dbVersion]);
}
