import { useState, useEffect } from "react";
import styles from "./index.module.css";
import { useConfig } from "./config";

export function Settings() {
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
