#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const COLLECTIONS_DIR = path.join(__dirname, '..', 'dist', 'collections');

function mimeToExt(mimeType) {
  if (mimeType === 'audio/wav' || mimeType === 'audio/x-wav') return '.wav';
  if (mimeType === 'audio/mpeg') return '.mp3';
  return '.bin';
}

function processCollection(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(raw);

  if (data.format !== 'chinese-collection-export') {
    console.log(`  Skipping ${path.basename(filePath)}: not a collection export`);
    return data;
  }

  const clips = data.audio_clips || [];
  const embeddedClips = clips.filter(c => c.blobBase64);

  if (embeddedClips.length === 0) {
    console.log(`  ${path.basename(filePath)}: no embedded audio, skipping`);
    return data;
  }

  const audioDir = path.join(COLLECTIONS_DIR, 'audio');
  fs.mkdirSync(audioDir, { recursive: true });

  let written = 0;
  const updatedClips = clips.map(clip => {
    if (!clip.blobBase64) return clip;

    const ext = mimeToExt(clip.blobMimeType || clip.mimeType);
    const safeText = clip.text.replace(/[/\\]/g, '_');
    const filename = `${safeText}${ext}`;
    const audioPath = path.join(audioDir, filename);

    fs.writeFileSync(audioPath, Buffer.from(clip.blobBase64, 'base64'));
    written++;

    const { blobBase64, blobMimeType, ...rest } = clip;
    return { ...rest, url: `collections/audio/${encodeURIComponent(filename)}` };
  });

  data.audio_clips = updatedClips;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');

  console.log(`  ${path.basename(filePath)}: extracted ${written} audio files`);
  return data;
}

function updateIndex(collections) {
  const index = collections.map(({ file, data }) => ({
    file,
    name: data.collection.name,
    notes: data.collection.notes || '',
    wordCount: (data.words || []).length,
  }));

  const indexPath = path.join(COLLECTIONS_DIR, 'index.json');
  const existing = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf-8') : '';
  const updated = JSON.stringify(index, null, 2) + '\n';

  if (existing === updated) {
    console.log('index.json: up to date');
  } else {
    fs.writeFileSync(indexPath, updated);
    console.log('index.json: updated');
  }
}

const files = fs.readdirSync(COLLECTIONS_DIR)
  .filter(f => f.startsWith('collection-') && f.endsWith('.json'))
  .sort();

if (files.length === 0) {
  console.log('No collection files found in dist/collections/');
  process.exit(0);
}

console.log(`Processing ${files.length} collection files...`);
const collections = files.map(file => ({
  file,
  data: processCollection(path.join(COLLECTIONS_DIR, file)),
}));
updateIndex(collections);
console.log('Done.');
