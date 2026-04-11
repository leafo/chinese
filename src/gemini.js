import { config } from './config.js';
import { sampleWords, formatWordList, generateSentencesPrompt } from './prompts.js';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_MODEL = 'gemini-flash-latest';
const GEMINI_TTS_MODEL = 'gemini-2.5-pro-preview-tts';
const GEMINI_TTS_VOICE = 'Zephyr';

const WORDS_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    words: {
      type: "array",
      items: {
        type: "object",
        properties: {
          traditional: {
            type: "string",
            description: "The word in traditional Chinese characters"
          },
          simplified: {
            type: "string",
            description: "The word in simplified Chinese characters"
          },
          pinyin: {
            type: "string",
            description: "The pinyin romanization with tone marks (e.g. nǐ hǎo, not ni3 hao3)"
          },
          english: {
            type: "string",
            description: "The English definition or translation"
          },
          notes: {
            type: "string",
            description: "Any additional context, usage notes, or grammar notes visible in the image"
          }
        },
        required: ["simplified", "pinyin", "english"]
      }
    }
  },
  required: ["words"]
};

const COMPLETE_WORD_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    traditional: {
      type: "string",
      description: "The word in traditional Chinese characters"
    },
    simplified: {
      type: "string",
      description: "The word in simplified Chinese characters"
    },
    pinyin: {
      type: "string",
      description: "The pinyin romanization with tone marks (e.g. nǐ hǎo, not ni3 hao3)"
    },
    english: {
      type: "string",
      description: "The English definition or translation"
    }
  },
  required: ["traditional", "simplified", "pinyin", "english"]
};

async function getApiKey() {
  const apiKey = await config.getValue("gemini_api_key");

  if (!apiKey) {
    throw new Error('Gemini API key is not set. Please add it in Settings.');
  }

  return apiKey;
}

function getResponseText(data) {
  return data?.candidates?.[0]?.content?.parts
    ?.map(part => part.text || '')
    .join('') || '';
}

function getFinishReason(data) {
  return data?.candidates?.[0]?.finishReason || null;
}

async function getErrorMessage(response) {
  const text = await response.text();
  if (!text) {
    return `Gemini API request failed with status ${response.status}`;
  }

  try {
    const errorData = JSON.parse(text);
    return errorData?.error?.message || text;
  } catch {
    return text;
  }
}

async function geminiFetch(endpoint, requestBody, { signal, model } = {}) {
  const apiKey = await getApiKey();
  const response = await fetch(`${GEMINI_API_BASE}/models/${model || GEMINI_MODEL}:${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(requestBody),
    signal,
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  return response;
}

async function geminiRequest(requestBody, { signal } = {}) {
  const response = await geminiFetch('generateContent', requestBody, { signal });
  const data = await response.json();
  const text = getResponseText(data);

  if (!text) {
    throw new Error("Unexpected response format from Gemini API");
  }

  const finishReason = getFinishReason(data);
  if (finishReason && finishReason !== 'STOP') {
    throw new Error(`Gemini did not finish with STOP reason: ${finishReason}`);
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Failed to parse JSON response from Gemini: ${e.message}`);
  }
}

function extractSseEvents(buffer) {
  const events = [];
  let separatorIndex;

  while ((separatorIndex = buffer.indexOf('\n\n')) !== -1) {
    events.push(buffer.slice(0, separatorIndex));
    buffer = buffer.slice(separatorIndex + 2);
  }

  return [events, buffer];
}

