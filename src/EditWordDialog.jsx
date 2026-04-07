import { useEffect, useRef, useState } from "react";
import styles from "./index.module.css";
import { CollectionSelector } from "./CollectionSelector";
import { completeWord } from "./gemini";
import { PinyinInput } from "./PinyinInput";
import { PlayButton } from "./PlayButton";
import { useAudio, deleteCachedAudio, audioKey } from "./audio";
import { useModalDialog } from "./util";

export function WordForm({ onSave, onCancel, initial, collections, collectionsLoading, collectionsError }) {
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
          <PinyinInput value={form.pinyin} onChange={set('pinyin')} placeholder="pīnyīn" withHelp />
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
          {onCancel && <button type="button" className={styles.secondaryButton} onClick={onCancel}>Cancel</button>}
          <button type="submit" className={styles.primaryButton}>{initial ? 'Save' : 'Add Word'}</button>
        </div>
      </div>
    </form>
  );
}

function AudioInfo({ word }) {
  const key = audioKey(word.pinyin);
  const [cached] = useAudio(key);

  const date = cached?.createdAt
    ? new Date(cached.createdAt).toLocaleDateString()
    : '—';

  return (
    <div className={styles.audioInfo}>
      <PlayButton word={word} />
      <span>{word.pinyin}</span>
      <span>{cached?.model || '—'}</span>
      <span>{date}</span>
      {cached && (
        <button
          type="button"
          className={styles.deleteButton}
          onClick={async () => {
            if (confirm(`Delete cached audio for "${word.pinyin}"?`)) {
              await deleteCachedAudio(key);
            }
          }}
        >
          Delete
        </button>
      )}
    </div>
  );
}

export function EditWordDialog({
  word,
  onSave,
  onDelete,
  onClose,
  collections,
  collectionsLoading,
  collectionsError,
}) {
  const dialogRef = useModalDialog();
  const [deleteArmed, setDeleteArmed] = useState(false);

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
          className={styles.secondaryButton}
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
        <div className={styles.audioSection}>
          <h4 className={styles.audioSectionTitle}>Audio Clips</h4>
          <AudioInfo word={word} />
        </div>
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
