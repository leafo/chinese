const PINYIN_PUNCT_CHARS = `.,!?;:'"‘’“”–—`;

function isPinyinPunctuation(char) {
  return PINYIN_PUNCT_CHARS.includes(char);
}

function stripPinyinPunctuation(text) {
  return text.replace(/[.,!?;:'"‘’“”–—]/g, '');
}

function normalizePinyin(text) {
  return stripPinyinPunctuation(text).toLowerCase().replace(/\s+/g, '');
}

function splitPinyinVariants(text) {
  return text.split('/').map(s => s.trim()).filter(Boolean);
}

function comparePinyinSingle(input, expected) {
  const expectedChars = stripPinyinPunctuation(expected).replace(/\s+/g, '').split('');
  const result = [];
  let ei = 0;
  let wrongCount = 0;

  for (const char of input) {
    if (char === ' ') {
      result.push({ char: ' ', correct: true });
      continue;
    }

    if (isPinyinPunctuation(char)) {
      result.push({ char, correct: true });
      continue;
    }

    const correct = ei < expectedChars.length && char.toLowerCase() === expectedChars[ei].toLowerCase();
    if (!correct) wrongCount++;
    result.push({ char, correct });
    ei++;
  }

  // Extra or missing characters count as wrong
  const inputLen = stripPinyinPunctuation(input).replace(/\s+/g, '').length;
  wrongCount += Math.abs(inputLen - expectedChars.length);

  return { result, wrongCount };
}

// Compare input pinyin against expected (which may contain "/" separated variants),
// returning per-character results for the best matching variant
export function comparePinyin(input, expected) {
  const variants = splitPinyinVariants(expected);
  let best = null;

  for (const variant of variants) {
    const comparison = comparePinyinSingle(input, variant);
    if (!best || comparison.wrongCount < best.wrongCount) {
      best = comparison;
    }
  }

  return best.result;
}

function normalizeEnglish(text) {
  return text
    .toLowerCase()
    .replace(/['"‘’“”]/g, '')
    .replace(/[.,!?;:–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripArticles(text) {
  return text.replace(/^(to|a|an|the)\s+/i, '');
}

function stripParenthesized(text) {
  return text.replace(/\s*\([^)]*\)/g, '').trim();
}

function flexibleMatch(input, expected) {
  const stripped = stripParenthesized(expected);
  const variants = stripped && stripped !== expected ? [expected, stripped] : [expected];
  return variants.some(exp =>
    input === exp || stripArticles(input) === stripArticles(exp)
  );
}

function splitDefinitions(text) {
  return stripParenthesized(text).split(/[,;/]/).map(s => s.trim()).filter(Boolean);
}

export function matchPinyin(input, expected) {
  const normalizedInput = normalizePinyin(input);
  return splitPinyinVariants(expected).some(v => normalizedInput === normalizePinyin(v));
}

export function matchEnglish(input, expected) {
  const normalizedInput = normalizeEnglish(input);
  if (!normalizedInput) return false;

  if (flexibleMatch(normalizedInput, normalizeEnglish(expected))) return true;

  const parts = splitDefinitions(expected);
  return parts.some(part => flexibleMatch(normalizedInput, normalizeEnglish(part)));
}
