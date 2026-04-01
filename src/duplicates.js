export function normalizeText(value) {
  return value?.trim() || '';
}

export function buildExistingWordsMap(existingWords) {
  const map = new Map();
  for (const word of existingWords) {
    const s = normalizeText(word.simplified);
    const t = normalizeText(word.traditional);
    if (s && !map.has(s)) map.set(s, word);
    if (t && !map.has(t)) map.set(t, word);
  }
  return map;
}

export function getPossibleDuplicate(word, existingWordsMap) {
  const simplified = normalizeText(word.simplified);
  const traditional = normalizeText(word.traditional);

  if (!simplified && !traditional) {
    return null;
  }

  return (simplified && existingWordsMap.get(simplified)) ||
    (traditional && existingWordsMap.get(traditional)) ||
    null;
}

export function formatDuplicateSummary(word) {
  const parts = [
    normalizeText(word.simplified) || normalizeText(word.traditional),
    normalizeText(word.pinyin),
    normalizeText(word.english),
  ].filter(Boolean);

  return parts.join(' | ');
}
