import { useState, useRef, useEffect, useMemo } from "react";
import styles from "./index.module.css";
import { setRoute } from "./router";
import { insertWord, useAllWords } from "./words";
import { useCollections } from "./collections";
import { CollectionSelector } from "./CollectionSelector";
import { useConfig } from "./config";
import { ocrWords } from "./gemini";
import { formatBytes } from "./util";

function normalizeText(value) {
  return value?.trim() || '';
}

function buildExistingWordsMap(existingWords) {
  const map = new Map();
  for (const word of existingWords) {
    const s = normalizeText(word.simplified);
    const t = normalizeText(word.traditional);
    if (s && !map.has(s)) map.set(s, word);
    if (t && !map.has(t)) map.set(t, word);
  }
  return map;
}

function getPossibleDuplicate(word, existingWordsMap) {
  const simplified = normalizeText(word.simplified);
  const traditional = normalizeText(word.traditional);

  if (!simplified && !traditional) {
    return null;
  }

  return (simplified && existingWordsMap.get(simplified)) ||
    (traditional && existingWordsMap.get(traditional)) ||
    null;
}

function formatDuplicateSummary(word) {
  const parts = [
    normalizeText(word.simplified) || normalizeText(word.traditional),
    normalizeText(word.pinyin),
    normalizeText(word.english),
  ].filter(Boolean);

  return parts.join(' | ');
}

