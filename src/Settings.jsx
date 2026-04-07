import { useState, useEffect, useRef } from "react";
import styles from "./index.module.css";
import { useConfig } from "./config";
import { DEFAULT_DISPLAY_SCRIPT } from "./display";
import { useAudioStats } from "./audio";
import { formatBytes } from "./util";
import { exportDatabase, importDatabase, exportWordsCsv } from "./backup";

export function Settings() {
  const [apiKey, setApiKey, apiKeyLoading] = useConfig("gemini_api_key");
  const [openaiKey, setOpenaiKey, openaiKeyLoading] = useConfig("openai_api_key");
  const [displayScript, setDisplayScript] = useConfig("display_script");
  const [apiKeyValue, setApiKeyValue] = useState('');
  const [openaiKeyValue, setOpenaiKeyValue] = useState('');
  const [displayScriptValue, setDisplayScriptValue] = useState(DEFAULT_DISPLAY_SCRIPT);
  const [saved, setSaved] = useState(false);
  const [apiKeyDirty, setApiKeyDirty] = useState(false);
  const [openaiKeyDirty, setOpenaiKeyDirty] = useState(false);
  const [displayScriptDirty, setDisplayScriptDirty] = useState(false);
  const loading = apiKeyLoading || openaiKeyLoading;

  // Backup state
  const [includeAudio, setIncludeAudio] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [backupStatus, setBackupStatus] = useState(null);
  const fileInputRef = useRef(null);
  const [audioStats] = useAudioStats();

  useEffect(() => {
    if (!loading && !apiKeyDirty) {
      setApiKeyValue(apiKey || '');
    }
  }, [apiKey, loading, apiKeyDirty]);

  useEffect(() => {
    if (!loading && !openaiKeyDirty) {
      setOpenaiKeyValue(openaiKey || '');
    }
  }, [openaiKey, loading, openaiKeyDirty]);

  useEffect(() => {
    if (!displayScriptDirty) {
      setDisplayScriptValue(displayScript || DEFAULT_DISPLAY_SCRIPT);
    }
  }, [displayScript, displayScriptDirty]);

  const handleSave = async (e) => {
    e.preventDefault();
    await Promise.all([
      setApiKey(apiKeyValue),
      setOpenaiKey(openaiKeyValue),
      setDisplayScript(displayScriptValue),
    ]);
    setApiKeyDirty(false);
    setOpenaiKeyDirty(false);
    setDisplayScriptDirty(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleExport = async () => {
    setExporting(true);
    setBackupStatus(null);
    try {
      await exportDatabase({ includeAudio });
      setBackupStatus({ type: 'success', message: 'Backup exported successfully.' });
    } catch (err) {
      setBackupStatus({ type: 'error', message: 'Export failed: ' + err.message });
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;

    setImporting(true);
    setBackupStatus(null);
    try {
      const jsonString = await file.text();
      const summary = await importDatabase(jsonString);
      setBackupStatus({
        type: 'success',
        message: `Imported ${summary.words} words, ${summary.collections} collections, ${summary.config} config entries, ${summary.audioClips} audio clips. Reloading...`,
      });
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      setBackupStatus({ type: 'error', message: 'Import failed: ' + err.message });
      setImporting(false);
    }
  };

  const hasAudio = audioStats && audioStats.clipCount > 0;

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
          <label>OpenAI API Key</label>
          <input
            type="password"
            value={openaiKeyValue}
            onChange={(e) => {
              setOpenaiKeyDirty(true);
              setOpenaiKeyValue(e.target.value);
            }}
            placeholder="Enter your OpenAI API key"
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
          <button type="submit" className={styles.primaryButton}>
            {saved ? 'Saved!' : 'Save'}
          </button>
        </div>
      </form>

      <div className={styles.backupSection}>
        <div className={styles.sectionHeader}>
          <h2>Data Backup</h2>
        </div>

        <div className={styles.form}>
          <div className={styles.formField}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={includeAudio}
                onChange={(e) => setIncludeAudio(e.target.checked)}
                disabled={!hasAudio}
              />
              Include audio cache
              {audioStats
                ? ` (${audioStats.clipCount} clips, ${formatBytes(audioStats.totalBytes)})`
                : ''}
            </label>
          </div>
          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting ? 'Exporting...' : 'Export Backup'}
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={exportWordsCsv}
            >
              Export CSV
            </button>
          </div>
        </div>

        <div className={styles.form}>
          <div className={styles.warningBox}>
            <p>Importing will replace all existing data.</p>
          </div>
          <div className={styles.formField}>
            <label>Select backup file</label>
            <input
              type="file"
              accept=".json"
              ref={fileInputRef}
            />
          </div>
          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={handleImport}
              disabled={importing}
            >
              {importing ? 'Importing...' : 'Import Backup'}
            </button>
          </div>
        </div>

        {backupStatus && (
          <div className={backupStatus.type === 'error' ? styles.errorBox : styles.successBox}>
            <p>{backupStatus.message}</p>
          </div>
        )}
      </div>
    </div>
  );
}
