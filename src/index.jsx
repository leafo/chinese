import { createRoot } from "react-dom/client";
import { useState } from "react";
import styles from "./index.module.css";
import { useRoute, updateRoute, setRoute } from "./router";
import { useWords, insertWord, deleteWord, updateWord } from "./words";
import { useCollections, insertCollection, deleteCollection } from "./collections";

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
        </nav>
      </div>

      {view === 'words' && <WordList />}
      {view === 'collections' && <CollectionList />}
    </div>
  );
}

const root = createRoot(document.getElementById("root"));
root.render(<App />);
