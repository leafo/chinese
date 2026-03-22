import { useEffect, useRef, useState } from "react";
import styles from "./index.module.css";
import { useWords, insertWord, deleteWord, updateWord } from "./words";
import { useCollections } from "./collections";
import { CollectionSelector } from "./CollectionSelector";
import { completeWord } from "./gemini";
import { setRoute } from "./router";
import { PlayButton } from "./PlayButton";
import { useConfig } from "./config";
import { DEFAULT_DISPLAY_SCRIPT, getPreferredChineseText } from "./display";

function WordForm({ onSave, onCancel, initial, collections, collectionsLoading, collectionsError }) {
  const [form, setForm] = useState({
    traditional: '',
    simplified: '',
    pinyin: '',
    english: '',
    notes: '',
    collection_ids: [],
    ...initial,
  });
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState(null);

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });
  const toggleCollection = (collectionId) => {
    const selectedIds = form.collection_ids || [];
    const nextIds = selectedIds.includes(collectionId)
      ? selectedIds.filter(id => id !== collectionId)
      : [...selectedIds, collectionId];

    setForm({ ...form, collection_ids: nextIds });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    await onSave(form);
  };

  const hasContent = form.traditional || form.simplified || form.pinyin || form.english || form.notes;

  const handleAutoComplete = async () => {
    setCompleting(true);
    setCompleteError(null);
    try {
      const result = await completeWord(form);
      setForm(prev => ({
        ...prev,
        traditional: prev.traditional || result.traditional || '',
        simplified: prev.simplified || result.simplified || '',
        pinyin: prev.pinyin || result.pinyin || '',
        english: prev.english || result.english || '',
      }));
    } catch (err) {
      setCompleteError(err.message || String(err));
    } finally {
      setCompleting(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.formRow}>
        <div className={styles.formField}>
          <label>Traditional</label>
          <input value={form.traditional} onChange={set('traditional')} placeholder="繁體" />
        </div>
        <div className={styles.formField}>
          <label>Simplified</label>
          <input value={form.simplified} onChange={set('simplified')} placeholder="简体" />
        </div>
        <div className={styles.formField}>
          <label>Pinyin</label>
          <input value={form.pinyin} onChange={set('pinyin')} placeholder="pīnyīn" />
        </div>
      </div>
      <div className={styles.formField}>
        <label>English</label>
        <input value={form.english} onChange={set('english')} placeholder="English definition" />
      </div>
      <div className={styles.formField}>
        <label>Notes</label>
        <textarea value={form.notes} onChange={set('notes')} placeholder="Usage notes, examples, etc." />
      </div>
      <div className={styles.formField}>
        <label>Collections</label>
        <CollectionSelector
          collections={collections}
          loading={collectionsLoading}
          error={collectionsError}
          selectedIds={form.collection_ids || []}
          onToggle={toggleCollection}
        />
      </div>
      {completeError && <div className={styles.errorBox}><p>{completeError}</p></div>}
      <div className={styles.formActions}>
        <button
          type="button"
          className={styles.autoCompleteButton}
          onClick={handleAutoComplete}
          disabled={!hasContent || completing}
        >
          {completing ? 'Completing...' : 'Auto complete'}
        </button>
        <div className={styles.formActionsRight}>
          {onCancel && <button type="button" className={styles.cancelButton} onClick={onCancel}>Cancel</button>}
          <button type="submit" className={styles.addButton}>{initial ? 'Save' : 'Add Word'}</button>
        </div>
      </div>
    </form>
  );
}

function EditWordDialog({
  word,
  onSave,
  onDelete,
  onClose,
  collections,
  collectionsLoading,
  collectionsError,
}) {
  const dialogRef = useRef(null);
  const [deleteArmed, setDeleteArmed] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    if (!dialog.open) {
      dialog.showModal();
    }

    return () => {
      if (dialog.open) {
        dialog.close();
      }
    };
  }, []);

  const handleSave = async (form) => {
    await onSave({ ...form, id: word.id });
  };

  const handleDeleteSubmit = async (e) => {
    e.preventDefault();
    if (!deleteArmed) {
      return;
    }
    await onDelete(word.id);
  };

  return (
    <dialog
      ref={dialogRef}
      className={styles.modalDialog}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className={styles.modalHeader}>
        <h3>Edit Word</h3>
        <button
          type="button"
          className={styles.cancelButton}
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <div className={styles.modalBody}>
        <WordForm
          initial={word}
          onSave={handleSave}
          onCancel={onClose}
          collections={collections}
          collectionsLoading={collectionsLoading}
          collectionsError={collectionsError}
        />
        <details className={styles.formDetails}>
          <summary className={styles.formDetailsSummary}>Delete...</summary>
          <div className={styles.formDetailsContent}>
            <form className={styles.deletePanel} onSubmit={handleDeleteSubmit}>
              <button
                type="submit"
                className={styles.deleteButton}
                disabled={!deleteArmed}
              >
                Delete
              </button>
              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  required
                  checked={deleteArmed}
                  onChange={(e) => setDeleteArmed(e.target.checked)}
                />
                <span>Confirm delete</span>
              </label>
            </form>
          </div>
        </details>
      </div>
    </dialog>
  );
}

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