export function ImportWords() {
  const fileRef = useRef(null);
  const abortRef = useRef(null);
  const nextImageIdRef = useRef(1);
  const [extractedWords, setExtractedWords] = useState(null);
  const [selected, setSelected] = useState({});
  const [selectedImages, setSelectedImages] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [collectionIds, setCollectionIds] = useState([]);
  const [additionalInstructions, setAdditionalInstructions] = useState('');
  const [apiKey] = useConfig("gemini_api_key");
  const [collections, collectionsError, collectionsLoading] = useCollections();
  const [existingWords] = useAllWords();

  useEffect(() => {
    if (!processing) {
      return;
    }

    const startedAt = Date.now();
    setElapsedMs(0);

    const interval = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 250);

    return () => window.clearInterval(interval);
  }, [processing]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const queueImages = (files) => {
    const imageFiles = files.filter((file) => file?.type?.startsWith('image/'));
    if (!imageFiles.length) {
      return;
    }

    setError(null);
    setSelectedImages((currentImages) => [
      ...currentImages,
      ...imageFiles.map((file) => ({
        id: nextImageIdRef.current++,
        file,
        name: file.name || `Image ${nextImageIdRef.current - 1}`,
        size: file.size || 0,
      })),
    ]);
  };

  const processImages = async (images) => {
    if (!images.length) {
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setProcessing(true);
    setError(null);
    setExtractedWords(null);
    setSelected({});
    setCollectionIds([]);
    setStreamText('');
    setElapsedMs(0);

    try {
      const result = await ocrWords(images.map(({ file }) => file), {
        signal: controller.signal,
        additionalInstructions,
        onChunk: (_chunk, fullText) => {
          setStreamText(fullText);
        },
      });

      if (abortRef.current !== controller || controller.signal.aborted) {
        return;
      }

      setExtractedWords(result.words);
      setSelected({});
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }
      setError(err.message || String(err));
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setProcessing(false);
      }
    }
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    queueImages(files);
    if (fileRef.current) {
      fileRef.current.value = '';
    }
  };

  useEffect(() => {
    const handlePaste = (e) => {
      if (processing || extractedWords) {
        return;
      }

      const items = e.clipboardData?.items;
      if (!items) return;
      const pastedFiles = [];

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            pastedFiles.push(file);
          }
        }
      }

      if (!pastedFiles.length) {
        return;
      }

      e.preventDefault();
      queueImages(pastedFiles);
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [extractedWords, processing]);

  const cancelProcessing = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setProcessing(false);
    setStreamText('');
    setElapsedMs(0);
    setError(null);
    setExtractedWords(null);
    setSelected({});
  };

  const existingWordsMap = useMemo(
    () => buildExistingWordsMap(existingWords || []),
    [existingWords]
  );

  const duplicateMatches = useMemo(
    () => extractedWords?.map((word) => getPossibleDuplicate(word, existingWordsMap)) || [],
    [extractedWords, existingWordsMap]
  );

  const isWordSelected = (index) => (
    index in selected ? selected[index] : !duplicateMatches[index]
  );

  const toggleAll = () => {
    const allSelected = extractedWords.every((_, i) => isWordSelected(i));
    const sel = {};
    extractedWords.forEach((_, i) => { sel[i] = !allSelected; });
    setSelected(sel);
  };

  const toggleOne = (index) => {
    setSelected({ ...selected, [index]: !isWordSelected(index) });
  };

  const updateField = (index, field, value) => {
    const updated = [...extractedWords];
    updated[index] = { ...updated[index], [field]: value };
    setExtractedWords(updated);
  };

  const removeWord = (index) => {
    const updated = extractedWords.filter((_, i) => i !== index);
    const newSelected = {};
    updated.forEach((_, i) => {
      const oldIndex = i >= index ? i + 1 : i;
      if (oldIndex in selected) {
        newSelected[i] = selected[oldIndex];
      }
    });
    setExtractedWords(updated);
    setSelected(newSelected);
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      for (let i = 0; i < extractedWords.length; i++) {
        if (isWordSelected(i)) {
          await insertWord({
            ...extractedWords[i],
            collection_ids: [...(extractedWords[i].collection_ids || []), ...collectionIds],
          });
        }
      }
      setRoute({ view: 'words' });
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setImporting(false);
    }
  };

  const selectedCount = extractedWords
    ? extractedWords.filter((_, i) => isWordSelected(i)).length
    : 0;

  const reset = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSelectedImages([]);
    setExtractedWords(null);
    setSelected({});
    setError(null);
    setProcessing(false);
    setStreamText('');
    setElapsedMs(0);
    setCollectionIds([]);
    if (fileRef.current) fileRef.current.value = '';
  };

  const removeSelectedImage = (imageId) => {
    setSelectedImages((currentImages) => currentImages.filter((image) => image.id !== imageId));
  };

  const handleProcessImages = () => {
    processImages(selectedImages);
  };

  const toggleCollection = (collectionId) => {
    setCollectionIds((currentIds) => (
      currentIds.includes(collectionId)
        ? currentIds.filter(id => id !== collectionId)
        : [...currentIds, collectionId]
    ));
  };

  const elapsedSeconds = (elapsedMs / 1000).toFixed(1);
  const streamStatus = streamText
    ? 'Streaming structured JSON from Gemini...'
    : 'Uploading image and waiting for the first JSON chunk...';
  const selectedImageCount = selectedImages.length;

  return (
    <div>
      <div className={styles.sectionHeader}>
        <h2>Import from Image</h2>
      </div>

      {!apiKey && (
        <div className={styles.warningBox}>
          Gemini API key not set.{' '}
          <button className={styles.linkButton} onClick={() => setRoute({ view: 'settings' })}>
            Go to Settings
          </button>
        </div>
      )}

      {!extractedWords && !processing && (
        <div className={styles.importUpload}>
          <div className={styles.importUploadHeader}>
            <p>Select one or more images, or paste screenshots, then submit the batch for extraction.</p>
          </div>
          <div className={styles.importUploadOptions}>
            <div className={styles.formField}>
              <label htmlFor="bulk-import-additional-instructions">Additional Instructions</label>
              <textarea
                id="bulk-import-additional-instructions"
                value={additionalInstructions}
                onChange={(e) => setAdditionalInstructions(e.target.value)}
                placeholder="Optional guidance for Gemini, such as textbook conventions, expected formatting, or what to ignore."
                rows={4}
              />
              <p className={styles.fieldHint}>
                Leave blank to use the standard extraction prompt with no changes.
              </p>
            </div>
            <div className={styles.importUploadQueue}>
              <div className={styles.importUploadQueueHeader}>
                <strong>{selectedImageCount} image{selectedImageCount !== 1 ? 's' : ''} selected</strong>
                {selectedImageCount > 0 && (
                  <button className={styles.smallButton} onClick={() => setSelectedImages([])}>
                    Clear Images
                  </button>
                )}
              </div>
              {selectedImageCount > 0 ? (
                <ul className={styles.importUploadImageList}>
                  {selectedImages.map((image) => (
                    <li key={image.id} className={styles.importUploadImageItem}>
                      <div className={styles.importUploadImageMeta}>
                        <span className={styles.importUploadImageName}>{image.name}</span>
                        <span className={styles.importUploadImageSize}>
                          {formatBytes(image.size)}
                        </span>
                      </div>
                      <button className={styles.deleteButton} onClick={() => removeSelectedImage(image.id)}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.fieldHint}>
                  No images queued yet. Use the file picker or paste one or more screenshots.
                </p>
              )}
            </div>
          </div>
          <div className={styles.importUploadActions}>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={handleFileChange}
              className={styles.fileInput}
            />
            <button
              className={styles.addButton}
              onClick={handleProcessImages}
              disabled={!selectedImageCount || !apiKey}
            >
              Process {selectedImageCount || ''} Image{selectedImageCount === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      )}

      {processing && (
        <div className={styles.processingState}>
          <p>{streamStatus}</p>
          <div className={styles.processingMeta}>
            <span>Images: {selectedImageCount}</span>
            <span>Elapsed: {elapsedSeconds}s</span>
            <span>Received: {streamText.length.toLocaleString()} chars</span>
          </div>
          <pre className={styles.streamOutput}>
            {streamText || '{\n  "words": [\n    ...waiting for first chunk\n  ]\n}'}
          </pre>
          <div className={styles.processingActions}>
            <button className={styles.cancelButton} onClick={cancelProcessing}>Cancel</button>
          </div>
        </div>
      )}

      {error && (
        <div className={styles.errorBox}>
          <p>{error}</p>
          <button
            className={styles.smallButton}
            onClick={selectedImageCount && !extractedWords ? () => setError(null) : reset}
          >
            {selectedImageCount && !extractedWords ? 'Dismiss' : 'Try Again'}
          </button>
        </div>
      )}

      {extractedWords && extractedWords.length === 0 && (
        <div className={styles.emptyState}>
          <p>No words found in the image</p>
          <button className={styles.smallButton} onClick={reset}>Try Another Image</button>
        </div>
      )}

      {extractedWords && extractedWords.length > 0 && (
        <div>
          <div className={styles.form}>
            <div className={styles.formField}>
              <label>Collections for Imported Words</label>
              <CollectionSelector
                collections={collections || []}
                loading={collectionsLoading}
                error={collectionsError}
                selectedIds={collectionIds}
                onToggle={toggleCollection}
                emptyMessage="No collections yet. Create one in the Collections tab before importing."
              />
            </div>
          </div>
          <div className={styles.importToolbar}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={extractedWords.every((_, i) => isWordSelected(i))}
                onChange={toggleAll}
              />
              Select All ({selectedCount}/{extractedWords.length})
            </label>
            <div className={styles.importToolbarActions}>
              <button className={styles.cancelButton} onClick={reset}>Start Over</button>
              <button
                className={styles.addButton}
                onClick={handleImport}
                disabled={selectedCount === 0 || importing}
              >
                {importing ? 'Adding...' : `Add ${selectedCount} Word${selectedCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>

          <ul className={styles.importList}>
            {extractedWords.map((word, index) => (
              <li key={index} className={`${styles.importItem} ${!isWordSelected(index) ? styles.importItemDeselected : ''}`}>
                <input
                  type="checkbox"
                  checked={isWordSelected(index)}
                  onChange={() => toggleOne(index)}
                  className={styles.importCheckbox}
                />
                <div className={styles.importContent}>
                  <div className={styles.importFields}>
                    <input
                      className={styles.importFieldChinese}
                      value={word.simplified || ''}
                      onChange={(e) => updateField(index, 'simplified', e.target.value)}
                      placeholder="简体"
                    />
                    <input
                      className={styles.importFieldSmall}
                      value={word.traditional || ''}
                      onChange={(e) => updateField(index, 'traditional', e.target.value)}
                      placeholder="繁體"
                    />
                    <input
                      className={styles.importFieldSmall}
                      value={word.pinyin || ''}
                      onChange={(e) => updateField(index, 'pinyin', e.target.value)}
                      placeholder="pīnyīn"
                    />
                    <input
                      className={styles.importFieldWide}
                      value={word.english || ''}
                      onChange={(e) => updateField(index, 'english', e.target.value)}
                      placeholder="English"
                    />
                    <button
                      className={styles.deleteButton}
                      onClick={() => removeWord(index)}
                      title="Remove"
                    >
                      &times;
                    </button>
                  </div>
                  {duplicateMatches[index] && (
                    <div className={styles.importStatusRow}>
                      Possible duplicate: {formatDuplicateSummary(duplicateMatches[index])}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
