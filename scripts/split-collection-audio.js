#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const COLLECTIONS_DIR = path.join(__dirname, '..', 'dist', 'collections');

const TONE_MAP = {
  'ā': 'a1', 'á': 'a2', 'ǎ': 'a3', 'à': 'a4',
  'ē': 'e1', 'é': 'e2', 'ě': 'e3', 'è': 'e4',
  'ī': 'i1', 'í': 'i2', 'ǐ': 'i3', 'ì': 'i4',
  'ō': 'o1', 'ó': 'o2', 'ǒ': 'o3', 'ò': 'o4',
  'ū': 'u1', 'ú': 'u2', 'ǔ': 'u3', 'ù': 'u4',
  'ǖ': 'v1', 'ǘ': 'v2', 'ǚ': 'v3', 'ǜ': 'v4', 'ü': 'v',
};

function toNumberedPinyin(pinyin) {
  return pinyin.replace(/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]/g, ch => TONE_MAP[ch] || ch);
}

function convertToMp3(wavPath) {
  const mp3Path = wavPath.replace(/\.wav$/, '.mp3');
  execFileSync('ffmpeg', ['-y', '-i', wavPath, '-q:a', '6', mp3Path], { stdio: 'pipe' });
  fs.unlinkSync(wavPath);
  return mp3Path;
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

    const safeText = toNumberedPinyin(clip.text).replace(/[^a-zA-Z0-9]/g, '');
    const wavPath = path.join(audioDir, `${safeText}.wav`);
    fs.writeFileSync(wavPath, Buffer.from(clip.blobBase64, 'base64'));

    const mp3Path = convertToMp3(wavPath);
    const filename = path.basename(mp3Path);
    written++;

    const { blobBase64, blobMimeType, ...rest } = clip;
    return { ...rest, mimeType: 'audio/mpeg', url: `collections/audio/${encodeURIComponent(filename)}` };
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
