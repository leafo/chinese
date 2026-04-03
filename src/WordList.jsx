import { useState, useMemo } from "react";
import styles from "./index.module.css";
import { useWords, useAllWords, insertWord, deleteWord, updateWord } from "./words";
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
          <button className={styles.cancelButton} onClick={() => setRoute({ view: 'import' })}>
            Bulk Add
          </button>
          <button className={styles.addButton} onClick={() => setShowForm(!showForm)}>
            + Add Word
          </button>
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

      {(!filteredWords || filteredWords.length === 0) ? (
        <div className={styles.emptyState}>
          {collectionId ? (
            <p>No words in this collection</p>
          ) : (
            <>
              <p>No words yet</p>
              <p>Add your first word to get started</p>
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
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function WordRow({ word, preferredScript, collectionNamesById, onEdit }) {
  const primaryText = getPreferredChineseText(word, preferredScript);
  const collectionNames = (word.collection_ids || [])
    .map(id => collectionNamesById[id])
    .filter(Boolean);

  return (
    <li className={styles.wordItem}>
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
        <PlayButton text={primaryText} />
        <button className={styles.smallButton} onClick={onEdit}>Edit</button>
      </div>
    </li>
  );
}
