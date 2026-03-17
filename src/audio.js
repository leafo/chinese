import { IndexedDBStore } from './database';
import { useAsync } from './util';
import { generateTts } from './gemini';
import React from 'react';

const STORE_NAME = 'audio_clips';
export const store = new IndexedDBStore(STORE_NAME);

export async function getCachedAudio(text) {
  return store.get(text);
}

export async function cacheAudio(text, blob, metadata) {
  return store.put({
    text,
    blob,
    mimeType: metadata.mimeType,
    durationMs: metadata.durationMs || null,
    model: metadata.model,
    voice: metadata.voice,
    createdAt: Date.now(),
  });
}

export async function getOrGenerateAudio(text, { signal } = {}) {
  const cached = await getCachedAudio(text);
  if (cached) return cached;

  const result = await generateTts(text, { signal });

  const record = {
    text,
    blob: result.blob,
    mimeType: result.mimeType,
    durationMs: result.durationMs || null,
    model: result.model,
    voice: result.voice,
    createdAt: Date.now(),
  };

  await store.put(record);
  return record;
}

export async function generateAudioForWords(words, { onProgress, signal } = {}) {
  let completed = 0;
  const total = words.length;

  for (const word of words) {
    if (signal?.aborted) break;

    const text = word.simplified || word.traditional;
    if (!text) {
      completed++;
      if (onProgress) onProgress(completed, total, text);
      continue;
    }

    const cached = await getCachedAudio(text);
    if (!cached) {
      await getOrGenerateAudio(text, { signal });
    }

    completed++;
    if (onProgress) onProgress(completed, total, text);
  }
}

let currentAudioEl = null;

export async function playAudio(text, { signal } = {}) {
  if (currentAudioEl) {
    currentAudioEl.pause();
    currentAudioEl = null;
  }

  const record = await getOrGenerateAudio(text, { signal });
  const url = URL.createObjectURL(record.blob);
  const audio = new Audio(url);
  currentAudioEl = audio;

  audio.addEventListener('ended', () => {
    URL.revokeObjectURL(url);
    if (currentAudioEl === audio) currentAudioEl = null;
  }, { once: true });

  audio.addEventListener('error', () => {
    URL.revokeObjectURL(url);
    if (currentAudioEl === audio) currentAudioEl = null;
  }, { once: true });

  await audio.play();
  return audio;
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

export function useAudio(text) {
  const [version, setVersion] = React.useState(0);

  React.useEffect(() => {
    if (!text) return;
    const handler = () => setVersion(v => v + 1);
    store.eventEmitter.subscribe(text, handler);
    return () => {
      store.eventEmitter.unsubscribe(text, handler);
    };
  }, [text]);

  return useAsync(() => text ? getCachedAudio(text) : Promise.resolve(null), [text, version]);
}
