import { useState } from "react";
import styles from "./index.module.css";
import { useWords, insertWord, deleteWord, updateWord } from "./words";
import { useCollections } from "./collections";
import { setRoute } from "./router";
import { PlayButton } from "./PlayButton";
import { WordForm, EditWordDialog } from "./EditWordDialog";
import { useConfig } from "./config";
import { DEFAULT_DISPLAY_SCRIPT, getPreferredChineseText } from "./display";

export function WordList() {
  const [words, error, loading] = useWords(100, 0);
  const [collections, collectionsError, collectionsLoading] = useCollections();
  const [displayScript] = useConfig("display_script");
  const [showForm, setShowForm] = useState(false);
  const [editingWord, setEditingWord] = useState(null);
  const preferredScript = displayScript || DEFAULT_DISPLAY_SCRIPT;
  const collectionNamesById = Object.fromEntries((collections || []).map(collection => [collection.id, collection.name]));

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

  if (loading) return <p>Loading words...</p>;
  if (error) return <p>Error loading words: {error.message}</p>;

  return (
    <div>
      <div className={styles.sectionHeader}>
        <h2>Words</h2>
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

      {(!words || words.length === 0) ? (
        <div className={styles.emptyState}>
          <p>No words yet</p>
          <p>Add your first word to get started</p>
        </div>
      ) : (
        <ul className={styles.wordList}>
          {words.map(word => (
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
