import { createRoot } from "react-dom/client";
import { useState, useRef, useEffect } from "react";
import styles from "./index.module.css";
import { useRoute, updateRoute, setRoute } from "./router";
import { useWords, insertWord, deleteWord, updateWord } from "./words";
import { useCollections, insertCollection, deleteCollection } from "./collections";
import { useConfig } from "./config";
import { ocrWords } from "./gemini";

function WordForm({ onSave, onCancel, initial }) {
  const [form, setForm] = useState(initial || {
    traditional: '',
    simplified: '',
    pinyin: '',
    english: '',
    notes: '',
  });

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    await onSave(form);
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
      <div className={styles.formActions}>
        {onCancel && <button type="button" className={styles.cancelButton} onClick={onCancel}>Cancel</button>}
        <button type="submit" className={styles.addButton}>{initial ? 'Save' : 'Add Word'}</button>
      </div>
    </form>
  );
}

function WordList() {
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

function CollectionForm({ onSave, onCancel }) {
  const [name, setName] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    await onSave({ name });
    setName('');
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.formField}>
        <label>Collection Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. HSK 1, Food, Travel" />
      </div>
      <div className={styles.formActions}>
        <button type="button" className={styles.cancelButton} onClick={onCancel}>Cancel</button>
        <button type="submit" className={styles.addButton}>Add Collection</button>
      </div>
    </form>
  );
}

function CollectionList() {
  const [collections, error, loading] = useCollections();
  const [showForm, setShowForm] = useState(false);

  const handleAdd = async (form) => {
    await insertCollection(form);
    setShowForm(false);
  };

  const handleDelete = async (id) => {
    await deleteCollection(id);
  };

  if (loading) return <p>Loading collections...</p>;
  if (error) return <p>Error loading collections: {error.message}</p>;

  return (
    <div>
      <div className={styles.sectionHeader}>
        <h2>Collections</h2>
        <button className={styles.addButton} onClick={() => setShowForm(!showForm)}>
          + Add Collection
        </button>
      </div>

      {showForm && (
        <CollectionForm onSave={handleAdd} onCancel={() => setShowForm(false)} />
      )}

      {(!collections || collections.length === 0) ? (
        <div className={styles.emptyState}>
          <p>No collections yet</p>
          <p>Create collections to organize your words</p>
        </div>
      ) : (
        <ul className={styles.collectionList}>
          {collections.map(col => (
            <li key={col.id} className={styles.collectionItem}>
              <span className={styles.collectionName}>{col.name}</span>
              <div className={styles.wordActions}>
                <button className={styles.deleteButton} onClick={() => handleDelete(col.id)}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ImportWords() {
  const fileRef = useRef(null);
  const [extractedWords, setExtractedWords] = useState(null);
  const [selected, setSelected] = useState({});
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [apiKey] = useConfig("gemini_api_key");

  const processFile = async (file) => {
    setProcessing(true);
    setError(null);
    setExtractedWords(null);

    try {
      const result = await ocrWords(file);
      setExtractedWords(result.words);
      const sel = {};
      result.words.forEach((_, i) => { sel[i] = true; });
      setSelected(sel);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setProcessing(false);
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    processFile(file);
  };

  useEffect(() => {
    const handlePaste = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          processFile(item.getAsFile());
          return;
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  const toggleAll = () => {
    const allSelected = extractedWords.every((_, i) => selected[i]);
    const sel = {};
    extractedWords.forEach((_, i) => { sel[i] = !allSelected; });
    setSelected(sel);
  };

  const toggleOne = (index) => {
    setSelected({ ...selected, [index]: !selected[index] });
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
      newSelected[i] = selected[oldIndex] ?? true;
    });
    setExtractedWords(updated);
    setSelected(newSelected);
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      for (let i = 0; i < extractedWords.length; i++) {
        if (selected[i]) {
          await insertWord(extractedWords[i]);
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
    ? extractedWords.filter((_, i) => selected[i]).length
    : 0;

  const reset = () => {
    setExtractedWords(null);
    setSelected({});
    setError(null);
    if (fileRef.current) fileRef.current.value = '';
  };

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
          <p>Take a photo, select an image, or paste (Ctrl+V) a screenshot to extract words.</p>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
            className={styles.fileInput}
          />
        </div>
      )}

      {processing && (
        <div className={styles.processingState}>
          <p>Extracting words from image...</p>
        </div>
      )}

      {error && (
        <div className={styles.errorBox}>
          <p>{error}</p>
          <button className={styles.smallButton} onClick={reset}>Try Again</button>
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
          <div className={styles.importToolbar}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={extractedWords.every((_, i) => selected[i])}
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
              <li key={index} className={`${styles.importItem} ${!selected[index] ? styles.importItemDeselected : ''}`}>
                <input
                  type="checkbox"
                  checked={!!selected[index]}
                  onChange={() => toggleOne(index)}
                  className={styles.importCheckbox}
                />
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
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Settings() {
  const [apiKey, setApiKey, loading] = useConfig("gemini_api_key");
  const [inputValue, setInputValue] = useState('');
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!loading && !dirty) {
      setInputValue(apiKey || '');
    }
  }, [apiKey, loading, dirty]);

  const handleSave = async (e) => {
    e.preventDefault();
    await setApiKey(inputValue);
    setDirty(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div>
      <div className={styles.sectionHeader}>
        <h2>Settings</h2>
      </div>
      <form className={styles.form} onSubmit={handleSave}>
        <div className={styles.formField}>
          <label>Gemini API Key</label>
          <input
            type="password"
            value={inputValue}
            onChange={(e) => {
              setDirty(true);
              setInputValue(e.target.value);
            }}
            placeholder="Enter your Gemini API key"
          />
        </div>
        <div className={styles.formActions}>
          <button type="submit" className={styles.addButton}>
            {saved ? 'Saved!' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}

function App() {
  const route = useRoute(['view']);
  const view = route.view || 'words';

  return (
    <div className={styles.app}>
      <div className={styles.header}>
        <h1>Chinese</h1>
        <nav className={styles.nav}>
          <button
            className={view === 'words' ? styles.navButtonActive : styles.navButton}
            onClick={() => setRoute({ view: 'words' })}
          >
            Words
          </button>
          <button
            className={view === 'collections' ? styles.navButtonActive : styles.navButton}
            onClick={() => setRoute({ view: 'collections' })}
          >
            Collections
          </button>
          <button
            className={view === 'import' ? styles.navButtonActive : styles.navButton}
            onClick={() => setRoute({ view: 'import' })}
          >
            Import
          </button>
          <button
            className={view === 'settings' ? styles.navButtonActive : styles.navButton}
            onClick={() => setRoute({ view: 'settings' })}
          >
            Settings
          </button>
        </nav>
      </div>

      {view === 'words' && <WordList />}
      {view === 'collections' && <CollectionList />}
      {view === 'import' && <ImportWords />}
      {view === 'settings' && <Settings />}
    </div>
  );
}

const root = createRoot(document.getElementById("root"));
root.render(<App />);
