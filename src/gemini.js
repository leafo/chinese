import { config } from './config.js';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_MODEL = 'gemini-flash-latest';

const OCR_WORDS_RESPONSE_SCHEMA = {
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

async function geminiFetch(endpoint, requestBody, { signal } = {}) {
  const apiKey = await getApiKey();
  const response = await fetch(`${GEMINI_API_BASE}/models/${GEMINI_MODEL}:${endpoint}`, {
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

function buildOcrWordsRequestBody(base64Data, mimeType) {
  return {
    contents: [
      {
        parts: [
          {
            text: `Extract all Chinese vocabulary words from this image. This is likely a textbook page or word list.

For each word found:
- Provide both traditional and simplified Chinese characters
- Provide pinyin with tone marks (e.g. nǐ hǎo), not tone numbers
- Provide the English definition
- Include any usage notes, example sentences, or grammar notes if visible

Extract every word you can identify in the image. If a word appears with its definition, include that definition. If you can see both traditional and simplified forms, include both.`
          },
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Data
            }
          }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: OCR_WORDS_RESPONSE_SCHEMA
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

export async function ocrWords(file, options = {}) {
  const { base64Data, mimeType } = await encodeFileAsInlineData(file);
  const requestBody = buildOcrWordsRequestBody(base64Data, mimeType);
  const { onChunk, signal } = options;

  if (onChunk) {
    return geminiStreamRequest(requestBody, { onChunk, signal });
  }

  return geminiRequest(requestBody, { signal });
}
