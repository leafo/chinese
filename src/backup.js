import { store as wordsStore } from './words';
import { store as collectionsStore } from './collections';
import { config } from './config';
import { store as audioStore } from './audio';
import { store as flashcardStore } from './flashcardData';
import { resetAll } from './database';

const API_KEY_FIELDS = ['gemini_api_key', 'openai_api_key'];

async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType || 'application/octet-stream' });
}

function serializeAudioClip(clip) {
  const { blob, ...rest } = clip;
  if (blob instanceof Blob) {
    return blobToBase64(blob).then(data => ({
      ...rest,
      blobBase64: data,
      blobMimeType: blob.type || clip.mimeType || 'audio/wav',
    }));
  }
  return { ...clip };
}

function deserializeAudioClip(clip) {
  if (typeof clip.blobBase64 === 'string') {
    const { blobBase64, blobMimeType, ...rest } = clip;
    return { ...rest, blob: base64ToBlob(blobBase64, blobMimeType || clip.mimeType) };
  }
  // Legacy format: blob field was base64 string with _blobMimeType
  if (typeof clip.blob === 'string') {
    const { _blobMimeType, ...rest } = clip;
    return { ...rest, blob: base64ToBlob(clip.blob, _blobMimeType || clip.mimeType) };
  }
  return clip;
}

export async function exportDatabase({ includeAudio = false } = {}) {
  const [words, collections, configData, audioClips, flashcardReviews] = await Promise.all([
    wordsStore.getAll(),
    collectionsStore.getAll(),
    config.getAll(),
    includeAudio ? audioStore.getAll() : Promise.resolve(null),
    flashcardStore.getAll(),
  ]);

  const filteredConfig = configData.filter(entry => !API_KEY_FIELDS.includes(entry.key));

  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    stores: {
      config: filteredConfig,
      words,
      collections,
      flashcard_reviews: flashcardReviews,
    },
  };

  if (includeAudio && audioClips) {
    data.stores.audio_clips = await Promise.all(audioClips.map(serializeAudioClip));
  }

  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const date = new Date().toISOString().slice(0, 10);
  const filename = `chinese-backup-${date}.json`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function importDatabase(jsonString) {
  let data;
  try {
    data = JSON.parse(jsonString);
  } catch {
    throw new Error('Invalid JSON file');
  }

  if (!data || typeof data !== 'object' || data.version !== 1 || !data.stores) {
    throw new Error('Invalid backup file format');
  }

  const { stores } = data;

  const db = await resetAll();

  const storesToWrite = [
    ['config', stores.config],
    ['words', stores.words],
    ['collections', stores.collections],
    ['audio_clips', stores.audio_clips],
    ['flashcard_reviews', stores.flashcard_reviews],
  ].filter(([, records]) => records?.length);

  if (storesToWrite.length === 0) {
    return { words: 0, collections: 0, config: 0, audioClips: 0 };
  }

  const tx = db.transaction(storesToWrite.map(([name]) => name), 'readwrite');

  for (const [name, records] of storesToWrite) {
    const objectStore = tx.objectStore(name);
    for (const record of records) {
      objectStore.put(name === 'audio_clips' ? deserializeAudioClip(record) : record);
    }
  }

  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(new Error('Failed to write data: ' + tx.error));
  });

  return {
    words: stores.words?.length || 0,
    collections: stores.collections?.length || 0,
    config: stores.config?.length || 0,
    audioClips: stores.audio_clips?.length || 0,
    flashcardReviews: stores.flashcard_reviews?.length || 0,
  };
}
