import styles from "./index.module.css";
import { useElapsedTimer } from "./useElapsedTimer";

export function StreamingPreview({ active, streamText, meta, onCancel }) {
  const elapsedMs = useElapsedTimer(active);

  if (!active) return null;

  const elapsedSeconds = (elapsedMs / 1000).toFixed(1);
  const streamStatus = streamText
    ? 'Streaming structured JSON from Gemini...'
    : 'Waiting for the first JSON chunk...';

  return (
    <div className={styles.processingState}>
      <p>{streamStatus}</p>
      <div className={styles.processingMeta}>
        {meta && <span>{meta}</span>}
        <span>Elapsed: {elapsedSeconds}s</span>
        <span>Received: {streamText.length.toLocaleString()} chars</span>
      </div>
      <pre className={styles.streamOutput}>
        {streamText || '{\n  ...\n}'}
      </pre>
      <div className={styles.processingActions}>
        <button className={styles.secondaryButton} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
