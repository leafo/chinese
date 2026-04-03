import { useState, useRef, useEffect } from "react";
import styles from "./index.module.css";
import { setRoute } from "./router";
import { insertWord, updateWord, useAllWords } from "./words";
import { insertCollection } from "./collections";
import { useConfig } from "./config";
import { generateWords } from "./gemini";
import { useElapsedTimer } from "./useElapsedTimer";
import { useWordSelection } from "./useWordSelection";
import { WordPreviewList } from "./WordPreviewList";

export function GenerateCollection() {
  const abortRef = useRef(null);
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [wordCount, setWordCount] = useState('');
  const [extractedWords, setExtractedWords] = useState(null);
  const [addExistingToCollection, setAddExistingToCollection] = useState({});
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [apiKey] = useConfig("gemini_api_key");
  const [existingWords] = useAllWords();

  const elapsedMs = useElapsedTimer(processing);
  const {
    setSelected, duplicateMatches, isWordSelected,
    selectedCount,
  } = useWordSelection(extractedWords, existingWords);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const updateField = (index, field, value) => {
    const updated = [...extractedWords];
    updated[index] = { ...updated[index], [field]: value };
    setExtractedWords(updated);
  };

  const removeWord = (index) => {
    const updated = extractedWords.filter((_, i) => i !== index);
    setExtractedWords(updated);
    setSelected({});
    setAddExistingToCollection({});
  };

  const toggleAllCreateNew = () => {
    const allSelected = extractedWords.every((_, i) => isWordSelected(i));
    const nextSelected = !allSelected;
    const selection = {};

    extractedWords.forEach((_, i) => {
      selection[i] = nextSelected;
    });

    setSelected(selection);

    if (nextSelected) {
      setAddExistingToCollection({});
    }
  };

  const toggleCreateNew = (index) => {
    const nextSelected = !isWordSelected(index);
    setSelected((current) => ({ ...current, [index]: nextSelected }));

    if (duplicateMatches[index] && nextSelected) {
      setAddExistingToCollection((current) => ({
        ...current,
        [index]: false,
      }));
    }
  };

  const cancelProcessing = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setProcessing(false);
    setStreamText('');
  };

  const handleGenerate = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setProcessing(true);
    setError(null);
    setStreamText('');
    setAddExistingToCollection({});

    try {
      const result = await generateWords(title, {
        count: wordCount === '' ? undefined : Number(wordCount),
        instructions: instructions || undefined,
        signal: controller.signal,
        onChunk: (_chunk, fullText) => {
          if (abortRef.current === controller && !controller.signal.aborted) {
            setStreamText(fullText);
          }
        },
      });

      if (abortRef.current !== controller || controller.signal.aborted) {
        return;
      }

      const words = result?.words;
      if (!words || !Array.isArray(words)) {
        throw new Error('Unexpected response format from Gemini');
      }

      setExtractedWords(words);
      setSelected({});
      setAddExistingToCollection({});
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

  const handleCreate = async () => {
    setImporting(true);
    try {
      const collectionId = await insertCollection({
        name: title,
        notes: '',
        objectives: instructions || '',
      });

      const existingWordsToLink = new Map();
      duplicateMatches.forEach((duplicate, index) => {
        if (duplicate && addExistingToCollection[index]) {
          existingWordsToLink.set(duplicate.id, duplicate);
        }
      });

      for (const duplicate of existingWordsToLink.values()) {
        await updateWord({
          ...duplicate,
          collection_ids: [...(duplicate.collection_ids || []), collectionId],
        });
      }

      for (let i = 0; i < extractedWords.length; i++) {
        if (isWordSelected(i)) {
          await insertWord({
            ...extractedWords[i],
            collection_ids: [collectionId],
          });
        }
      }
      setRoute({ view: 'collections' });
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setImporting(false);
    }
  };

  const reset = () => {
    cancelProcessing();
    setExtractedWords(null);
    setSelected({});
    setAddExistingToCollection({});
    setError(null);
  };

  const toggleAddExisting = (index) => {
    const nextValue = !addExistingToCollection[index];
    setAddExistingToCollection((current) => ({ ...current, [index]: nextValue }));
    if (nextValue) {
      setSelected((selected) => ({ ...selected, [index]: false }));
    }
  };

  const elapsedSeconds = (elapsedMs / 1000).toFixed(1);
  const streamStatus = streamText
    ? 'Streaming structured JSON from Gemini...'
    : 'Waiting for the first JSON chunk...';
  const existingLinkedCount = Array.from(
    new Set(
      duplicateMatches
        .filter((duplicate, index) => duplicate && addExistingToCollection[index])
        .map((duplicate) => duplicate.id)
    )
  ).length;
  const totalWordsToAdd = selectedCount + existingLinkedCount;

  return (
    <div>
      <div className={styles.sectionHeader}>
        <h2>Generate Collection</h2>
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
        <form className={styles.form} onSubmit={(e) => { e.preventDefault(); handleGenerate(); }}>
          <div className={styles.formField}>
            <label htmlFor="generate-title">Collection Title</label>
            <input
              id="generate-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Chinese Food, Travel Phrases, HSK 3 Verbs"
              required
            />
          </div>
          <div className={styles.formField}>
            <label htmlFor="generate-instructions">Additional Instructions</label>
            <textarea
              id="generate-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Optional guidance for word generation, such as difficulty level, specific subtopics, or word types to include."
              rows={3}
            />
          </div>
          <div className={styles.formField}>
            <label htmlFor="generate-count">Approximate Word Count</label>
            <input
              id="generate-count"
              type="number"
              min={5}
              max={100}
              value={wordCount}
              onChange={(e) => setWordCount(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className={styles.formActions}>
            <button type="button" className={styles.secondaryButton} onClick={() => setRoute({ view: 'collections' })}>
              Cancel
            </button>
            <button type="submit" className={styles.primaryButton} disabled={!title.trim() || !apiKey}>
              Generate Words
            </button>
          </div>
        </form>
      )}

      {processing && (
        <div className={styles.processingState}>
          <p>{streamStatus}</p>
          <div className={styles.processingMeta}>
            <span>Topic: {title}</span>
            <span>Elapsed: {elapsedSeconds}s</span>
            <span>Received: {streamText.length.toLocaleString()} chars</span>
          </div>
          <pre className={styles.streamOutput}>
            {streamText || '{\n  "words": [\n    ...waiting for first chunk\n  ]\n}'}
          </pre>
          <div className={styles.processingActions}>
            <button className={styles.secondaryButton} onClick={cancelProcessing}>Cancel</button>
          </div>
        </div>
      )}

      {error && (
        <div className={styles.errorBox}>
          <p>{error}</p>
          <button
            className={styles.smallButton}
            onClick={extractedWords ? () => setError(null) : reset}
          >
            {extractedWords ? 'Dismiss' : 'Try Again'}
          </button>
        </div>
      )}

      {extractedWords && extractedWords.length === 0 && (
        <div className={styles.emptyState}>
          <p>No words were generated</p>
          <button className={styles.smallButton} onClick={reset}>Try Again</button>
        </div>
      )}

      {extractedWords && extractedWords.length > 0 && (
        <div>
          <div className={styles.importToolbar}>
            <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={extractedWords.every((_, i) => isWordSelected(i))}
                  onChange={toggleAllCreateNew}
                />
              Select All ({selectedCount}/{extractedWords.length})
            </label>
            <div className={styles.importToolbarActions}>
              <button className={styles.secondaryButton} onClick={reset}>Start Over</button>
              <button
                className={styles.primaryButton}
                onClick={handleCreate}
                disabled={totalWordsToAdd === 0 || importing}
              >
                {importing ? 'Creating...' : `Create Collection with ${totalWordsToAdd} Word${totalWordsToAdd !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>

          <WordPreviewList
            words={extractedWords}
            isWordSelected={isWordSelected}
            onToggle={toggleCreateNew}
            onUpdate={updateField}
            onRemove={removeWord}
            duplicateMatches={duplicateMatches}
            renderDuplicateActions={(index) => (
              <div>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={!!addExistingToCollection[index]}
                    onChange={() => toggleAddExisting(index)}
                  />
                  <span>Use existing word in this collection</span>
                </label>
              </div>
            )}
          />
        </div>
      )}
    </div>
  );
}
