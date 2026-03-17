import { config } from './config.js';

const GEMINI_MODEL = 'gemini-2.0-flash';

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

async function geminiRequest(requestBody) {
  const apiKey = await config.getValue("gemini_api_key");

  if (!apiKey) {
    return Promise.reject(new Error('Gemini API key is not set. Please add it in Settings.'));
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorData = await response.json();
    return Promise.reject(new Error(errorData.error.message));
  }

  const data = await response.json();

  if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts || !data.candidates[0].content.parts[0].text) {
    return Promise.reject(new Error("Unexpected response format from Gemini API"));
  }

  const finishReason = data.candidates[0].finishReason;
  if (finishReason !== 'STOP') {
    return Promise.reject(new Error(`Gemini did not finish with STOP reason: ${finishReason}`));
  }

  try {
    return JSON.parse(data.candidates[0].content.parts[0].text);
  } catch (e) {
    return Promise.reject(new Error(`Failed to parse JSON response from Gemini: ${e.message}`));
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
    return Promise.reject(new Error('At least one field must be provided'));
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

export async function ocrWords(file) {
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const base64Data = base64.split(',')[1];
  const mimeType = file.type;

  const requestBody = {
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

  return geminiRequest(requestBody);
}
