export function sampleWords(words, max = 80) {
  if (words.length <= max) return words;
  return [...words].sort(() => Math.random() - 0.5).slice(0, max);
}

export function formatWordList(words) {
  return words
    .map(w => `${w.simplified || w.traditional} (${w.pinyin}) - ${w.english}`)
    .join('\n');
}

export function generateSentencesPrompt(wordList, { count = 10, objectives, additionalInstructions, imageCount = 0 } = {}) {
  return `Generate ${count} Chinese sentences for a language learner using words from this vocabulary list. Each sentence should use 2-4 vocabulary words where natural. Vary complexity and topics.

Vocabulary:
${wordList}

Requirements:
- Each sentence must use at least 1 vocabulary word from the list above
- Vary grammar patterns and sentence structures
- Intermediate difficulty level
- Provide pinyin with tone marks (e.g. nǐ hǎo), not tone numbers
- In words_used, list only the simplified Chinese forms of vocabulary words from the provided list that appear in the sentence${objectives ? `

Objectives for this vocabulary set:
${objectives}

Use these objectives to guide the topics and style of the generated sentences.` : ''}${additionalInstructions ? `

Additional instructions:
${additionalInstructions}` : ''}${imageCount > 0 ? `

${imageCount > 1 ? `${imageCount} reference images are` : 'A reference image is'} attached. Use ${imageCount > 1 ? 'them' : 'it'} as context for the sentences: describe or refer to what is shown, or follow any instructions in the image, while still using the vocabulary words above.` : ''}`;
}
