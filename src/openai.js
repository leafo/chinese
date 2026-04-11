import { config } from './config.js';
import { sampleWords, formatWordList, generateSentencesPrompt } from './prompts.js';

const OPENAI_CHAT_MODEL = 'gpt-5.4-mini';
const OPENAI_TTS_MODEL = 'gpt-4o-mini-tts';
const OPENAI_TTS_VOICE = 'coral';

async function getApiKey() {
  const apiKey = await config.getValue("openai_api_key");

  if (!apiKey) {
    throw new Error('OpenAI API key is not set. Please add it in Settings.');
  }

  return apiKey;
}

export async function generateTts(text, { signal } = {}) {
  const apiKey = await getApiKey();

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_TTS_MODEL,
      input: text,
      voice: OPENAI_TTS_VOICE,
      instructions: 'Read slowly in proper chinese pronunciation appropriate for a learner',
      response_format: 'mp3',
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    let message;
    try {
      message = JSON.parse(errorText)?.error?.message || errorText;
    } catch {
      message = errorText;
    }
    throw new Error(`OpenAI TTS failed: ${message}`);
  }

  const blob = await response.blob();

  return {
    blob,
    mimeType: 'audio/mpeg',
    durationMs: null,
    model: OPENAI_TTS_MODEL,
    voice: OPENAI_TTS_VOICE,
  };
}

export async function generateSentences(words, { count = 10, objectives, additionalInstructions, signal, onChunk } = {}) {
  if (!words || words.length === 0) {
    throw new Error('At least one word is required to generate sentences');
  }

  const wordList = formatWordList(sampleWords(words));
  const prompt = generateSentencesPrompt(wordList, { count, objectives, additionalInstructions })
    + `\n\nRespond with a JSON object: { "sentences": [{ "simplified": "...", "traditional": "...", "pinyin": "...", "english": "...", "words_used": ["..."] }] }`;

  const apiKey = await getApiKey();
  const body = {
    model: OPENAI_CHAT_MODEL,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    stream: !!onChunk,
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    let message;
    try {
      message = JSON.parse(errorText)?.error?.message || errorText;
    } catch {
      message = errorText;
    }
    throw new Error(`OpenAI sentence generation failed: ${message}`);
  }

  if (!onChunk) {
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('Unexpected response format from OpenAI API');
    return JSON.parse(text);
  }

  // Streaming
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    let newlineIdx;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);

      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') break;

      const chunk = JSON.parse(payload);
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        fullText += delta;
        onChunk(delta, fullText);
      }
    }

    if (done) break;
  }

  return JSON.parse(fullText);
}
