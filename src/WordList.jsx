import { useState } from "react";
import styles from "./index.module.css";
import { useWords, insertWord, deleteWord, updateWord } from "./words";
import { completeWord } from "./gemini";

function WordForm({ onSave, onCancel, initial }) {
  const [form, setForm] = useState(initial || {
    traditional: '',
    simplified: '',
    pinyin: '',
    english: '',
    notes: '',
  });
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState(null);

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

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

export function WordList() {
  const [words, error, loading] = useWords(100, 0);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const handleAdd = async (form) => {
    await insertWord(form);
    setShowForm(false);
  };

  const handleUpdate = async (form) => {
    await updateWord({ ...form, id: editingId });
    setEditingId(null);
  };

  const handleDelete = async (id) => {
    await deleteWord(id);
  };

  if (loading) return <p>Loading words...</p>;
  if (error) return <p>Error loading words: {error.message}</p>;

  return (
    <div>
      <div className={styles.sectionHeader}>
        <h2>Words</h2>
        <button className={styles.addButton} onClick={() => setShowForm(!showForm)}>
          + Add Word
        </button>
      </div>

      {showForm && (
        <WordForm onSave={handleAdd} onCancel={() => setShowForm(false)} />
      )}

      {(!words || words.length === 0) ? (
        <div className={styles.emptyState}>
          <p>No words yet</p>
          <p>Add your first word to get started</p>
        </div>
      ) : (
        <ul className={styles.wordList}>
          {words.map(word => (
            <li key={word.id} className={styles.wordItem}>
              {editingId === word.id ? (
                <WordForm
                  initial={word}
                  onSave={handleUpdate}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <>
                  <span className={styles.wordChinese}>{word.simplified || word.traditional}</span>
                  {word.traditional && word.simplified && word.traditional !== word.simplified && (
                    <span className={styles.wordChinese} style={{ color: '#94a3b8', fontSize: 16 }}>{word.traditional}</span>
                  )}
                  <span className={styles.wordPinyin}>{word.pinyin}</span>
                  <span className={styles.wordEnglish}>{word.english}</span>
                  <div className={styles.wordActions}>
                    <button className={styles.smallButton} onClick={() => setEditingId(word.id)}>Edit</button>
                    <button className={styles.deleteButton} onClick={() => handleDelete(word.id)}>Delete</button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
