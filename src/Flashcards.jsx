import { useState, useEffect, useCallback, useRef } from "react";
import styles from "./index.module.css";
import { useFlashcardStats, ensureCardsForAllWords, getNextDueCard, rateCard, projectedInterval, formatInterval } from "./flashcardData";
import { PlayButton } from "./PlayButton";
import { updateWord, deleteWord, findWord } from "./words";
import { useCollections } from "./collections";
import { CollectionSelector } from "./CollectionSelector";
import { EditWordDialog } from "./EditWordDialog";
import { useConfig } from "./config";
import { DEFAULT_DISPLAY_SCRIPT, getPreferredChineseText } from "./display";

const RATINGS = [
  { key: 'again', label: 'Again', className: 'ratingAgain' },
  { key: 'hard', label: 'Hard', className: 'ratingHard' },
  { key: 'good', label: 'Good', className: 'ratingGood' },
  { key: 'easy', label: 'Easy', className: 'ratingEasy' },
];

function FlashcardDashboard({ stats, loading, error, onStart, collections, collectionsLoading, selectedCollectionIds, onToggleCollection }) {
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const created = await ensureCardsForAllWords();
      if (created > 0) alert(`Created ${created} new cards.`);
    } finally {
      setSyncing(false);
    }
  };

  if (loading && !stats) return <div>Loading...</div>;
  if (error) return <div>Error loading flashcards: {error.message || String(error)}</div>;

  return (
    <div>
      <div className={styles.flashcardStatsGrid}>
        <div className={styles.flashcardStat}>
          <div className={styles.flashcardStatValue}>{stats?.due || 0}</div>
          <div className={styles.flashcardStatLabel}>Due</div>
        </div>
        <div className={styles.flashcardStat}>
          <div className={styles.flashcardStatValue}>{stats?.new || 0}</div>
          <div className={styles.flashcardStatLabel}>New</div>
        </div>
        <div className={styles.flashcardStat}>
          <div className={styles.flashcardStatValue}>{stats?.learning || 0}</div>
          <div className={styles.flashcardStatLabel}>Learning</div>
        </div>
        <div className={styles.flashcardStat}>
          <div className={styles.flashcardStatValue}>{stats?.mature || 0}</div>
          <div className={styles.flashcardStatLabel}>Mature</div>
        </div>
      </div>

      {collections && collections.length > 0 && (
        <div className={styles.flashcardFilter}>
          <div className={styles.flashcardFilterHeader}>
            <span className={styles.flashcardFilterLabel}>Filter by collection</span>
            {selectedCollectionIds.length === 0 && (
              <span className={styles.formHint}>All cards</span>
            )}
          </div>
          <CollectionSelector
            collections={collections}
            loading={collectionsLoading}
            selectedIds={selectedCollectionIds}
            onToggle={onToggleCollection}
            emptyMessage=""
          />
        </div>
      )}

      <div className={styles.flashcardActions}>
        <button
          className={styles.primaryButton}
          onClick={onStart}
          disabled={syncing}
        >
          Start Review ({stats?.due || 0} due)
        </button>
        <button
          className={styles.smallButton}
          onClick={handleSync}
          disabled={syncing}
        >
          {syncing ? 'Syncing...' : 'Sync Cards'}
        </button>
      </div>
    </div>
  );
}

function ChineseDisplay({ word, displayScript, autoPlay }) {
  const primaryText = getPreferredChineseText(word, displayScript);

  return (
    <>
      <div className={styles.flashcardChinese}>{primaryText}</div>
      {word.simplified && word.traditional && word.simplified !== word.traditional && (
        <div className={styles.flashcardAlt}>
          {displayScript === 'traditional' ? word.simplified : word.traditional}
        </div>
      )}
      <div className={styles.flashcardPinyin}>{word.pinyin}</div>
      <PlayButton text={primaryText} autoPlay={autoPlay} />
    </>
  );
}

