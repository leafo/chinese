import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import styles from "./index.module.css";
import { useAllWords } from "./words";
import { useCollections } from "./collections";
import { useRoute, setRoute } from "./router";
import { ChineseDisplay } from "./ChineseDisplay";
import { useConfig } from "./config";
import { DEFAULT_DISPLAY_SCRIPT } from "./display";

const GRADUATE_THRESHOLD = 1;
const INITIAL_BATCH_SIZE = 2;

function LearnIntroCard({ word, displayScript, onDone, onKnown }) {
  useEffect(() => {
    const handleKey = (e) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        onDone();
      }
      if (e.key === 'k') {
        e.preventDefault();
        onKnown();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onDone, onKnown]);

  return (
    <div className={styles.flashcardContainer}>
      <div className={`${styles.flashcardCard} ${styles.learnIntroCard}`}>
        <div className={styles.flashcardBack}>
          <div className={styles.learnNewLabel}>New Word</div>
          <ChineseDisplay word={word} displayScript={displayScript} autoPlay />
          <div className={styles.flashcardEnglish}>{word.english}</div>
          {word.notes && <div className={styles.flashcardNotes}>{word.notes}</div>}
        </div>
      </div>
      <div className={styles.learnActions}>
        <button className={`${styles.ratingButton} ${styles.ratingGood}`} onClick={onDone}>
          <span className={styles.ratingLabel}>Got it</span>
        </button>
        <button className={`${styles.ratingButton} ${styles.ratingEasy}`} onClick={onKnown}>
          <span className={styles.ratingLabel}>Already know</span>
        </button>
      </div>
    </div>
  );
}

function LearnQuizCard({ card, displayScript, onGotIt, onForgot, onReset }) {
  const [revealed, setRevealed] = useState(false);
  const word = card.word;
  const isZh2En = card.direction === 'zh2en';

  useEffect(() => {
    setRevealed(false);
  }, [card]);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.repeat) return;

      if (e.code === 'Space' && !revealed) {
        e.preventDefault();
        setRevealed(true);
        return;
      }

      if (revealed) {
        if (e.key === '1') { e.preventDefault(); onGotIt(); }
        if (e.key === '2') { e.preventDefault(); onForgot(); }
        if (e.key === '3') { e.preventDefault(); onReset(); }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [revealed, onGotIt, onForgot, onReset]);

  return (
    <div className={styles.flashcardContainer}>
      <div
        className={styles.flashcardCard}
        onClick={!revealed ? () => setRevealed(true) : undefined}
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
          </div>
        )}
      </div>

      {revealed && (
        <div className={styles.learnActions}>
          <button className={`${styles.ratingButton} ${styles.ratingGood}`} onClick={onGotIt}>
            <span className={styles.ratingLabel}>Got it</span>
          </button>
          <button className={`${styles.ratingButton} ${styles.ratingHard}`} onClick={onForgot}>
            <span className={styles.ratingLabel}>Forgot</span>
          </button>
          <button className={`${styles.ratingButton} ${styles.ratingAgain}`} onClick={onReset}>
            <span className={styles.ratingLabel}>Reset</span>
          </button>
        </div>
      )}
    </div>
  );
}

function LearnSummary({ introducedCount, totalCount, onDone }) {
  return (
    <div className={styles.flashcardSummary}>
      <h2>Session Complete</h2>
      <p>Learned {introducedCount} of {totalCount} words</p>
      <div className={styles.flashcardActions}>
        <button className={styles.primaryButton} onClick={onDone}>Done</button>
      </div>
    </div>
  );
}

function LearnProgress({ collectionName, introducedCount, totalCount, onEnd }) {
  return (
    <div className={styles.flashcardProgress}>
      Learning: {collectionName} — {introducedCount}/{totalCount} words introduced
      <button className={styles.smallButton} onClick={onEnd} style={{ marginLeft: 'auto' }}>
        End Session
      </button>
    </div>
  );
}

function pickNextCard(cards, lastWordId) {
  if (cards.length === 0) return null;

  const candidates = cards.length > 2
    ? cards.filter(c => c.word.id !== lastWordId)
    : cards;

  let minScore = Infinity;
  for (const c of candidates) {
    if (c.score < minScore) minScore = c.score;
  }

  const lowest = candidates.filter(c => c.score === minScore);
  return lowest[Math.floor(Math.random() * lowest.length)];
}

