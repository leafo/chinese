import { useState, useMemo, useRef } from "react";
import styles from "./index.module.css";
import { setRoute } from "./router";
import { setLocalSentenceImportData } from "./ImportSentences";
import { useSentences, insertSentence, updateSentence, deleteSentence } from "./sentences";
import { useCollections } from "./collections";
import { useAllWords } from "./words";
import { useConfig } from "./config";
import { DEFAULT_DISPLAY_SCRIPT, getPreferredChineseText } from "./display";
import { SentenceAudioButton } from "./SentenceAudioButton";
import { EditSentenceDialog, SentenceForm } from "./EditSentenceDialog";

export function SentenceList() {
  const [sentences, error, loading] = useSentences(200, 0);
  const [collections, collectionsError, collectionsLoading] = useCollections();
  const [allWords] = useAllWords();
  const [displayScript] = useConfig("display_script");
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const fileInputRef = useRef(null);
  const preferredScript = displayScript || DEFAULT_DISPLAY_SCRIPT;

  const handleFileImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(evt.target.result);
        setLocalSentenceImportData(parsed);
        setRoute({ view: 'import-sentences', source: 'local' });
      } catch {
        alert('Failed to parse JSON file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const collectionNamesById = useMemo(
    () => Object.fromEntries((collections || []).map(c => [c.id, c.name])),
    [collections]
  );
  const wordsById = useMemo(
    () => Object.fromEntries((allWords || []).map(w => [w.id, w])),
    [allWords]
  );

  const handleAdd = async (form) => {
    await insertSentence(form);
    setShowForm(false);
  };

  const handleUpdate = async (form) => {
    await updateSentence(form);
    setEditing(null);
  };

  const handleDelete = async (id) => {
    await deleteSentence(id);
    setEditing(current => (current?.id === id ? null : current));
  };

  if (loading && !sentences) return <p>Loading sentences...</p>;
  if (error) return <p>Error loading sentences: {error.message}</p>;

  return (
    <div>
      <div className={styles.sectionHeader}>
        <h2>Saved Sentences</h2>
        <div className={styles.importToolbarActions}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className={styles.hiddenFileInput}
            onChange={handleFileImport}
          />
          <button className={styles.secondaryButton} onClick={() => fileInputRef.current?.click()}>
            Import
          </button>
          <button className={styles.secondaryButton} onClick={() => setRoute({ view: 'generate-sentences' })}>
            Generate
          </button>
          <button className={styles.primaryButton} onClick={() => setShowForm(!showForm)}>
            + Add Sentence
          </button>
        </div>
      </div>

      {showForm && (
        <SentenceForm
          onSave={handleAdd}
          onCancel={() => setShowForm(false)}
          collections={collections || []}
          collectionsLoading={collectionsLoading}
          collectionsError={collectionsError}
          allWords={allWords || []}
          preferredScript={preferredScript}
        />
      )}

      {editing && (
        <EditSentenceDialog
          key={editing.id}
          sentence={editing}
          onSave={handleUpdate}
          onDelete={handleDelete}
          onClose={() => setEditing(null)}
          collections={collections || []}
          collectionsLoading={collectionsLoading}
          collectionsError={collectionsError}
          allWords={allWords || []}
          preferredScript={preferredScript}
        />
      )}

      {(!sentences || sentences.length === 0) ? (
        <div className={styles.emptyState}>
          <p>No saved sentences yet</p>
          <p>Generate sentences and click Save to add them here</p>
        </div>
      ) : (
        <div className={styles.sentenceList}>
          {sentences.map(sentence => (
            <SentenceRow
              key={sentence.id}
              sentence={sentence}
              preferredScript={preferredScript}
              collectionNamesById={collectionNamesById}
              wordsById={wordsById}
              onEdit={() => setEditing(sentence)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SentenceRow({ sentence, preferredScript, collectionNamesById, wordsById, onEdit }) {
  const chineseText = getPreferredChineseText(sentence, preferredScript);
  const collectionNames = (sentence.collection_ids || [])
    .map(id => collectionNamesById[id])
    .filter(Boolean);
  const words = (sentence.word_ids || [])
    .map(id => wordsById[id])
    .filter(Boolean);

  return (
    <div className={styles.sentenceCard}>
      <div className={styles.sentenceMain}>
        <div className={styles.sentenceContent}>
          <div className={styles.sentenceChinese}>
            <SentenceAudioButton sentence={sentence} />
            <span>{chineseText}</span>
          </div>
          {sentence.pinyin && <div className={styles.sentencePinyin}>{sentence.pinyin}</div>}
          {sentence.english && <div className={styles.sentenceEnglish}>{sentence.english}</div>}
          {words.length > 0 && (
            <div className={styles.sentenceWordsUsed}>
              {words.map(w => (
                <span key={w.id} className={styles.tag} title={w.pinyin}>
                  {getPreferredChineseText(w, preferredScript)}
                </span>
              ))}
            </div>
          )}
          {collectionNames.length > 0 && (
            <div className={styles.tags}>
              {collectionNames.map(name => (
                <span key={name} className={styles.tag}>{name}</span>
              ))}
            </div>
          )}
        </div>
        <div className={styles.sentenceCardActions}>
          <button type="button" className={styles.smallButton} onClick={onEdit}>Edit</button>
        </div>
      </div>
    </div>
  );
}
