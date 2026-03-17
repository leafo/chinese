import { config } from './config.js';

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
