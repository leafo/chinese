import { useState, useRef, useEffect } from "react";
import styles from "./index.module.css";
import { setRoute } from "./router";
import { insertWord } from "./words";
import { useCollections } from "./collections";
import { CollectionSelector } from "./CollectionSelector";
import { useConfig } from "./config";
import { ocrWords } from "./gemini";

export function ImportWords() {
  const fileRef = useRef(null);
  const abortRef = useRef(null);
  const [extractedWords, setExtractedWords] = useState(null);
  const [selected, setSelected] = useState({});
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [collectionIds, setCollectionIds] = useState([]);
  const [apiKey] = useConfig("gemini_api_key");
  const [collections, collectionsError, collectionsLoading] = useCollections();

  useEffect(() => {
    if (!processing) {
      return;
    }

    const startedAt = Date.now();
    setElapsedMs(0);

    const interval = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 250);

    return () => window.clearInterval(interval);
  }, [processing]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const processFile = async (file) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setProcessing(true);
    setError(null);
    setExtractedWords(null);
    setSelected({});
    setCollectionIds([]);
    setStreamText('');
    setElapsedMs(0);

    try {
      const result = await ocrWords(file, {
        signal: controller.signal,
        onChunk: (_chunk, fullText) => {
          setStreamText(fullText);
        },
      });

      if (abortRef.current !== controller || controller.signal.aborted) {
        return;
      }

      setExtractedWords(result.words);
      const sel = {};
      result.words.forEach((_, i) => { sel[i] = true; });
      setSelected(sel);
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }
      setError(err.message || String(err));
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setProcessing(false);
      }
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

  const cancelProcessing = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setProcessing(false);
    setStreamText('');
    setElapsedMs(0);
    setError(null);
    setExtractedWords(null);
    setSelected({});
    setCollectionIds([]);
    if (fileRef.current) {
      fileRef.current.value = '';
    }
  };

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
          await insertWord({
            ...extractedWords[i],
            collection_ids: [...(extractedWords[i].collection_ids || []), ...collectionIds],
          });
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
    abortRef.current?.abort();
    abortRef.current = null;
    setExtractedWords(null);
    setSelected({});
    setError(null);
    setProcessing(false);
    setStreamText('');
    setElapsedMs(0);
    setCollectionIds([]);
    if (fileRef.current) fileRef.current.value = '';
  };

  const toggleCollection = (collectionId) => {
    setCollectionIds((currentIds) => (
      currentIds.includes(collectionId)
        ? currentIds.filter(id => id !== collectionId)
        : [...currentIds, collectionId]
    ));
  };

  const elapsedSeconds = (elapsedMs / 1000).toFixed(1);
  const streamStatus = streamText
    ? 'Streaming structured JSON from Gemini...'
    : 'Uploading image and waiting for the first JSON chunk...';

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
          <p>{streamStatus}</p>
          <div className={styles.processingMeta}>
            <span>Elapsed: {elapsedSeconds}s</span>
            <span>Received: {streamText.length.toLocaleString()} chars</span>
          </div>
          <pre className={styles.streamOutput}>
            {streamText || '{\n  "words": [\n    ...waiting for first chunk\n  ]\n}'}
          </pre>
          <div className={styles.processingActions}>
            <button className={styles.cancelButton} onClick={cancelProcessing}>Cancel</button>
          </div>
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
          <div className={styles.form}>
            <div className={styles.formField}>
              <label>Collections for Imported Words</label>
              <CollectionSelector
                collections={collections || []}
                loading={collectionsLoading}
                error={collectionsError}
                selectedIds={collectionIds}
                onToggle={toggleCollection}
                emptyMessage="No collections yet. Create one in the Collections tab before importing."
              />
            </div>
          </div>
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