function FlashcardCard({ card, revealed, busy, onReveal, onRate, onEdit, displayScript }) {
  const word = card.word;
  const isZh2En = card.direction === 'zh2en';

  useEffect(() => {
    const handleKey = (e) => {
      if (e.repeat || busy) {
        return;
      }

      if (e.code === 'Space' && !revealed) {
        e.preventDefault();
        onReveal();
        return;
      }

      if (revealed) {
        const ratingIndex = parseInt(e.key, 10) - 1;
        if (ratingIndex >= 0 && ratingIndex < RATINGS.length) {
          e.preventDefault();
          onRate(RATINGS[ratingIndex].key);
        }
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [busy, revealed, onReveal, onRate]);

  return (
    <div className={styles.flashcardContainer}>
      <div
        className={styles.flashcardCard}
        onClick={!revealed && !busy ? onReveal : undefined}
      >
        {!revealed ? (
          <div className={styles.flashcardFront}>
            <div className={styles.flashcardHint}>
              {isZh2En ? 'What does this mean?' : 'What is this in Chinese?'}
            </div>
            {isZh2En ? (
              <ChineseDisplay word={word} displayScript={displayScript} autoPlay />
            ) : (
              <div className={styles.flashcardPrompt}>{word.english}</div>
            )}
            <div className={styles.flashcardTapHint}>Tap or press Space to reveal</div>
          </div>
        ) : (
          <div className={styles.flashcardBack}>
            <ChineseDisplay word={word} displayScript={displayScript} autoPlay={!isZh2En} />
            <div className={styles.flashcardEnglish}>{word.english}</div>
            {word.notes && <div className={styles.flashcardNotes}>{word.notes}</div>}
            <button type="button" className={styles.smallButton} onClick={onEdit} disabled={busy}>Edit</button>
          </div>
        )}
      </div>

      {revealed && (
        <div className={styles.ratingBar}>
          {RATINGS.map(({ key, label, className }) => (
            <button
              key={key}
              className={`${styles.ratingButton} ${styles[className]}`}
              onClick={() => onRate(key)}
              disabled={busy}
            >
              <span className={styles.ratingLabel}>{label}</span>
              <span className={styles.ratingInterval}>{formatInterval(projectedInterval(card, key))}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FlashcardSummary({ results, onContinue, onDone, allDone }) {
  const counts = { again: 0, hard: 0, good: 0, easy: 0 };
  for (const r of results) {
    counts[r.rating]++;
  }

  return (
    <div className={styles.flashcardSummary}>
      <h2>{allDone ? 'No More Cards Due' : 'Session Summary'}</h2>
      <p>Reviewed {results.length} card{results.length !== 1 ? 's' : ''}</p>
      <div className={styles.flashcardStatsGrid}>
        <div className={`${styles.flashcardStat} ${styles.ratingAgain}`}>
          <div className={styles.flashcardStatValue}>{counts.again}</div>
          <div className={styles.flashcardStatLabel}>Again</div>
        </div>
        <div className={`${styles.flashcardStat} ${styles.ratingHard}`}>
          <div className={styles.flashcardStatValue}>{counts.hard}</div>
          <div className={styles.flashcardStatLabel}>Hard</div>
        </div>
        <div className={`${styles.flashcardStat} ${styles.ratingGood}`}>
          <div className={styles.flashcardStatValue}>{counts.good}</div>
          <div className={styles.flashcardStatLabel}>Good</div>
        </div>
        <div className={`${styles.flashcardStat} ${styles.ratingEasy}`}>
          <div className={styles.flashcardStatValue}>{counts.easy}</div>
          <div className={styles.flashcardStatLabel}>Easy</div>
        </div>
      </div>
      <div className={styles.flashcardActions}>
        {counts.again > 0 && (
          <button className={styles.primaryButton} onClick={onContinue}>
            Continue Reviewing
          </button>
        )}
        <button className={styles.navButton} onClick={onDone}>Done</button>
      </div>
    </div>
  );
}

export function Flashcards() {
  const [displayScript] = useConfig("display_script");
  const [collections, , collectionsLoading] = useCollections();
  const [selectedCollectionIds, setSelectedCollectionIds] = useState([]);
  const [statsResult, statsError, statsLoading] = useFlashcardStats(selectedCollectionIds);

  const [active, setActive] = useState(false);
  const [card, setCard] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [results, setResults] = useState([]);
  const [loadingCard, setLoadingCard] = useState(false);
  const [ratingPending, setRatingPending] = useState(false);
  const [editingWord, setEditingWord] = useState(null);
  const ratingPendingRef = useRef(false);
  const activeFilterRef = useRef(selectedCollectionIds);

  const toggleCollection = useCallback((id) => {
    setSelectedCollectionIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }, []);

  const fetchNextCard = useCallback(async () => {
    setLoadingCard(true);
    try {
      const next = await getNextDueCard({ collectionIds: activeFilterRef.current });
      setCard(next);
      setRevealed(false);
    } finally {
      setLoadingCard(false);
    }
  }, []);

  const startReview = useCallback(async () => {
    activeFilterRef.current = selectedCollectionIds;
    await ensureCardsForAllWords();
    setResults([]);
    setActive(true);
    await fetchNextCard();
  }, [fetchNextCard, selectedCollectionIds]);

  const handleReveal = useCallback(() => {
    setRevealed(true);
  }, []);

  const handleRate = useCallback(async (rating) => {
    if (!card || ratingPendingRef.current) {
      return;
    }

    ratingPendingRef.current = true;
    setRatingPending(true);
    setRevealed(false);

    try {
      await rateCard(card.key, rating);
      setResults(prev => [...prev, { key: card.key, rating }]);
      await fetchNextCard();
    } finally {
      ratingPendingRef.current = false;
      setRatingPending(false);
    }
  }, [card, fetchNextCard]);

  const endSession = useCallback(() => {
    ratingPendingRef.current = false;
    setRatingPending(false);
    setActive(false);
    setCard(null);
  }, []);

  if (!active) {
    if (results.length > 0) {
      return (
        <FlashcardSummary
          results={results}
          onContinue={startReview}
          onDone={() => setResults([])}
        />
      );
    }
    return (
      <div>
        <h2>Flashcard Review</h2>
        <FlashcardDashboard
          stats={statsResult}
          loading={statsLoading}
          error={statsError}
          onStart={startReview}
          collections={collections}
          collectionsLoading={collectionsLoading}
          selectedCollectionIds={selectedCollectionIds}
          onToggleCollection={toggleCollection}
        />
      </div>
    );
  }

  if (!card && !loadingCard) {
    return (
      <FlashcardSummary
        results={results}
        onContinue={startReview}
        onDone={() => { setActive(false); setResults([]); }}
        allDone
      />
    );
  }

  if (loadingCard || !card) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <div className={styles.flashcardProgress}>
        Reviewed: {results.length}
        <button className={styles.smallButton} onClick={endSession} style={{ marginLeft: 'auto' }} disabled={ratingPending}>
          End Session
        </button>
      </div>
      <FlashcardCard
        card={card}
        revealed={revealed}
        busy={ratingPending || !!editingWord}
        onReveal={handleReveal}
        onRate={handleRate}
        onEdit={() => setEditingWord(card.word)}
        displayScript={displayScript || DEFAULT_DISPLAY_SCRIPT}
      />
      {editingWord && (
        <EditWordDialog
          key={editingWord.id}
          word={editingWord}
          onSave={async (form) => {
            await updateWord(form);
            setEditingWord(null);
            const updated = await findWord(form.id);
            setCard(prev => prev ? { ...prev, word: updated } : prev);
          }}
          onDelete={async (id) => {
            await deleteWord(id);
            setEditingWord(null);
            await fetchNextCard();
          }}
          onClose={() => setEditingWord(null)}
          collections={collections || []}
          collectionsLoading={collectionsLoading}
        />
      )}
    </div>
  );
}
