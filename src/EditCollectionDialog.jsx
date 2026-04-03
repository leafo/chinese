import { useState } from "react";
import styles from "./index.module.css";
import { useModalDialog } from "./util";

export function EditCollectionDialog({
  collection,
  onSave,
  onDelete,
  onClose,
}) {
  const dialogRef = useModalDialog();
  const [name, setName] = useState(collection.name || '');
  const [notes, setNotes] = useState(collection.notes || '');
  const [objectives, setObjectives] = useState(collection.objectives || '');
  const [deleteArmed, setDeleteArmed] = useState(false);

  const handleSave = async (e) => {
    e.preventDefault();
    await onSave({ id: collection.id, name, notes, objectives });
  };

  const handleDeleteSubmit = async (e) => {
    e.preventDefault();
    if (!deleteArmed) {
      return;
    }
    await onDelete(collection.id);
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
        <h3>Edit Collection</h3>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <div className={styles.modalBody}>
        <form className={styles.form} onSubmit={handleSave}>
          <div className={styles.formField}>
            <label>Collection Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. HSK 1, Food, Travel" required />
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
            <div className={styles.formActionsRight}>
              <button type="button" className={styles.secondaryButton} onClick={onClose}>Cancel</button>
              <button type="submit" className={styles.primaryButton}>Save</button>
            </div>
          </div>
        </form>
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
