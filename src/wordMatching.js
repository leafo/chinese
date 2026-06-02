// Word/sentence linking helpers shared by the sentence editor and importer.

function buildWordIndex(words, script) {
  const byText = new Map();
  let maxLen = 0;
  for (const word of words) {
    const text = word[script];
    if (!text) continue;
    if (!byText.has(text)) byText.set(text, word);
    if (text.length > maxLen) maxLen = text.length;
  }
  return { byText, maxLen };
}

// Forward maximum matching: walk the text and, at each position, take the
// longest word that matches before advancing, so nested words are skipped.
function matchWordIds(text, index) {
  const ids = [];
  if (!text) return ids;
  let i = 0;
  while (i < text.length) {
    let matched = false;
    for (let len = Math.min(index.maxLen, text.length - i); len >= 1; len--) {
      const word = index.byText.get(text.slice(i, i + len));
      if (word) {
        ids.push(word.id);
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) i += 1;
  }
  return ids;
}

export function findConnectedWordIds(words, traditional, simplified) {
  const ids = new Set();
  for (const id of matchWordIds(traditional, buildWordIndex(words, 'traditional'))) ids.add(id);
  for (const id of matchWordIds(simplified, buildWordIndex(words, 'simplified'))) ids.add(id);
  return [...ids];
}
