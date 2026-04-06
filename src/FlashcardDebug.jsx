import { useState, useEffect } from "react";
import styles from "./index.module.css";
import { store, formatInterval } from "./flashcardData";
import { getAllWords } from "./words";

function statusLabel(card) {
  if (card.repetitions === 0) return 'new';
  if (card.interval >= 21) return 'mature';
  return 'learning';
}

function isDue(card) {
  return card.dueDate <= new Date().toISOString();
}

function formatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d - now;
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  if (diffDays < 0) return `${dateStr} (${Math.abs(diffDays)}d ago)`;
  if (diffDays === 0) return `${dateStr} (today)`;
  return `${dateStr} (in ${diffDays}d)`;
}

// Matches getDueCards sort: reviewed cards first, then by dueDate
function reviewOrder(a, b) {
  if (a.repetitions === 0 && b.repetitions > 0) return 1;
  if (a.repetitions > 0 && b.repetitions === 0) return -1;
  if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
  return 0;
}

export function FlashcardDebug() {
  const [cards, setCards] = useState(null);
  const [sortKey, setSortKey] = useState('reviewOrder');
  const [sortAsc, setSortAsc] = useState(true);
  const [dueOnly, setDueOnly] = useState(true);

  useEffect(() => {
    async function load() {
      const [allCards, allWords] = await Promise.all([
        store.getAll(),
        getAllWords(),
      ]);

      const wordMap = new Map(allWords.map(w => [w.id, w]));
      const enriched = allCards
        .filter(c => wordMap.has(c.wordId))
        .map(c => ({
          ...c,
          word: wordMap.get(c.wordId),
        }));

      setCards(enriched);
    }
    load();
  }, []);

  if (!cards) return <p>Loading...</p>;

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const filtered = dueOnly ? cards.filter(isDue) : cards;

  const sorted = [...filtered].sort((a, b) => {
    if (sortKey === 'reviewOrder') {
      const result = reviewOrder(a, b);
      return sortAsc ? result : -result;
    }

    let av, bv;
    switch (sortKey) {
      case 'word':
        av = a.word?.simplified || '';
        bv = b.word?.simplified || '';
        break;
      case 'direction':
        av = a.direction;
        bv = b.direction;
        break;
      case 'status':
        av = statusLabel(a);
        bv = statusLabel(b);
        break;
      case 'dueDate':
        av = a.dueDate;
        bv = b.dueDate;
        break;
      case 'interval':
        av = a.interval;
        bv = b.interval;
        break;
      case 'easeFactor':
        av = a.easeFactor;
        bv = b.easeFactor;
        break;
      case 'repetitions':
        av = a.repetitions;
        bv = b.repetitions;
        break;
      case 'lastReviewDate':
        av = a.lastReviewDate || '';
        bv = b.lastReviewDate || '';
        break;
      default:
        av = a.dueDate;
        bv = b.dueDate;
    }
    if (av < bv) return sortAsc ? -1 : 1;
    if (av > bv) return sortAsc ? 1 : -1;
    return 0;
  });

  const dueCount = cards.filter(isDue).length;

  const columns = [
    { key: 'reviewOrder', label: '#' },
    { key: 'word', label: 'Word' },
    { key: 'direction', label: 'Dir' },
    { key: 'status', label: 'Status' },
    { key: 'dueDate', label: 'Due' },
    { key: 'interval', label: 'Interval' },
    { key: 'easeFactor', label: 'Ease' },
    { key: 'repetitions', label: 'Reps' },
    { key: 'lastReviewDate', label: 'Last Review' },
  ];

  return (
    <div>
      <div className={styles.sectionHeader}>
        <h2>Flashcard Debug</h2>
      </div>
      <p className={styles.formHint}>
        Showing {filtered.length} of {cards.length} cards ({dueCount} due now)
        {' '}<label style={{ marginLeft: 12 }}>
          <input type="checkbox" checked={dueOnly} onChange={e => setDueOnly(e.target.checked)} />
          {' '}Due only
        </label>
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table className={styles.audioTable}>
          <thead>
            <tr>
              {columns.map(col => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                >
                  {col.label}{sortKey === col.key ? (sortAsc ? ' \u25b2' : ' \u25bc') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((card, i) => (
              <tr key={card.key} style={isDue(card) ? { background: '#fefce8' } : undefined}>
                <td style={{ color: '#94a3b8' }}>{i + 1}</td>
                <td>{card.word?.simplified} <span style={{ color: '#94a3b8', fontSize: 12 }}>{card.word?.pinyin}</span></td>
                <td>{card.direction === 'en2zh' ? 'EN\u2192ZH' : 'ZH\u2192EN'}</td>
                <td>{statusLabel(card)}</td>
                <td>{formatDate(card.dueDate)}</td>
                <td>{formatInterval(card.interval)}</td>
                <td>{card.easeFactor.toFixed(2)}</td>
                <td>{card.repetitions}</td>
                <td>{card.lastReviewDate ? formatDate(card.lastReviewDate) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
