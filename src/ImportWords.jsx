import { useState, useRef, useEffect } from "react";
import styles from "./index.module.css";
import { setRoute } from "./router";
import { insertWord } from "./words";
import { useConfig } from "./config";
import { ocrWords } from "./gemini";

export function ImportWords() {
  const fileRef = useRef(null);
  const [extractedWords, setExtractedWords] = useState(null);
  const [selected, setSelected] = useState({});
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [apiKey] = useConfig("gemini_api_key");

  const processFile = async (file) => {
    setProcessing(true);
    setError(null);
    setExtractedWords(null);

    try {
      const result = await ocrWords(file);
      setExtractedWords(result.words);
      const sel = {};
      result.words.forEach((_, i) => { sel[i] = true; });
      setSelected(sel);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setProcessing(false);
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    processFile(file);
  };

  useEffect(() => {
    const handlePaste = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          processFile(item.getAsFile());
          return;
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  const toggleAll = () => {
    const allSelected = extractedWords.every((_, i) => selected[i]);
    const sel = {};
    extractedWords.forEach((_, i) => { sel[i] = !allSelected; });
    setSelected(sel);
  };

  const toggleOne = (index) => {
    setSelected({ ...selected, [index]: !selected[index] });
  };

  const updateField = (index, field, value) => {
    const updated = [...extractedWords];
    updated[index] = { ...updated[index], [field]: value };
    setExtractedWords(updated);
  };

  const removeWord = (index) => {
    const updated = extractedWords.filter((_, i) => i !== index);
    const newSelected = {};
    updated.forEach((_, i) => {
      const oldIndex = i >= index ? i + 1 : i;
      newSelected[i] = selected[oldIndex] ?? true;
    });
    setExtractedWords(updated);
    setSelected(newSelected);
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      for (let i = 0; i < extractedWords.length; i++) {
        if (selected[i]) {
          await insertWord(extractedWords[i]);
        }
      }
      setRoute({ view: 'words' });
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setImporting(false);
    }
  };

  const selectedCount = extractedWords
    ? extractedWords.filter((_, i) => selected[i]).length
    : 0;

  const reset = () => {
    setExtractedWords(null);
    setSelected({});
    setError(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div>
      <div className={styles.sectionHeader}>
        <h2>Import from Image</h2>
      </div>

      {!apiKey && (
        <div className={styles.warningBox}>
          Gemini API key not set.{' '}
          <button className={styles.linkButton} onClick={() => setRoute({ view: 'settings' })}>
            Go to Settings
          </button>
        </div>
      )}

      {!extractedWords && !processing && (
        <div className={styles.importUpload}>
          <p>Take a photo, select an image, or paste (Ctrl+V) a screenshot to extract words.</p>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
            className={styles.fileInput}
          />
        </div>
      )}

      {processing && (
        <div className={styles.processingState}>
          <p>Extracting words from image...</p>
        </div>
      )}

      {error && (
        <div className={styles.errorBox}>
          <p>{error}</p>
          <button className={styles.smallButton} onClick={reset}>Try Again</button>
        </div>
      )}

      {extractedWords && extractedWords.length === 0 && (
        <div className={styles.emptyState}>
          <p>No words found in the image</p>
          <button className={styles.smallButton} onClick={reset}>Try Another Image</button>
        </div>
      )}

      {extractedWords && extractedWords.length > 0 && (
        <div>
          <div className={styles.importToolbar}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={extractedWords.every((_, i) => selected[i])}
                onChange={toggleAll}
              />
              Select All ({selectedCount}/{extractedWords.length})
            </label>
            <div className={styles.importToolbarActions}>
              <button className={styles.cancelButton} onClick={reset}>Start Over</button>
              <button
                className={styles.addButton}
                onClick={handleImport}
                disabled={selectedCount === 0 || importing}
              >
                {importing ? 'Adding...' : `Add ${selectedCount} Word${selectedCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>

          <ul className={styles.importList}>
            {extractedWords.map((word, index) => (
              <li key={index} className={`${styles.importItem} ${!selected[index] ? styles.importItemDeselected : ''}`}>
                <input
                  type="checkbox"
                  checked={!!selected[index]}
                  onChange={() => toggleOne(index)}
                  className={styles.importCheckbox}
                />
                <div className={styles.importFields}>
                  <input
                    className={styles.importFieldChinese}
                    value={word.simplified || ''}
                    onChange={(e) => updateField(index, 'simplified', e.target.value)}
                    placeholder="简体"
                  />
                  <input
                    className={styles.importFieldSmall}
                    value={word.traditional || ''}
                    onChange={(e) => updateField(index, 'traditional', e.target.value)}
                    placeholder="繁體"
                  />
                  <input
                    className={styles.importFieldSmall}
                    value={word.pinyin || ''}
                    onChange={(e) => updateField(index, 'pinyin', e.target.value)}
                    placeholder="pīnyīn"
                  />
                  <input
                    className={styles.importFieldWide}
                    value={word.english || ''}
                    onChange={(e) => updateField(index, 'english', e.target.value)}
                    placeholder="English"
                  />
                  <button
                    className={styles.deleteButton}
                    onClick={() => removeWord(index)}
                    title="Remove"
                  >
                    &times;
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
