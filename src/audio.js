import { IndexedDBStore } from './database';
import { useAsync, useStoreDependency } from './util';
import { generateTts } from './gemini';
import audioManifest from './audio-manifest';
import React from 'react';

export function audioKey(pinyin) {
  const primary = pinyin.split('/').map(s => s.trim()).find(Boolean) || pinyin;
  return primary.toLowerCase().replace(/[^a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]/g, '');
}

const TONE_MAP = {
  'ā': 'a1', 'á': 'a2', 'ǎ': 'a3', 'à': 'a4',
  'ē': 'e1', 'é': 'e2', 'ě': 'e3', 'è': 'e4',
  'ī': 'i1', 'í': 'i2', 'ǐ': 'i3', 'ì': 'i4',
  'ō': 'o1', 'ó': 'o2', 'ǒ': 'o3', 'ò': 'o4',
  'ū': 'u1', 'ú': 'u2', 'ǔ': 'u3', 'ù': 'u4',
  'ǖ': 'v1', 'ǘ': 'v2', 'ǚ': 'v3', 'ǜ': 'v4', 'ü': 'v',
};

function toNumberedPinyin(text) {
  return text.replace(/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]/g, ch => TONE_MAP[ch] || ch);
}

// Whether a precomputed clip exists for this audio key. Manifest clips aren't in
// the audio_clips cache until first played, so checking the manifest is the only
// way to know audio is available without generating it.
export function isInManifest(text) {
  return Boolean(text && audioManifest[toNumberedPinyin(text)]);
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

export async function getAllAudio() {
  return store.getAll();
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

export async function getOrGenerateAudio(text, { signal, chineseText, force } = {}) {
  if (!force) {
    const cached = await getCachedAudio(text);
    if (cached) return cached;
  }

  const manifestUrl = !force && audioManifest[toNumberedPinyin(text)];
  if (manifestUrl) {
    const record = {
      text,
      url: manifestUrl,
      mimeType: 'audio/mpeg',
      durationMs: null,
      model: 'precomputed',
      voice: null,
      createdAt: Date.now(),
    };
    await store.put(record);
    return record;
  }

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
let currentListeners = null;

export function stopCurrentAudio() {
  currentListeners?.abort();
  currentListeners = null;
  if (currentAudioEl) {
    currentAudioEl.pause();
    currentAudioEl = null;
  }
  if (currentAudioUrl) {
    URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = null;
  }
}

// Passing an element reuses it instead of creating a new one per clip
function playUrl(url, { revoke = false, element } = {}) {
  stopCurrentAudio();

  const audio = element || new Audio();
  audio.src = url;
  currentAudioEl = audio;
  if (revoke) currentAudioUrl = url;

  const listeners = new AbortController();
  currentListeners = listeners;

  const cleanup = () => {
    listeners.abort();
    if (currentListeners === listeners) currentListeners = null;
    if (revoke && currentAudioUrl === url) {
      URL.revokeObjectURL(url);
      currentAudioUrl = null;
    }
    if (currentAudioEl === audio) currentAudioEl = null;
  };

  audio.addEventListener('ended', cleanup, { signal: listeners.signal });
  audio.addEventListener('error', cleanup, { signal: listeners.signal });

  return audio;
}

export function playBlob(blob, options) {
  return playUrl(URL.createObjectURL(blob), { ...options, revoke: true });
}

export function playRecord(record, options) {
  if (record.url) return playUrl(record.url, options);
  return playBlob(record.blob, options);
}

const silenceUrls = new Map();

function silenceUrl(ms) {
  if (!silenceUrls.has(ms)) {
    const rate = 8000;
    const samples = Math.round(rate * ms / 1000);
    const buffer = new ArrayBuffer(44 + samples);
    const view = new DataView(buffer);
    const writeString = (offset, str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    // 8kHz mono 8-bit PCM WAV
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate, true);
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true);
    writeString(36, 'data');
    view.setUint32(40, samples, true);
    // 8-bit PCM is unsigned, so 128 is the zero level
    new Uint8Array(buffer, 44).fill(128);
    silenceUrls.set(ms, URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' })));
  }
  return silenceUrls.get(ms);
}

// Mobile browsers only keep a backgrounded page running while media is
// playing, so pauses in a playback sequence are played as silent audio rather
// than waited out with timers.
export function playSilence(ms, options) {
  return playUrl(silenceUrl(ms), options);
}

export async function playAudio(text, { signal, onStart, chineseText, force } = {}) {
  const record = await getOrGenerateAudio(text, { signal, chineseText, force });
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

export const useDependency = () => useStoreDependency(store);

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

export function useCachedAudioKeys() {
  const dbVersion = useDependency();
  return useAsync(() => store.getAllKeys().then(keys => new Set(keys)), [dbVersion]);
}

export function useAllAudio() {
  const dbVersion = useDependency();
  return useAsync(() => getAllAudio(), [dbVersion]);
}
