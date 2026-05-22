import { useState } from "react";
import styles from "./index.module.css";
import { CollectionSelector } from "./CollectionSelector";
import { audioKey, useAudio, deleteCachedAudio } from "./audio";
import { completeSentence } from "./gemini";
import { PinyinInput } from "./PinyinInput";
import { useModalDialog } from "./util";
import { SentenceAudioButton } from "./SentenceAudioButton";
import { getPreferredChineseText } from "./display";
import { wordMatchesQuery } from "./wordSearch";

const AUDIO_KEY_DISPLAY_LENGTH = 32;

function truncateAudioKey(key) {
  if (!key || key.length <= AUDIO_KEY_DISPLAY_LENGTH) return key || '—';
  return `${key.slice(0, AUDIO_KEY_DISPLAY_LENGTH)}...`;
}

function buildWordIndex(words, script) {
  const byText = new Map();
  let maxLen = 0;
  for (const word of words) {
    const text = word[script];
    if (!text) continue;
    if (!byText.has(text)) byText.set(text, word);
    if (text.length > maxLen) maxLen = text.length;
  }
  return { byText, maxLen };
}

// Forward maximum matching: walk the text and, at each position, take the
// longest word that matches before advancing, so nested words are skipped.
function matchWordIds(text, index) {
  const ids = [];
  if (!text) return ids;
  let i = 0;
  while (i < text.length) {
    let matched = false;
    for (let len = Math.min(index.maxLen, text.length - i); len >= 1; len--) {
      const word = index.byText.get(text.slice(i, i + len));
      if (word) {
        ids.push(word.id);
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) i += 1;
  }
  return ids;
}

function findConnectedWordIds(words, traditional, simplified) {
  const ids = new Set();
  for (const id of matchWordIds(traditional, buildWordIndex(words, 'traditional'))) ids.add(id);
  for (const id of matchWordIds(simplified, buildWordIndex(words, 'simplified'))) ids.add(id);
  return [...ids];
}

function ConnectedWordsField({
  allWords,
  preferredScript,
  selectedIds,
  sentenceTraditional,
  sentenceSimplified,
  onAdd,
  onAddMany,
  onRemove,
}) {
  const [query, setQuery] = useState('');
  const [autoMessage, setAutoMessage] = useState(null);
  const selectedIdSet = new Set(selectedIds || []);
  const words = allWords || [];
  const selectedWords = (selectedIds || [])
    .map(id => words.find(word => word.id === id))
    .filter(Boolean);

  const availableWords = query.trim()
    ? words
        .filter(word => !selectedIdSet.has(word.id))
        .filter(word => wordMatchesQuery(word, query))
        .slice(0, 8)
    : [];

  const handleAuto = () => {
    const ids = findConnectedWordIds(words, sentenceTraditional, sentenceSimplified);
    const newIds = ids.filter(id => !selectedIdSet.has(id));
    if (newIds.length > 0) {
      onAddMany(newIds);
      setAutoMessage(`Added ${newIds.length} word${newIds.length === 1 ? '' : 's'}.`);
    } else {
      setAutoMessage('No new words found.');
    }
  };
  const autoDisabled = words.length === 0 || (!sentenceTraditional && !sentenceSimplified);

  return (
    <div className={styles.formField}>
      <div className={styles.connectedWordsHeader}>
        <label>Connected Words</label>
        <button
          type="button"
          className={styles.smallButton}
          onClick={handleAuto}
          disabled={autoDisabled}
        >
          Auto
        </button>
      </div>
      {autoMessage && <p className={styles.formHint}>{autoMessage}</p>}
      {selectedWords.length > 0 ? (
        <table className={styles.connectedWordsTable}>
          <thead>
            <tr>
              <th>Chinese</th>
              <th>Pinyin</th>
              <th>Translation</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {selectedWords.map(word => (
              <tr key={word.id}>
                <td className={styles.connectedWordsTableChinese}>
                  {getPreferredChineseText(word, preferredScript)}
                </td>
                <td>{word.pinyin || '—'}</td>
                <td>{word.english || '—'}</td>
                <td className={styles.connectedWordsTableActions}>
                  <button
                    type="button"
                    className={styles.deleteButton}
                    onClick={() => onRemove(word.id)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className={styles.formHint}>No connected words yet.</p>
      )}
      <div className={styles.connectedWordSearch}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search words to connect"
        />
        {availableWords.length > 0 && (
          <div className={styles.connectedWordResults}>
            {availableWords.map(word => (
              <button
                key={word.id}
                type="button"
                className={styles.smallButton}
                onClick={() => {
                  onAdd(word.id);
                  setQuery('');
                }}
              >
                {getPreferredChineseText(word, preferredScript)}
                {word.pinyin ? ` · ${word.pinyin}` : ''}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SentenceForm({
  onSave,
  onCancel,
  initial,
  collections,
  collectionsLoading,
  collectionsError,
  allWords,
  preferredScript,
}) {
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
  const addWord = (wordId) => {
    setForm(prev => ({
      ...prev,
      word_ids: [...new Set([...(prev.word_ids || []), wordId])],
    }));
  };
  const addWords = (wordIds) => {
    setForm(prev => ({
      ...prev,
      word_ids: [...new Set([...(prev.word_ids || []), ...wordIds])],
    }));
  };
  const removeWord = (wordId) => {
    setForm(prev => ({
      ...prev,
      word_ids: (prev.word_ids || []).filter(id => id !== wordId),
    }));
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
      const result = await completeSentence(form);
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
          <textarea rows={2} value={form.traditional} onChange={set('traditional')} placeholder="繁體" />
        </div>
        <div className={styles.formField}>
          <label>Simplified</label>
          <textarea rows={2} value={form.simplified} onChange={set('simplified')} placeholder="简体" />
        </div>
      </div>
      <div className={styles.formField}>
        <label>Pinyin</label>
        <PinyinInput value={form.pinyin} onChange={set('pinyin')} placeholder="pīnyīn" withHelp />
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
      <ConnectedWordsField
        allWords={allWords}
        preferredScript={preferredScript}
        selectedIds={form.word_ids || []}
        sentenceTraditional={form.traditional}
        sentenceSimplified={form.simplified}
        onAdd={addWord}
        onAddMany={addWords}
        onRemove={removeWord}
      />
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
      <span title={key || undefined}>{truncateAudioKey(key)}</span>
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
  allWords,
  preferredScript,
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
          collections={collections}
          collectionsLoading={collectionsLoading}
          collectionsError={collectionsError}
          allWords={allWords}
          preferredScript={preferredScript}
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
