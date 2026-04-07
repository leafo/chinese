import { IndexedDBStore } from './database';
import { useAsync } from './util';
import { generateTts } from './gemini';
import React from 'react';

export function audioKey(pinyin) {
  const primary = pinyin.split('/').map(s => s.trim()).find(Boolean) || pinyin;
  return primary.toLowerCase().replace(/\s+/g, '');
}

const STORE_NAME = 'audio_clips';
const BULK_AUDIO_CONCURRENCY = 10;
export const store = new IndexedDBStore(STORE_NAME);

export async function getCachedAudio(text) {
  return store.get(text);
}

export async function deleteCachedAudio(text) {
  return store.remove(text);
}

export async function getAudioStats() {
  const records = await store.getAll();
  const totalBytes = records.reduce((sum, record) => sum + (record.blob?.size || 0), 0);

  return {
    clipCount: records.length,
    totalBytes,
  };
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

export async function getOrGenerateAudio(text, { signal, chineseText } = {}) {
  const cached = await getCachedAudio(text);
  if (cached) return cached;

  const result = await generateTts(chineseText || text, { signal });

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

export async function generateAudioForWords(words, { onProgress, signal, getText } = {}) {
  const total = words.length;
  let completed = 0;
  let succeeded = 0;
  let failed = 0;
  let nextIndex = 0;
  const failures = [];
  const activeJobs = new Map();

  if (total === 0) {
    return { completed: 0, succeeded: 0, failed: 0, total: 0, failures };
  }

  const emitProgress = (extra = {}) => {
    if (!onProgress) {
      return;
    }

    onProgress({
      completed,
      succeeded,
      failed,
      total,
      activeJobs: Array.from(activeJobs.values()),
      failures: [...failures],
      ...extra,
    });
  };

  const worker = async () => {
    while (true) {
      if (signal?.aborted) {
        return;
      }

      const index = nextIndex++;
      if (index >= total) {
        return;
      }

      const word = words[index];
      const text = audioKey(word.pinyin);
      const chineseText = getText ? getText(word) : (word.simplified || word.traditional);
      let itemError = null;
      const jobLabel = chineseText || text || `(word #${index + 1}: no text)`;

      activeJobs.set(index, jobLabel);
      emitProgress({ current: jobLabel });

      try {
        if (text) {
          const cached = await getCachedAudio(text);
          if (!cached) {
            await getOrGenerateAudio(text, { signal, chineseText });
          }
        }
      } catch (err) {
        if (signal?.aborted || err?.name === 'AbortError') {
          activeJobs.delete(index);
          return;
        }

        itemError = err;
        failed++;
        failures.push({
          text,
          error: err.message || String(err),
        });
        console.error(`Bulk audio generation failed for "${text || '(empty text)'}":`, err);
      }

      if (!itemError) {
        succeeded++;
      }

      if (signal?.aborted) {
        activeJobs.delete(index);
        return;
      }

      activeJobs.delete(index);
      completed++;
      emitProgress({
        current: jobLabel,
        lastError: itemError?.message || null,
      });
    }
  };

  const workerCount = Math.min(BULK_AUDIO_CONCURRENCY, total);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return { completed, succeeded, failed, total, failures };
}

let currentAudioEl = null;
let currentAudioUrl = null;

export function stopCurrentAudio() {
  if (currentAudioEl) {
    currentAudioEl.pause();
    currentAudioEl = null;
  }
  if (currentAudioUrl) {
    URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = null;
  }
}

function playUrl(url, { revoke = false } = {}) {
  stopCurrentAudio();

  const audio = new Audio(url);
  currentAudioEl = audio;
  if (revoke) currentAudioUrl = url;

  const cleanup = () => {
    if (revoke && currentAudioUrl === url) {
      URL.revokeObjectURL(url);
      currentAudioUrl = null;
    }
    if (currentAudioEl === audio) currentAudioEl = null;
  };

  audio.addEventListener('ended', cleanup, { once: true });
  audio.addEventListener('error', cleanup, { once: true });

  return audio;
}

export function playBlob(blob) {
  return playUrl(URL.createObjectURL(blob), { revoke: true });
}

export function playRecord(record) {
  if (record.url) return playUrl(record.url);
  return playBlob(record.blob);
}

export async function playAudio(text, { signal, onStart, chineseText } = {}) {
  const record = await getOrGenerateAudio(text, { signal, chineseText });
  const audio = playRecord(record);
  onStart?.(audio);
  await audio.play();
  return audio;
}

export async function playOpenAiTts(text, { onStart } = {}) {
  const { generateTts } = await import('./openai.js');
  const result = await generateTts(text);
  const audio = playBlob(result.blob);
  onStart?.(audio);
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

export function useAudioStats() {
  const dbVersion = useDependency();
  return useAsync(() => getAudioStats(), [dbVersion]);
}
