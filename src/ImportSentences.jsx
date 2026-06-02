import { useState, useEffect, useMemo } from "react";
import styles from "./index.module.css";
import { setRoute } from "./router";
import { useCollections } from "./collections";
import { useAllWords } from "./words";
import { insertSentence, getAllSentences } from "./sentences";
import { CollectionSelector } from "./CollectionSelector";
import { findConnectedWordIds } from "./wordMatching";
import { useConfig } from "./config";
import { DEFAULT_DISPLAY_SCRIPT, getPreferredChineseText } from "./display";

// Module-level store for passing local file data to the import view
let _pendingSentenceData = null;
export function setLocalSentenceImportData(data) {
  _pendingSentenceData = data;
}

export function ImportSentences() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [collections, collectionsError, collectionsLoading] = useCollections();
  const [allWords] = useAllWords();
  const [displayScript] = useConfig("display_script");
  const preferredScript = displayScript || DEFAULT_DISPLAY_SCRIPT;

  const [existingSimplified, setExistingSimplified] = useState(null);
  const [selectedCollectionIds, setSelectedCollectionIds] = useState([]);
  const [collectionDefaulted, setCollectionDefaulted] = useState(false);
  const [selectedIndexes, setSelectedIndexes] = useState(null);
  const [selectionSeeded, setSelectionSeeded] = useState(false);
  const [importing, setImporting] = useState(false);

  // Read the locally-stashed file data once on mount.
  useEffect(() => {
    const pending = _pendingSentenceData;
    _pendingSentenceData = null;
    if (!pending) {
      setError("No file data available. Please choose a file again.");
      return;
    }
    if (pending.format !== "chinese-sentences-export") {
      setError("Invalid sentence file format");
      return;
    }
    setData(pending);
  }, []);

  // Load existing sentences for duplicate detection.
  useEffect(() => {
    getAllSentences()
      .then(list => setExistingSimplified(new Set(list.map(s => s.simplified))))
      .catch(() => setExistingSimplified(new Set()));
  }, []);

  // Default-check the collection whose name matches the file's collection title.
  useEffect(() => {
    if (collectionDefaulted || !data || !collections) return;
    const targetName = (data.collection?.name || "").trim().toLowerCase();
    const match = collections.find(c => (c.name || "").trim().toLowerCase() === targetName);
    setSelectedCollectionIds(match ? [match.id] : []);
    setCollectionDefaulted(true);
  }, [collectionDefaulted, data, collections]);

  // Per-sentence linked word ids and duplicate flags.
  const rows = useMemo(() => {
    if (!data || !allWords || !existingSimplified) return null;
    return (data.sentences || []).map((sentence, index) => ({
      index,
      sentence,
      wordIds: findConnectedWordIds(allWords, sentence.traditional || "", sentence.simplified || ""),
      duplicate: existingSimplified.has(sentence.simplified),
    }));
  }, [data, allWords, existingSimplified]);

  // Seed selection once: all non-duplicate sentences checked.
  useEffect(() => {
    if (selectionSeeded || !rows) return;
    setSelectedIndexes(new Set(rows.filter(r => !r.duplicate).map(r => r.index)));
    setSelectionSeeded(true);
  }, [selectionSeeded, rows]);

  const toggleCollection = (id) => {
    setSelectedCollectionIds(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  const toggleSentence = (index) => {
    setSelectedIndexes(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const allSelected = rows != null && selectedIndexes != null && rows.length > 0
    && rows.every(r => selectedIndexes.has(r.index));

  const toggleAll = () => {
    if (!rows) return;
    setSelectedIndexes(allSelected ? new Set() : new Set(rows.map(r => r.index)));
  };

  const selectedCount = selectedIndexes ? selectedIndexes.size : 0;

  const handleImport = async () => {
    if (!rows) return;
    setImporting(true);
    setError(null);
    try {
      const toImport = rows.filter(r => selectedIndexes.has(r.index));
      for (const row of toImport) {
        await insertSentence({
          simplified: row.sentence.simplified,
          traditional: row.sentence.traditional,
          pinyin: row.sentence.pinyin,
          english: row.sentence.english,
          collection_ids: selectedCollectionIds,
          word_ids: row.wordIds,
        });
      }
      setRoute({ view: "sentences" });
    } catch (err) {
      setError(err.message || String(err));
      setImporting(false);
    }
  };

  if (error) {
    return (
      <div>
        <div className={styles.sectionHeader}>
          <h2>Import Sentences</h2>
        </div>
        <div className={styles.errorBox}>
          <p>{error}</p>
          <button className={styles.smallButton} onClick={() => setRoute({ view: "sentences" })}>
            Back to Sentences
          </button>
        </div>
      </div>
    );
  }

  if (!data || !rows || !selectedIndexes) {
    return (
      <div>
        <div className={styles.sectionHeader}>
          <h2>Import Sentences</h2>
        </div>
        <p>Loading sentences...</p>
      </div>
    );
  }

  const fileCollectionName = data.collection?.name;
  const duplicateCount = rows.filter(r => r.duplicate).length;

  return (
    <div>
      <div className={styles.sectionHeader}>
        <h2>Import Sentences{fileCollectionName ? `: ${fileCollectionName}` : ""}</h2>
      </div>

      <div className={styles.formField}>
        <label>Attach to collections</label>
        <CollectionSelector
          collections={collections}
          loading={collectionsLoading}
          error={collectionsError}
          selectedIds={selectedCollectionIds}
          onToggle={toggleCollection}
        />
        <p className={styles.formHint}>
          {fileCollectionName
            ? `Pre-selected the collection matching "${fileCollectionName}" (if it exists). Adjust as needed.`
            : "Choose which collections to attach the imported sentences to."}
        </p>
      </div>

      {rows.length === 0 ? (
        <div className={styles.emptyState}>
          <p>This file has no sentences.</p>
          <button className={styles.smallButton} onClick={() => setRoute({ view: "sentences" })}>
            Back to Sentences
          </button>
        </div>
      ) : (
        <>
          <div className={styles.importToolbar}>
            <label className={styles.checkboxLabel}>
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              Select All ({selectedCount}/{rows.length})
            </label>
            <div className={styles.importToolbarActions}>
              <button className={styles.secondaryButton} onClick={() => setRoute({ view: "sentences" })}>
                Cancel
              </button>
              <button
                className={styles.primaryButton}
                onClick={handleImport}
                disabled={selectedCount === 0 || importing}
              >
                {importing ? "Importing..." : `Import ${selectedCount} Sentence${selectedCount !== 1 ? "s" : ""}`}
              </button>
            </div>
          </div>

          {duplicateCount > 0 && (
            <p className={styles.formHint}>
              {duplicateCount} sentence{duplicateCount !== 1 ? "s" : ""} already in your library (left unchecked).
            </p>
          )}

          <div className={styles.sentenceList}>
            {rows.map(({ index, sentence, wordIds, duplicate }) => {
              const chineseText = getPreferredChineseText(sentence, preferredScript);
              const checked = selectedIndexes.has(index);
              return (
                <label key={index} className={styles.sentenceCard}>
                  <div className={styles.sentenceMain}>
                    <input type="checkbox" checked={checked} onChange={() => toggleSentence(index)} />
                    <div className={styles.sentenceContent}>
                      <div className={styles.sentenceChinese}>
                        <span>{chineseText}</span>
                        {duplicate && <span className={styles.tag}>duplicate</span>}
                      </div>
                      {sentence.pinyin && <div className={styles.sentencePinyin}>{sentence.pinyin}</div>}
                      {sentence.english && <div className={styles.sentenceEnglish}>{sentence.english}</div>}
                      <p className={styles.formHint}>
                        {wordIds.length} word{wordIds.length !== 1 ? "s" : ""} linked
                      </p>
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
