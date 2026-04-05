function normalizePinyin(text) {
  return text.toLowerCase().replace(/\s+/g, '');
}

function normalizeEnglish(text) {
  return text.toLowerCase().trim();
}

function splitDefinitions(text) {
  return text.split(/[,;]/).map(s => s.trim()).filter(Boolean);
}

export function matchPinyin(input, expected) {
  return normalizePinyin(input) === normalizePinyin(expected);
}

export function matchEnglish(input, expected) {
  const normalizedInput = normalizeEnglish(input);
  if (!normalizedInput) return false;

  if (normalizedInput === normalizeEnglish(expected)) return true;

  const parts = splitDefinitions(expected);
  return parts.some(part => normalizedInput === normalizeEnglish(part));
}
