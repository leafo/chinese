import { useEffect, useRef, useState } from "react";
import styles from "./index.module.css";
import { useWords, insertWord, deleteWord, updateWord } from "./words";
import { completeWord } from "./gemini";
import { setRoute } from "./router";
import { playAudio, useAudio } from "./audio";
import { useConfig } from "./config";
import { DEFAULT_DISPLAY_SCRIPT, getPreferredChineseText } from "./display";

function PlayButton({ text }) {
  const [cached] = useAudio(text);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);

  const handlePlay = async () => {
    if (!text) return;
    setLoading(true);
    try {
      const audio = await playAudio(text);
      setPlaying(true);
      audio.addEventListener('ended', () => setPlaying(false), { once: true });
      audio.addEventListener('error', () => setPlaying(false), { once: true });
    } catch (err) {
      console.error('Audio playback failed:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      className={`${styles.smallButton} ${styles.playButton} ${cached ? styles.playButtonCached : ''}`}
      onClick={handlePlay}
      disabled={loading || playing}
      title={cached ? 'Play audio' : 'Generate & play audio'}
    >
      {loading ? '...' : playing ? '\u25A0' : '\u25B6'}
    </button>
  );
}

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
  const [displayScript] = useConfig("display_script");
  const dialogRef = useRef(null);
  const [showForm, setShowForm] = useState(false);
  const [editingWord, setEditingWord] = useState(null);
  const preferredScript = displayScript || DEFAULT_DISPLAY_SCRIPT;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    if (editingWord) {
      if (!dialog.open) {
        dialog.showModal();
      }
      return;
    }

    if (dialog.open) {
      dialog.close();
    }
  }, [editingWord]);

  const handleAdd = async (form) => {
    await insertWord(form);
    setShowForm(false);
  };

  const handleUpdate = async (form) => {
    await updateWord({ ...form, id: editingWord.id });
    setEditingWord(null);
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
        <WordForm onSave={handleAdd} onCancel={() => setShowForm(false)} />
      )}

      {editingWord && (
        <dialog
          ref={dialogRef}
          className={styles.modalDialog}
          onClose={() => setEditingWord(null)}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setEditingWord(null);
            }
          }}
        >
          <div className={styles.modalHeader}>
            <h3>Edit Word</h3>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => setEditingWord(null)}
            >
              Close
            </button>
          </div>
          <WordForm
            initial={editingWord}
            onSave={handleUpdate}
            onCancel={() => setEditingWord(null)}
          />
        </dialog>
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
              onEdit={() => setEditingWord(word)}
              onDelete={() => handleDelete(word.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function WordRow({ word, preferredScript, onEdit, onDelete }) {
  const primaryText = getPreferredChineseText(word, preferredScript);

  return (
    <li className={styles.wordItem}>
      <span className={styles.wordChinese}>{primaryText}</span>
      <span className={styles.wordPinyin}>{word.pinyin}</span>
      <span className={styles.wordEnglish}>{word.english}</span>
      <div className={styles.wordActions}>
        <PlayButton text={primaryText} />
        <button className={styles.smallButton} onClick={onEdit}>Edit</button>
        <button className={styles.deleteButton} onClick={onDelete}>Delete</button>
      </div>
    </li>
  );
}
