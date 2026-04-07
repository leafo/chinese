import styles from "./index.module.css";
import { PlayButton } from "./PlayButton";
import { getPreferredChineseText } from "./display";

export function ChineseDisplay({ word, displayScript, autoPlay }) {
  const primaryText = getPreferredChineseText(word, displayScript);

  return (
    <>
      <div className={styles.flashcardChinese}>{primaryText}</div>
      {word.simplified && word.traditional && word.simplified !== word.traditional && (
        <div className={styles.flashcardAlt}>
          {displayScript === 'traditional' ? word.simplified : word.traditional}
        </div>
      )}
      <div className={styles.flashcardPinyin}>{word.pinyin}</div>
      <PlayButton word={word} autoPlay={autoPlay} />
    </>
  );
}
