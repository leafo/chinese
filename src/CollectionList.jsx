import { useState } from "react";
import styles from "./index.module.css";
import { useCollections, insertCollection, deleteCollection } from "./collections";

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

export function CollectionList() {
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
