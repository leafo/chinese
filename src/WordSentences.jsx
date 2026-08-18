import { useMemo } from "react";
import styles from "./index.module.css";
import { useSentencesForWord } from "./sentences";
import { getPreferredChineseText } from "./display";
import { SentenceAudioButton } from "./SentenceAudioButton";

const MAX_SENTENCES = 3;

function pickRandom(list, count) {
  if (list.length <= count) return list;
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

function highlightWord(text, wordText) {
  if (!wordText || !text.includes(wordText)) return text;
  const parts = text.split(wordText);
  return parts.flatMap((part, i) => i === 0
    ? [part]
    : [<span key={i} className={styles.cardSentenceHighlight}>{wordText}</span>, part]
  );
}

// Compact example sentences for a word, shown on the revealed back of a
// flashcard as reminders of usage. Renders nothing while loading or when the
// word has no linked sentences.
export function WordSentences({ word, displayScript }) {
  const [sentences] = useSentencesForWord(word.id);
  const shown = useMemo(
    () => sentences ? pickRandom(sentences, MAX_SENTENCES) : [],
    [sentences]
  );

  if (shown.length === 0) return null;

  const wordText = getPreferredChineseText(word, displayScript);

  return (
    <div className={styles.cardSentences}>
      {shown.map(s => (
        <div key={s.id} className={styles.cardSentence}>
          <SentenceAudioButton sentence={s} />
          <div className={styles.cardSentenceTexts}>
            <div className={styles.cardSentenceChinese}>
              {highlightWord(getPreferredChineseText(s, displayScript), wordText)}
            </div>
            {s.pinyin && <div className={styles.cardSentencePinyin}>{s.pinyin}</div>}
            {s.english && <div className={styles.cardSentenceEnglish}>{s.english}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
