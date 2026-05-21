import { useState } from "react";
import styles from "./index.module.css";
import { CollectionSelector } from "./CollectionSelector";
import { audioKey, useAudio, deleteCachedAudio } from "./audio";
import { useModalDialog } from "./util";
import { SentenceAudioButton } from "./SentenceAudioButton";

function SentenceForm({ onSave, onCancel, initial, collections, collectionsLoading, collectionsError }) {
  const [form, setForm] = useState({
    traditional: '',
    simplified: '',
    pinyin: '',
    english: '',
    notes: '',
    collection_ids: [],
    word_ids: [],
    ...initial,
  });

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

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.formRow}>
        <div className={styles.formField}>
          <label>Traditional</label>
          <textarea rows={2} value={form.traditional} onChange={set('traditional')} placeholder="繁體" />
        </div>
        <div className={styles.formField}>
          <label>Simplified</label>
          <textarea rows={2} value={form.simplified} onChange={set('simplified')} placeholder="简体" />
        </div>
      </div>
      <div className={styles.formField}>
        <label>Pinyin</label>
        <textarea rows={2} value={form.pinyin} onChange={set('pinyin')} placeholder="pīnyīn" />
      </div>
      <div className={styles.formField}>
        <label>English</label>
        <textarea rows={2} value={form.english} onChange={set('english')} placeholder="English translation" />
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
      <div className={styles.formActions}>
        <div />
        <div className={styles.formActionsRight}>
          {onCancel && <button type="button" className={styles.secondaryButton} onClick={onCancel}>Cancel</button>}
          <button type="submit" className={styles.primaryButton}>Save</button>
        </div>
      </div>
    </form>
  );
}

function SentenceAudioInfo({ sentence }) {
  const key = sentence.pinyin ? audioKey(sentence.pinyin) : '';
  const [cached] = useAudio(key);

  const date = cached?.createdAt
    ? new Date(cached.createdAt).toLocaleDateString()
    : '—';

  return (
    <div className={styles.audioInfo}>
      <SentenceAudioButton sentence={sentence} />
      <span>{cached?.model || '—'}</span>
      <span>{date}</span>
      {cached && (
        <button
          type="button"
          className={styles.deleteButton}
          onClick={async () => {
            if (confirm('Delete cached audio for this sentence?')) {
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

export function EditSentenceDialog({
  sentence,
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
    await onSave({ ...form, id: sentence.id });
  };

  const handleDeleteSubmit = async (e) => {
    e.preventDefault();
    if (!deleteArmed) {
      return;
    }
    await onDelete(sentence.id);
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
        <h3>Edit Sentence</h3>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <div className={styles.modalBody}>
        <SentenceForm
          initial={sentence}
          onSave={handleSave}
          onCancel={onClose}
          collections={collections}
          collectionsLoading={collectionsLoading}
          collectionsError={collectionsError}
        />
        <div className={styles.audioSection}>
          <h4 className={styles.audioSectionTitle}>Audio Clips</h4>
          <SentenceAudioInfo sentence={sentence} />
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
