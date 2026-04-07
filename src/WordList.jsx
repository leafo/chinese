import { useState, useMemo } from "react";
import styles from "./index.module.css";
import { useWords, useAllWords, insertWord, deleteWord, updateWord, bulkUpdateCollections } from "./words";
import { useCollections } from "./collections";
import { setRoute, useRoute, updateRoute } from "./router";
import { PlayButton } from "./PlayButton";
import { WordForm, EditWordDialog } from "./EditWordDialog";
import { useConfig } from "./config";
import { DEFAULT_DISPLAY_SCRIPT, getPreferredChineseText } from "./display";

export function WordList() {
  const { collection: collectionFilter } = useRoute(['collection']);
  const collectionId = collectionFilter ? parseInt(collectionFilter, 10) : null;
  const [allWords, allError, allLoading] = useAllWords();
  const [recentWords, recentError, recentLoading] = useWords(100, 0);
  const words = collectionId ? allWords : recentWords;
  const error = collectionId ? allError : recentError;
  const loading = collectionId ? allLoading : recentLoading;
  const [collections, collectionsError, collectionsLoading] = useCollections();
  const [displayScript] = useConfig("display_script");
  const [showForm, setShowForm] = useState(false);
  const [editingWord, setEditingWord] = useState(null);
  const [bulkEditMode, setBulkEditMode] = useState(false);
  const [selectedWordIds, setSelectedWordIds] = useState(new Set());
  const [bulkCollectionId, setBulkCollectionId] = useState('');
  const [bulkStatus, setBulkStatus] = useState(null);
  const preferredScript = displayScript || DEFAULT_DISPLAY_SCRIPT;
  const collectionNamesById = Object.fromEntries((collections || []).map(collection => [collection.id, collection.name]));

  const filteredWords = useMemo(() => {
    if (!words) return null;
    if (!collectionId) return words;
    return words.filter(w => (w.collection_ids || []).includes(collectionId));
  }, [words, collectionId]);

  const handleAdd = async (form) => {
    await insertWord(form);
    setShowForm(false);
  };

  const handleUpdate = async (form) => {
    await updateWord(form);
    setEditingWord(null);
  };

  const handleDelete = async (id) => {
    await deleteWord(id);
    setEditingWord(current => (current?.id === id ? null : current));
  };

  const toggleBulkEdit = () => {
    setBulkEditMode(prev => !prev);
    setSelectedWordIds(new Set());
    setBulkCollectionId('');
    setBulkStatus(null);
  };

  const toggleWordSelection = (wordId) => {
    setSelectedWordIds(prev => {
      const next = new Set(prev);
      if (next.has(wordId)) next.delete(wordId);
      else next.add(wordId);
      return next;
    });
  };

  const selectAll = () => {
    if (!filteredWords) return;
    setSelectedWordIds(new Set(filteredWords.map(w => w.id)));
  };

  const selectNone = () => setSelectedWordIds(new Set());

  const handleBulkAction = async (action) => {
    if (!bulkCollectionId || selectedWordIds.size === 0) return;
    setBulkStatus(null);
    const count = selectedWordIds.size;
    await bulkUpdateCollections([...selectedWordIds], parseInt(bulkCollectionId, 10), action);
    setBulkStatus(`${action === 'add' ? 'Added' : 'Removed'} ${count} word${count === 1 ? '' : 's'}`);
    setSelectedWordIds(new Set());
  };

  if (loading && !words) return <p>Loading words...</p>;
  if (error) return <p>Error loading words: {error.message}</p>;

  return (
    <div>
      <div className={styles.sectionHeader}>
        <h2>
          Words
          {collectionId && collectionNamesById[collectionId] && (
            <span className={styles.filterIndicator}>
              {' — '}{collectionNamesById[collectionId]}
              <button className={styles.clearFilter} onClick={() => updateRoute({ collection: false })}>×</button>
            </span>
          )}
        </h2>
        <div className={styles.importToolbarActions}>
          {!bulkEditMode && (
            <>
              <button className={styles.secondaryButton} onClick={() => setRoute({ view: 'import' })}>
                Bulk Add
              </button>
              <button className={styles.secondaryButton} onClick={toggleBulkEdit}>
                Bulk Edit
              </button>
              <button className={styles.primaryButton} onClick={() => setShowForm(!showForm)}>
                + Add Word
              </button>
            </>
          )}
          {bulkEditMode && (
            <button className={styles.secondaryButton} onClick={toggleBulkEdit}>
              Done
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <WordForm
          onSave={handleAdd}
          onCancel={() => setShowForm(false)}
          collections={collections || []}
          collectionsLoading={collectionsLoading}
          collectionsError={collectionsError}
        />
      )}

      {editingWord && (
        <EditWordDialog
          key={editingWord.id}
          word={editingWord}
          onSave={handleUpdate}
          onDelete={handleDelete}
          onClose={() => setEditingWord(null)}
          collections={collections || []}
          collectionsLoading={collectionsLoading}
          collectionsError={collectionsError}
        />
      )}

      {bulkEditMode && (
        <div className={styles.bulkEditToolbar}>
          <div className={styles.bulkEditControls}>
            <select
              value={bulkCollectionId}
              onChange={e => setBulkCollectionId(e.target.value)}
              className={styles.bulkEditSelect}
            >
              <option value="">Select collection...</option>
              {(collections || []).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button
              className={styles.primaryButton}
              disabled={!bulkCollectionId || selectedWordIds.size === 0}
              onClick={() => handleBulkAction('add')}
            >
              Add to Collection
            </button>
            <button
              className={styles.secondaryButton}
              disabled={!bulkCollectionId || selectedWordIds.size === 0}
              onClick={() => handleBulkAction('remove')}
            >
              Remove from Collection
            </button>
          </div>
          <div className={styles.bulkEditMeta}>
            <span>{selectedWordIds.size} selected</span>
            <button className={styles.smallButton} onClick={selectAll}>Select All</button>
            <button className={styles.smallButton} onClick={selectNone}>Select None</button>
            {bulkStatus && <span className={styles.bulkEditStatus}>{bulkStatus}</span>}
          </div>
        </div>
      )}

      {(!filteredWords || filteredWords.length === 0) ? (
        <div className={styles.emptyState}>
          {collectionId ? (
            <p>No words in this collection</p>
          ) : (
            <>
              <p>No words yet</p>
              <p>Add a word above, or <a href="?view=collections" className={styles.emptyStateLink} onClick={(e) => { e.preventDefault(); setRoute({ view: 'collections' }); }}>import a premade collection</a> to get started</p>
            </>
          )}
        </div>
      ) : (
        <ul className={styles.wordList}>
          {filteredWords.map(word => (
            <WordRow
              key={word.id}
              word={word}
              preferredScript={preferredScript}
              collectionNamesById={collectionNamesById}
              onEdit={() => setEditingWord(word)}
              bulkEditMode={bulkEditMode}
              selected={selectedWordIds.has(word.id)}
              onToggleSelect={() => toggleWordSelection(word.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function WordRow({ word, preferredScript, collectionNamesById, onEdit, bulkEditMode, selected, onToggleSelect }) {
  const primaryText = getPreferredChineseText(word, preferredScript);
  const collectionNames = (word.collection_ids || [])
    .map(id => collectionNamesById[id])
    .filter(Boolean);

  return (
    <li
      className={`${styles.wordItem}${bulkEditMode && selected ? ` ${styles.wordItemSelected}` : ''}`}
    >
      {bulkEditMode && (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          onClick={e => e.stopPropagation()}
          className={styles.bulkCheckbox}
        />
      )}
      <span className={styles.wordChinese}>{primaryText}</span>
      <div className={styles.wordDetails}>
        <div className={styles.wordSummary}>
          <span className={styles.wordPinyin}>{word.pinyin}</span>
          <span className={styles.wordEnglish}>{word.english}</span>
        </div>
        {collectionNames.length > 0 && (
          <div className={styles.tags}>
            {collectionNames.map(name => (
              <span key={name} className={styles.tag}>{name}</span>
            ))}
          </div>
        )}
      </div>
      <div className={styles.wordActions}>
        <PlayButton word={word} />
        <button className={styles.smallButton} onClick={onEdit}>Edit</button>
      </div>
    </li>
  );
}
