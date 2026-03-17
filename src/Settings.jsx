import { useState, useEffect } from "react";
import styles from "./index.module.css";
import { useConfig } from "./config";
import { DEFAULT_DISPLAY_SCRIPT } from "./display";

export function Settings() {
  const [apiKey, setApiKey, apiKeyLoading] = useConfig("gemini_api_key");
  const [displayScript, setDisplayScript] = useConfig("display_script");
  const [apiKeyValue, setApiKeyValue] = useState('');
  const [displayScriptValue, setDisplayScriptValue] = useState(DEFAULT_DISPLAY_SCRIPT);
  const [saved, setSaved] = useState(false);
  const [apiKeyDirty, setApiKeyDirty] = useState(false);
  const [displayScriptDirty, setDisplayScriptDirty] = useState(false);
  const loading = apiKeyLoading;

  useEffect(() => {
    if (!loading && !apiKeyDirty) {
      setApiKeyValue(apiKey || '');
    }
  }, [apiKey, loading, apiKeyDirty]);

  useEffect(() => {
    if (!displayScriptDirty) {
      setDisplayScriptValue(displayScript || DEFAULT_DISPLAY_SCRIPT);
    }
  }, [displayScript, displayScriptDirty]);

  const handleSave = async (e) => {
    e.preventDefault();
    await Promise.all([
      setApiKey(apiKeyValue),
      setDisplayScript(displayScriptValue),
    ]);
    setApiKeyDirty(false);
    setDisplayScriptDirty(false);
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
            value={apiKeyValue}
            onChange={(e) => {
              setApiKeyDirty(true);
              setApiKeyValue(e.target.value);
            }}
            placeholder="Enter your Gemini API key"
          />
        </div>
        <div className={styles.formField}>
          <label>Default Character Display</label>
          <select
            value={displayScriptValue}
            onChange={(e) => {
              setDisplayScriptDirty(true);
              setDisplayScriptValue(e.target.value);
            }}
          >
            <option value="simplified">Simplified</option>
            <option value="traditional">Traditional</option>
          </select>
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