async function geminiStreamRequest(requestBody, { onChunk, signal } = {}) {
  const response = await geminiFetch('streamGenerateContent?alt=sse', requestBody, { signal });

  if (!response.body) {
    throw new Error('Gemini streaming response did not include a readable body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let finishReason = null;

  const processEvent = (eventBlock) => {
    const dataLines = [];

    for (const rawLine of eventBlock.split('\n')) {
      const line = rawLine.trimEnd();
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (!dataLines.length) {
      return;
    }

    const payload = dataLines.join('\n');
    if (!payload || payload === '[DONE]') {
      return;
    }

    const data = JSON.parse(payload);
    if (data.error) {
      throw new Error(data.error.message || 'Gemini stream returned an error');
    }

    const chunkText = getResponseText(data);
    if (chunkText) {
      fullText += chunkText;
      if (onChunk) {
        onChunk(chunkText, fullText);
      }
    }

    const chunkFinishReason = getFinishReason(data);
    if (chunkFinishReason) {
      finishReason = chunkFinishReason;
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    buffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    const [events, remainder] = extractSseEvents(buffer);
    buffer = remainder;
    events.forEach(processEvent);

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    processEvent(buffer);
  }

  if (!fullText) {
    throw new Error('Gemini streaming response did not include any JSON text');
  }

  if (finishReason && finishReason !== 'STOP') {
    throw new Error(`Gemini did not finish with STOP reason: ${finishReason}`);
  }

  try {
    return JSON.parse(fullText);
  } catch (e) {
    throw new Error(`Failed to parse streamed JSON response from Gemini: ${e.message}`);
  }
}

export async function completeWord(fields) {
  const provided = [];
  if (fields.traditional) provided.push(`Traditional: ${fields.traditional}`);
  if (fields.simplified) provided.push(`Simplified: ${fields.simplified}`);
  if (fields.pinyin) provided.push(`Pinyin: ${fields.pinyin}`);
  if (fields.english) provided.push(`English: ${fields.english}`);
  if (fields.notes) provided.push(`Notes: ${fields.notes}`);

  if (provided.length === 0) {
    throw new Error('At least one field must be provided');
  }

  const requestBody = {
    contents: [
      {
        parts: [
          {
            text: `I have a Chinese vocabulary word with the following information:\n${provided.join('\n')}\n\nPlease complete all fields for this word. Provide pinyin with tone marks (e.g. nǐhǎo), not tone numbers. Do not insert spaces between syllables within a single word — only use spaces to separate distinct words in a multi-word phrase.`
          }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: COMPLETE_WORD_RESPONSE_SCHEMA
    }
  };

  return geminiRequest(requestBody);
}

function buildOcrWordsPrompt(imageCount, additionalInstructions) {
  const multi = imageCount > 1;
  let prompt = `Extract all Chinese vocabulary words from ${multi ? 'these images' : 'this image'}. ${multi ? 'These are likely textbook pages or word lists' : 'This is likely a textbook page or word list'}.

For each word found:
- Provide both traditional and simplified Chinese characters
- Provide pinyin with tone marks (e.g. nǐ hǎo), not tone numbers
- Provide the English definition
- Include any usage notes, example sentences, or grammar notes if visible

Extract every word you can identify ${multi ? 'across all images' : 'in the image'}. If a word appears with its definition, include that definition. If you can see both traditional and simplified forms, include both.${multi ? ' Return a single combined words array for the full set of images.' : ''}`;

  const trimmedInstructions = additionalInstructions?.trim();
  if (trimmedInstructions) {
    prompt += `\n\nAdditional instructions:\n${trimmedInstructions}`;
  }

  return prompt;
}

function buildOcrWordsRequestBody(images, additionalInstructions) {
  return {
    contents: [
      {
        parts: [
          {
            text: buildOcrWordsPrompt(images.length, additionalInstructions)
          },
          ...images.map(({ base64Data, mimeType }) => ({
            inlineData: {
              mimeType,
              data: base64Data
            }
          }))
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: WORDS_RESPONSE_SCHEMA
    }
  };
}

async function encodeFileAsInlineData(file) {
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  return {
    base64Data: base64.split(',')[1],
    mimeType: file.type,
  };
}

export async function ocrWords(files, options = {}) {
  const fileList = Array.isArray(files) ? files : [files];
  if (!fileList.length) {
    throw new Error('At least one image is required for OCR');
  }

  const images = await Promise.all(fileList.map(encodeFileAsInlineData));
  const { onChunk, signal, additionalInstructions } = options;
  const requestBody = buildOcrWordsRequestBody(images, additionalInstructions);

  if (onChunk) {
    return geminiStreamRequest(requestBody, { onChunk, signal });
  }

  return geminiRequest(requestBody, { signal });
}

export async function generateWords(topic, { count, instructions, signal, onChunk } = {}) {
  if (!topic || !topic.trim()) {
    throw new Error('A topic is required to generate words');
  }

  const hasCount = Number.isFinite(count);
  let prompt = hasCount
    ? `Generate a list of approximately ${count} Chinese vocabulary words for the topic: "${topic}".`
    : `Generate a Chinese vocabulary list for the topic: "${topic}".`;

  prompt += `

For each word provide:
- Simplified Chinese characters
- Traditional Chinese characters
- Pinyin with tone marks (e.g. nǐ hǎo), not tone numbers
- English definition
- Brief usage notes if helpful

Generate a diverse and useful vocabulary list appropriate for an intermediate Chinese learner. Include a mix of nouns, verbs, adjectives, and other word types as appropriate for the topic.`;

  if (instructions?.trim()) {
    prompt += `\n\nAdditional instructions:\n${instructions.trim()}`;
  }

  const requestBody = {
    contents: [
      {
        parts: [
          { text: prompt }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: WORDS_RESPONSE_SCHEMA
    }
  };

  if (onChunk) {
    return geminiStreamRequest(requestBody, { onChunk, signal });
  }

  return geminiRequest(requestBody, { signal });
}

const GENERATE_SENTENCES_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    sentences: {
      type: "array",
      items: {
        type: "object",
        properties: {
          simplified: {
            type: "string",
            description: "The sentence in simplified Chinese"
          },
          traditional: {
            type: "string",
            description: "The sentence in traditional Chinese"
          },
          pinyin: {
            type: "string",
            description: "Pinyin with tone marks for the entire sentence (e.g. nǐ hǎo, not ni3 hao3)"
          },
          english: {
            type: "string",
            description: "English translation of the sentence"
          },
          words_used: {
            type: "array",
            items: { type: "string" },
            description: "List of vocabulary words (simplified Chinese) from the provided list that appear in this sentence"
          }
        },
        required: ["simplified", "traditional", "pinyin", "english", "words_used"]
      }
    }
  },
  required: ["sentences"]
};

export async function generateSentences(words, { count = 10, objectives, additionalInstructions, signal, onChunk } = {}) {
  if (!words || words.length === 0) {
    throw new Error('At least one word is required to generate sentences');
  }

  const wordList = formatWordList(sampleWords(words));
  const prompt = generateSentencesPrompt(wordList, { count, objectives, additionalInstructions });

  const requestBody = {
    contents: [
      {
        parts: [
          { text: prompt }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: GENERATE_SENTENCES_RESPONSE_SCHEMA
    }
  };

  if (onChunk) {
    return geminiStreamRequest(requestBody, { onChunk, signal });
  }

  return geminiRequest(requestBody, { signal });
}

export async function generateTts(text, { signal } = {}) {
  const requestBody = {
    contents: [
      {
        parts: [
          {
            text: `Read slowly in proper chinese pronunciation appropriate for a learner\n${text}`
          }
        ]
      }
    ],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: GEMINI_TTS_VOICE
          }
        }
      }
    }
  };

  const response = await geminiFetch('generateContent', requestBody, {
    signal,
    model: GEMINI_TTS_MODEL,
  });

  const data = await response.json();

  const candidate = data?.candidates?.[0];
  const finishReason = candidate?.finishReason;
  if (finishReason && finishReason !== 'STOP') {
    throw new Error(`TTS generation failed (finishReason: ${finishReason})`);
  }

  const inlineData = candidate?.content?.parts?.[0]?.inlineData;
  if (!inlineData?.data) {
    throw new Error('TTS response did not contain any audio data');
  }

  const binary = atob(inlineData.data);
  const pcmData = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    pcmData[i] = binary.charCodeAt(i);
  }

  // Gemini TTS returns raw PCM 24kHz 16-bit LE mono — wrap in WAV header
  const sampleRate = 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const wavHeader = new ArrayBuffer(44);
  const view = new DataView(wavHeader);

  const writeString = (off, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(off + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + pcmData.length, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, pcmData.length, true);

  const blob = new Blob([wavHeader, pcmData], { type: 'audio/wav' });
  const durationMs = Math.round((pcmData.length / blockAlign / sampleRate) * 1000);

  return {
    blob,
    mimeType: 'audio/wav',
    durationMs,
    model: GEMINI_TTS_MODEL,
    voice: GEMINI_TTS_VOICE,
  };
}
