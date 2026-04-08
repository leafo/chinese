import { useState, useEffect } from "react";
import styles from "./index.module.css";
import { setRoute, useRoute } from "./router";
import { useCollectionWordManager } from "./useCollectionWordManager";
import { WordPreviewList } from "./WordPreviewList";
import { deserializeAudioClip } from "./backup";
import { store as audioStore } from "./audio";

// Module-level store for passing local file data to the import view
let _pendingLocalData = null;
export function setLocalImportData(data) {
  _pendingLocalData = data;
}

export function ImportCollection() {
  const route = useRoute(['file', 'source']);
  const [collectionData, setCollectionData] = useState(null);
  const [extractedWords, setExtractedWords] = useState(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState(null);

  const {
    addExistingToCollection, duplicateMatches, isWordSelected,
    selectedCount, totalWordsToAdd,
    updateField, toggleAllCreateNew, toggleCreateNew, toggleAddExisting,
    saveCollectionWithWords,
  } = useCollectionWordManager(extractedWords, setExtractedWords);

  useEffect(() => {
    if (route.source === 'local') {
      const data = _pendingLocalData;
      _pendingLocalData = null;
      if (!data) {
        setError('No file data available. Please select a file again.');
        return;
      }
      if (data.format !== 'chinese-collection-export') {
        setError('Invalid collection file format');
        return;
      }
      setCollectionData(data);
      setExtractedWords(data.words || []);
      return;
    }

    if (!route.file) return;
    fetch(`collections/${route.file}`)
      .then(res => {
        if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (data.format !== 'chinese-collection-export') {
          throw new Error('Invalid collection file format');
        }
        setCollectionData(data);
        setExtractedWords(data.words || []);
      })
      .catch(err => setError(err.message || String(err)));
  }, [route.file, route.source]);

  const handleImport = async () => {
    setImporting(true);
    try {
      const { collection, audio_clips } = collectionData;

      await saveCollectionWithWords({
        name: collection.name,
        notes: collection.notes || '',
        objectives: collection.objectives || '',
      });

      if (audio_clips?.length) {
        for (const clip of audio_clips) {
          await audioStore.put(deserializeAudioClip(clip));
        }
      }

      setRoute({ view: 'collections' });
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div>
      <div className={styles.sectionHeader}>
        <h2>Import Collection{collectionData ? `: ${collectionData.collection.name}` : ''}</h2>
      </div>

      {error && (
        <div className={styles.errorBox}>
          <p>{error}</p>
          <button className={styles.smallButton} onClick={() => setRoute({ view: 'collections' })}>
            Back to Collections
          </button>
        </div>
      )}

      {!collectionData && !error && <p>Loading collection...</p>}

      {extractedWords && extractedWords.length === 0 && (
        <div className={styles.emptyState}>
          <p>This collection has no words</p>
          <button className={styles.smallButton} onClick={() => setRoute({ view: 'collections' })}>
            Back to Collections
          </button>
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
              <button className={styles.secondaryButton} onClick={() => setRoute({ view: 'collections' })}>Cancel</button>
              <button
                className={styles.primaryButton}
                onClick={handleImport}
                disabled={totalWordsToAdd === 0 || importing}
              >
                {importing ? 'Importing...' : `Import Collection with ${totalWordsToAdd} Word${totalWordsToAdd !== 1 ? 's' : ''}`}
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
