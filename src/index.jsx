import { createRoot } from "react-dom/client";
import styles from "./index.module.css";
import { useRoute, setRoute } from "./router";
import { WordList } from "./WordList";
import { CollectionList } from "./CollectionList";
import { ImportWords } from "./ImportWords";
import { Settings } from "./Settings";

function App() {
  const route = useRoute(['view']);
  const view = route.view || 'words';

  return (
    <div className={styles.app}>
      <div className={styles.header}>
        <h1>Chinese</h1>
        <nav className={styles.nav}>
          <button
            className={view === 'words' ? styles.navButtonActive : styles.navButton}
            onClick={() => setRoute({ view: 'words' })}
          >
            Words
          </button>
          <button
            className={view === 'collections' ? styles.navButtonActive : styles.navButton}
            onClick={() => setRoute({ view: 'collections' })}
          >
            Collections
          </button>
          <button
            className={view === 'import' ? styles.navButtonActive : styles.navButton}
            onClick={() => setRoute({ view: 'import' })}
          >
            Import
          </button>
          <button
            className={view === 'settings' ? styles.navButtonActive : styles.navButton}
            onClick={() => setRoute({ view: 'settings' })}
          >
            Settings
          </button>
        </nav>
      </div>

      {view === 'words' && <WordList />}
      {view === 'collections' && <CollectionList />}
      {view === 'import' && <ImportWords />}
      {view === 'settings' && <Settings />}
    </div>
  );
}

const root = createRoot(document.getElementById("root"));
root.render(<App />);
