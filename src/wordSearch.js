import { stripPinyinTones } from "./PinyinInput";

// Normalize a string for word filtering: lowercase, strip pinyin tone marks,
// and drop whitespace so "nihao", "ni hao", and "nǐ hǎo" all compare equal.
function normalizeForFilter(text) {
  return stripPinyinTones((text || '').toLowerCase()).replace(/\s+/g, '');
}

// Case-insensitive, tone- and space-agnostic substring match against a word's
// Chinese (simplified/traditional), pinyin, and English fields.
export function wordMatchesQuery(word, query) {
  const q = normalizeForFilter(query);
  if (!q) return true;
  return [word.simplified, word.traditional, word.english, word.pinyin]
    .some(field => normalizeForFilter(field).includes(q));
}
