import { useState, useCallback, useRef } from "react";
import styles from "./index.module.css";

const TOAST_DURATION_MS = 2000;

export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);

  const pushToast = useCallback((label, className) => {
    const id = nextId.current++;
    setToasts(prev => [...prev, { id, label, className }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, TOAST_DURATION_MS);
  }, []);

  return [toasts, pushToast];
}

export function ToastStack({ toasts }) {
  if (toasts.length === 0) return null;
  return (
    <div className={styles.toastStack}>
      {toasts.map(t => (
        <div key={t.id} className={`${styles.toast} ${t.className || ''}`}>
          {t.label}
        </div>
      ))}
    </div>
  );
}
