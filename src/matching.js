function normalizePinyin(text) {
  return text.toLowerCase().replace(/\s+/g, '');
}

// Compare input pinyin against expected, returning per-character results
// for the input string. Each entry: { char, correct: bool }
export function comparePinyin(input, expected) {
  const expectedChars = expected.replace(/\s+/g, '').split('');
  const result = [];
  let ei = 0;

  for (const char of input) {
    if (char === ' ') {
      result.push({ char: ' ', correct: true });
      continue;
    }

    const correct = ei < expectedChars.length && char.toLowerCase() === expectedChars[ei].toLowerCase();
    result.push({ char, correct });
    ei++;
  }

  return result;
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
