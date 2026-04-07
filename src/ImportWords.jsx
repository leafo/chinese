import { useState, useRef, useEffect } from "react";
import styles from "./index.module.css";
import { setRoute } from "./router";
import { insertWord, useAllWords } from "./words";
import { useCollections } from "./collections";
import { CollectionSelector } from "./CollectionSelector";
import { useConfig } from "./config";
import { ApiKeyWarning } from "./ApiKeyWarning";
import { ocrWords } from "./gemini";
import { formatBytes } from "./util";
import { StreamingPreview } from "./StreamingPreview";
import { useWordSelection } from "./useWordSelection";
import { WordPreviewList } from "./WordPreviewList";

export function ImportWords() {
  const fileRef = useRef(null);
  const abortRef = useRef(null);
  const nextImageIdRef = useRef(1);
  const [extractedWords, setExtractedWords] = useState(null);
  const [selectedImages, setSelectedImages] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [collectionIds, setCollectionIds] = useState([]);
  const [additionalInstructions, setAdditionalInstructions] = useState('');
  const [apiKey] = useConfig("gemini_api_key");
  const [collections, collectionsError, collectionsLoading] = useCollections();
  const [existingWords] = useAllWords();

  const {
    setSelected, duplicateMatches, isWordSelected,
    toggleAll, toggleOne, selectedCount,
  } = useWordSelection(extractedWords, existingWords);

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
    setError(null);
    setExtractedWords(null);
    setSelected({});
  };

  const updateField = (index, field, value) => {
    const updated = [...extractedWords];
    updated[index] = { ...updated[index], [field]: value };
    setExtractedWords(updated);
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

  const reset = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSelectedImages([]);
    setExtractedWords(null);
    setSelected({});
    setError(null);
    setProcessing(false);
    setStreamText('');
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

  const selectedImageCount = selectedImages.length;

  return (
    <div>
      <div className={styles.sectionHeader}>
        <h2>Import from Image</h2>
      </div>

      <ApiKeyWarning />

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
              className={styles.primaryButton}
              onClick={handleProcessImages}
              disabled={!selectedImageCount || !apiKey}
            >
              Process {selectedImageCount || ''} Image{selectedImageCount === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      )}

      <StreamingPreview
        active={processing}
        streamText={streamText}
        meta={`Images: ${selectedImageCount}`}
        onCancel={cancelProcessing}
      />

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
              <button className={styles.secondaryButton} onClick={reset}>Start Over</button>
              <button
                className={styles.primaryButton}
                onClick={handleImport}
                disabled={selectedCount === 0 || importing}
              >
                {importing ? 'Adding...' : `Add ${selectedCount} Word${selectedCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>

          <WordPreviewList
            words={extractedWords}
            isWordSelected={isWordSelected}
            onToggle={toggleOne}
            onUpdate={updateField}

            duplicateMatches={duplicateMatches}
          />
        </div>
      )}
    </div>
  );
}
