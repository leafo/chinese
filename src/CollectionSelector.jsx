import styles from "./index.module.css";

export function CollectionSelector({
  collections,
  loading,
  error,
  selectedIds,
  onToggle,
  emptyMessage = 'No collections yet. Create one in the Collections tab.',
}) {
  if (loading) {
    return <p className={styles.formHint}>Loading collections...</p>;
  }

  if (error) {
    return <p className={styles.formHint}>Could not load collections.</p>;
  }

  if (!collections || collections.length === 0) {
    return <p className={styles.formHint}>{emptyMessage}</p>;
  }

  return (
    <div className={styles.collectionPicker}>
      {collections.map((collection) => {
        const checked = (selectedIds || []).includes(collection.id);

        return (
          <label
            key={collection.id}
            className={checked ? styles.collectionOptionSelected : styles.collectionOption}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggle(collection.id)}
            />
            <span>{collection.name}</span>
          </label>
        );
      })}
    </div>
  );
}
