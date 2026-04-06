import { useState, useRef, useEffect } from "react";
import styles from "./index.module.css";
import { setRoute } from "./router";
import { useConfig } from "./config";
import { generateWords } from "./gemini";
import { StreamingPreview } from "./StreamingPreview";
import { useCollectionWordManager } from "./useCollectionWordManager";
import { WordPreviewList } from "./WordPreviewList";

export function GenerateCollection() {
  const abortRef = useRef(null);
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [wordCount, setWordCount] = useState('');
  const [extractedWords, setExtractedWords] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [apiKey] = useConfig("gemini_api_key");

  const {
    addExistingToCollection, duplicateMatches, isWordSelected,
    selectedCount, totalWordsToAdd,
    updateField, toggleAllCreateNew, toggleCreateNew, toggleAddExisting,
    saveCollectionWithWords, resetSelection,
  } = useCollectionWordManager(extractedWords, setExtractedWords);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

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
    resetSelection();

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
      resetSelection();
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
      await saveCollectionWithWords({
        name: title,
        notes: '',
        objectives: instructions || '',
      });
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
    resetSelection();
    setError(null);
  };

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

      <StreamingPreview
        active={processing}
        streamText={streamText}
        meta={`Topic: ${title}`}
        onCancel={cancelProcessing}
      />

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
        <>
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
            duplicateMatches={duplicateMatches}
            renderDuplicateActions={(index) => (
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={!!addExistingToCollection[index]}
                  onChange={() => toggleAddExisting(index)}
                />
                <span>Use existing word in this collection</span>
              </label>
            )}
          />
        </>
      )}
    </div>
  );
}
