import { createRoot } from "react-dom/client";
import styles from "./index.module.css";
import { useRoute, setRoute } from "./router";
import { WordList } from "./WordList";
import { CollectionList } from "./CollectionList";
import { ImportWords } from "./ImportWords";
import { Settings } from "./Settings";
import { AudioManager } from "./AudioManager";
import { Flashcards } from "./Flashcards";
import { GenerateSentences } from "./GenerateSentences";
import { GenerateCollection } from "./GenerateCollection";

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
            className={view === 'audio' ? styles.navButtonActive : styles.navButton}
            onClick={() => setRoute({ view: 'audio' })}
          >
            Audio
          </button>
          <button
            className={view === 'sentences' ? styles.navButtonActive : styles.navButton}
            onClick={() => setRoute({ view: 'sentences' })}
          >
            Sentences
          </button>
          <button
            className={view === 'flashcards' ? styles.navButtonActive : styles.navButton}
            onClick={() => setRoute({ view: 'flashcards' })}
          >
            Review
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
      {view === 'audio' && <AudioManager />}
      {view === 'sentences' && <GenerateSentences />}
      {view === 'generate-collection' && <GenerateCollection />}
      {view === 'flashcards' && <Flashcards />}
      {view === 'settings' && <Settings />}
    </div>
  );
}

const root = createRoot(document.getElementById("root"));
root.render(<App />);
