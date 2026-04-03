import { useState, useMemo } from "react";
import styles from "./index.module.css";
import { setRoute } from "./router";
import { useCollections, insertCollection, updateCollection, deleteCollection } from "./collections";
import { useAllWords } from "./words";
import { EditCollectionDialog } from "./EditCollectionDialog";

function CollectionForm({ onSave, onCancel }) {
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [objectives, setObjectives] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    await onSave({ name, notes, objectives });
    setName('');
    setNotes('');
    setObjectives('');
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.formField}>
        <label>Collection Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. HSK 1, Food, Travel" />
      </div>
      <div className={styles.formField}>
        <label>Notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional info about this collection" rows={2} />
      </div>
      <div className={styles.formField}>
        <label>Objectives</label>
        <textarea value={objectives} onChange={(e) => setObjectives(e.target.value)} placeholder="Learning objectives used to guide sentence generation" rows={3} />
      </div>
      <div className={styles.formActions}>
        <button type="button" className={styles.secondaryButton} onClick={onCancel}>Cancel</button>
        <button type="submit" className={styles.primaryButton}>Add Collection</button>
      </div>
    </form>
  );
}

export function CollectionList() {
  const [collections, error, loading] = useCollections();
  const [words] = useAllWords();
  const [showForm, setShowForm] = useState(false);
  const [editingCollection, setEditingCollection] = useState(null);

  const wordCountByCollection = useMemo(() => {
    const counts = {};
    if (words) {
      for (const word of words) {
        for (const id of (word.collection_ids || [])) {
          counts[id] = (counts[id] || 0) + 1;
        }
      }
    }
    return counts;
  }, [words]);

  const handleAdd = async (form) => {
    await insertCollection(form);
    setShowForm(false);
  };

  const handleSave = async (form) => {
    await updateCollection(form);
    setEditingCollection(null);
  };

  const handleDelete = async (id) => {
    await deleteCollection(id);
    setEditingCollection(null);
  };

  if (loading && !collections) return <p>Loading collections...</p>;
  if (error) return <p>Error loading collections: {error.message}</p>;

  return (
    <div>
      <div className={styles.sectionHeader}>
        <h2>Collections</h2>
        <div className={styles.importToolbarActions}>
          <button className={styles.secondaryButton} onClick={() => setRoute({ view: 'generate-collection' })}>
            Generate
          </button>
          <button className={styles.primaryButton} onClick={() => setShowForm(!showForm)}>
            + Add Collection
          </button>
        </div>
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
              <span className={styles.collectionNameGroup}>
                <a
                  href={`?view=words&collection=${col.id}`}
                  className={styles.collectionName}
                  onClick={(e) => { e.preventDefault(); setRoute({ view: 'words', collection: col.id }); }}
                >{col.name}</a>{col.notes && <span className={styles.collectionNotes}> - {col.notes}</span>}
              </span>
              <span className={styles.collectionWordCount}>{wordCountByCollection[col.id] || 0} words</span>
              <div className={styles.wordActions}>
                <button className={styles.smallButton} style={{ visibility: wordCountByCollection[col.id] ? 'visible' : 'hidden' }} disabled={!wordCountByCollection[col.id]} onClick={() => setRoute({ view: 'learn', collection: col.id })}>Learn</button>
                <button className={styles.smallButton} onClick={() => setEditingCollection(col)}>Edit</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editingCollection && (
        <EditCollectionDialog
          collection={editingCollection}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setEditingCollection(null)}
        />
      )}
    </div>
  );
}
