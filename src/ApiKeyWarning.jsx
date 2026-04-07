import styles from "./index.module.css";
import { setRoute } from "./router";
import { useConfig } from "./config";

export function ApiKeyWarning() {
  const [apiKey] = useConfig("gemini_api_key");

  if (apiKey) return null;

  return (
    <div className={styles.warningBox}>
      Gemini API key not set. This feature requires an LLM API key to function.{' '}
      <button className={styles.linkButton} onClick={() => setRoute({ view: 'settings' })}>
        Go to Settings
      </button>
    </div>
  );
}