function getWordScores(cards, wordId) {
  const scores = { zh2en: 0, en2zh: 0 };
  for (const card of cards) {
    if (card.word.id === wordId) {
      scores[card.direction] = card.score;
    }
  }
  return scores;
}

function isGraduated(scores) {
  return scores.zh2en >= GRADUATE_THRESHOLD && scores.en2zh >= GRADUATE_THRESHOLD;
}

function didWordJustGraduate(prevCards, updatedCards, wordId) {
  return (
    !isGraduated(getWordScores(prevCards, wordId)) &&
    isGraduated(getWordScores(updatedCards, wordId))
  );
}

function allCardsGraduated(cards) {
  const scoreByWord = {};
  for (const card of cards) {
    if (!scoreByWord[card.word.id]) {
      scoreByWord[card.word.id] = { zh2en: 0, en2zh: 0 };
    }
    scoreByWord[card.word.id][card.direction] = card.score;
  }

  for (const wordId in scoreByWord) {
    if (!isGraduated(scoreByWord[wordId])) {
      return false;
    }
  }
  return true;
}

function CollectionPicker({ collections, loading, onSelect }) {
  if (loading) return <p>Loading collections...</p>;
  if (!collections || collections.length === 0) {
    return (
      <div className={styles.emptyState}>
        <p>No collections yet</p>
        <p>Create a collection first to start learning</p>
      </div>
    );
  }

  return (
    <div>
      <h2>Choose a collection to learn</h2>
      <ul className={styles.collectionList}>
        {collections.map(col => (
          <li key={col.id} className={styles.collectionItem}>
            <span className={styles.learnCollectionName}>{col.name}</span>
            <button className={styles.primaryButton} onClick={() => onSelect(col.id)}>
              Learn
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LearnSession({ words, collectionName, displayScript }) {
  const [notIntroduced, setNotIntroduced] = useState(() => {
    const [, ...rest] = words;
    return rest;
  });
  const [cards, setCards] = useState([]);
  const [introWord, setIntroWord] = useState(() => words[0]);
  const [currentCard, setCurrentCard] = useState(null);
  const [sessionDone, setSessionDone] = useState(false);
  const [introducedCount, setIntroducedCount] = useState(0);
  const totalCount = words.length;
  const lastWordIdRef = useRef(null);

  const scheduleNextCard = useCallback((updatedCards) => {
    const next = pickNextCard(updatedCards, lastWordIdRef.current);
    if (next) {
      setCurrentCard(next);
    }
  }, []);

  const handleIntroComplete = useCallback((alreadyKnown) => {
    const word = introWord;
    setIntroWord(null);
    setIntroducedCount(prev => prev + 1);
    lastWordIdRef.current = word.id;

    const initialScore = alreadyKnown ? GRADUATE_THRESHOLD - 1 : 0;
    const newCards = [
      { word, direction: 'zh2en', score: initialScore },
      { word, direction: 'en2zh', score: initialScore },
    ];

    setCards(prev => {
      const updated = [...prev, ...newCards];

      if (!alreadyKnown && updated.length / 2 < INITIAL_BATCH_SIZE) {
        setNotIntroduced(prevNI => {
          if (prevNI && prevNI.length > 0) {
            const [next, ...rest] = prevNI;
            setIntroWord(next);
            return rest;
          }
          scheduleNextCard(updated);
          return prevNI;
        });
      } else if (alreadyKnown) {
        setNotIntroduced(prevNI => {
          if (prevNI && prevNI.length > 0) {
            const [next, ...rest] = prevNI;
            setIntroWord(next);
            return rest;
          }
          const allGraduated = allCardsGraduated(updated);
          if (allGraduated) {
            setSessionDone(true);
          } else {
            scheduleNextCard(updated);
          }
          return prevNI;
        });
      } else {
        scheduleNextCard(updated);
      }

      return updated;
    });
  }, [introWord, scheduleNextCard]);

  const handleGotIt = useCallback(() => {
    if (!currentCard) return;
    lastWordIdRef.current = currentCard.word.id;

    setCards(prev => {
      const updated = prev.map(c =>
        c.word.id === currentCard.word.id && c.direction === currentCard.direction
          ? { ...c, score: c.score + 1 }
          : c
      );

      if (didWordJustGraduate(prev, updated, currentCard.word.id)) {
        setNotIntroduced(prevNI => {
          if (prevNI && prevNI.length > 0) {
            const [next, ...rest] = prevNI;
            setIntroWord(next);
            setCurrentCard(null);
            return rest;
          }
          if (allCardsGraduated(updated)) {
            setSessionDone(true);
            setCurrentCard(null);
          } else {
            scheduleNextCard(updated);
          }
          return prevNI;
        });
      } else {
        scheduleNextCard(updated);
      }

      return updated;
    });
  }, [currentCard, scheduleNextCard]);

  const handleForgot = useCallback(() => {
    if (!currentCard) return;
    lastWordIdRef.current = currentCard.word.id;

    setCards(prev => {
      const updated = prev.map(c =>
        c.word.id === currentCard.word.id && c.direction === currentCard.direction
          ? { ...c, score: Math.max(0, c.score - 1) }
          : c
      );
      scheduleNextCard(updated);
      return updated;
    });
  }, [currentCard, scheduleNextCard]);

  const handleReset = useCallback(() => {
    if (!currentCard) return;
    const wordToReset = currentCard.word;
    lastWordIdRef.current = null;
    setIntroducedCount(prev => prev - 1);

    setCards(prev => {
      const updated = prev.filter(c => c.word.id !== wordToReset.id);

      if (updated.length === 0) {
        setIntroWord(wordToReset);
        setCurrentCard(null);
      } else {
        setNotIntroduced(prevNI => [wordToReset, ...(prevNI || [])]);
        scheduleNextCard(updated);
      }

      return updated;
    });
  }, [currentCard, scheduleNextCard]);

  const handleEndSession = useCallback(() => {
    setSessionDone(true);
    setCurrentCard(null);
    setIntroWord(null);
  }, []);

  if (sessionDone) {
    return (
      <LearnSummary
        introducedCount={introducedCount}
        totalCount={totalCount}
        onDone={() => setRoute({ view: 'collections' })}
      />
    );
  }

  if (introWord) {
    return (
      <div>
        <LearnProgress collectionName={collectionName} introducedCount={introducedCount} totalCount={totalCount} onEnd={handleEndSession} />
        <LearnIntroCard
          word={introWord}
          displayScript={displayScript}
          onDone={() => handleIntroComplete(false)}
          onKnown={() => handleIntroComplete(true)}
        />
      </div>
    );
  }

  if (currentCard) {
    return (
      <div>
        <LearnProgress collectionName={collectionName} introducedCount={introducedCount} totalCount={totalCount} onEnd={handleEndSession} />
        <LearnQuizCard
          key={`${currentCard.word.id}-${currentCard.direction}-${currentCard.score}`}
          card={currentCard}
          displayScript={displayScript}
          onGotIt={handleGotIt}
          onForgot={handleForgot}
          onReset={handleReset}
        />
      </div>
    );
  }

  return <p>Loading...</p>;
}

export function Learn() {
  const { collection: routeCollection } = useRoute(['collection']);
  const [displayScript] = useConfig("display_script");
  const preferredScript = displayScript || DEFAULT_DISPLAY_SCRIPT;
  const [collections, , collectionsLoading] = useCollections();
  const [allWords] = useAllWords();
  const collectionId = routeCollection ? parseInt(routeCollection, 10) : null;

  const collectionWords = useMemo(() => {
    if (!allWords || !collectionId) return [];
    return allWords.filter(w => (w.collection_ids || []).includes(collectionId));
  }, [allWords, collectionId]);

  if (!collectionId) {
    return (
      <CollectionPicker
        collections={collections}
        loading={collectionsLoading}
        onSelect={(id) => setRoute({ view: 'learn', collection: id })}
      />
    );
  }

  if (!allWords) return <p>Loading words...</p>;

  if (collectionWords.length === 0) {
    return (
      <div className={styles.emptyState}>
        <p>No words in this collection</p>
        <button className={styles.primaryButton} onClick={() => setRoute({ view: 'collections' })}>
          Back to Collections
        </button>
      </div>
    );
  }

  const collectionName = collections?.find(c => c.id === collectionId)?.name || 'Collection';

  return (
    <LearnSession
      key={collectionId}
      words={collectionWords}
      collectionName={collectionName}
      displayScript={preferredScript}
    />
  );
}
