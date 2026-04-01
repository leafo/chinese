import styles from "./index.module.css";
import { formatDuplicateSummary } from "./duplicates";

export function WordPreviewList({ words, isWordSelected, onToggle, onUpdate, onRemove, duplicateMatches }) {
  const handleRemove = (index) => {
    const word = words[index];
    const summary = formatDuplicateSummary(word);
    const label = summary || 'this word';

    if (confirm(`Remove ${label}?`)) {
      onRemove(index);
    }
  };

  return (
    <ul className={styles.importList}>
      {words.map((word, index) => (
        <li key={index} className={`${styles.importItem} ${!isWordSelected(index) ? styles.importItemDeselected : ''}`}>
          <input
            type="checkbox"
            checked={isWordSelected(index)}
            onChange={() => onToggle(index)}
            className={styles.importCheckbox}
          />
          <div className={styles.importContent}>
            <div className={styles.importFields}>
              <input
                className={styles.importFieldChinese}
                value={word.simplified || ''}
                onChange={(e) => onUpdate(index, 'simplified', e.target.value)}
                placeholder="简体"
              />
              <input
                className={styles.importFieldSmall}
                value={word.traditional || ''}
                onChange={(e) => onUpdate(index, 'traditional', e.target.value)}
                placeholder="繁體"
              />
              <input
                className={styles.importFieldSmall}
                value={word.pinyin || ''}
                onChange={(e) => onUpdate(index, 'pinyin', e.target.value)}
                placeholder="pīnyīn"
              />
              <input
                className={styles.importFieldWide}
                value={word.english || ''}
                onChange={(e) => onUpdate(index, 'english', e.target.value)}
                placeholder="English"
              />
              <button
                type="button"
                className={styles.deleteButton}
                onClick={() => handleRemove(index)}
                title="Remove"
              >
                &times;
              </button>
            </div>
            {duplicateMatches[index] && (
              <div className={styles.importStatusRow}>
                Possible duplicate: {formatDuplicateSummary(duplicateMatches[index])}
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
