import { getAllCollections, insertCollection, updateCollection } from "./collections";
import { getAllWords, insertWord, updateWord } from "./words";
import { getAllSentences, insertSentence, updateSentence } from "./sentences";
import { buildExistingWordsMap, getPossibleDuplicate } from "./duplicates";
import { findConnectedWordIds } from "./wordMatching";
import { deserializeAudioClip } from "./backup";
import { store as audioStore } from "./audio";

const normalizeName = (name) => (name || '').trim().toLowerCase();

const withId = (ids, id) => (ids || []).includes(id) ? null : [...(ids || []), id];

// Merge a collection export into the library: reuses a same-named collection,
// links words and sentences that already exist instead of duplicating them, and
// never overwrites fields on existing records.
export async function mergeCollectionData(data) {
  const { collection, words = [], sentences = [], audio_clips = [] } = data;
  const stats = { created: false, wordsAdded: 0, wordsLinked: 0, sentencesAdded: 0, sentencesLinked: 0 };

  const collections = await getAllCollections();
  let target = collections.find(c => normalizeName(c.name) === normalizeName(collection.name));
  let collectionId;
  if (target) {
    collectionId = target.id;
    if ((!target.notes && collection.notes) || (!target.objectives && collection.objectives)) {
      await updateCollection({
        ...target,
        notes: target.notes || collection.notes || '',
        objectives: target.objectives || collection.objectives || '',
      });
    }
  } else {
    collectionId = await insertCollection(collection);
    stats.created = true;
  }

  const existingWordsMap = buildExistingWordsMap(await getAllWords());
  for (const word of words) {
    const existing = getPossibleDuplicate(word, existingWordsMap);
    if (existing) {
      const collectionIds = withId(existing.collection_ids, collectionId);
      if (collectionIds) {
        existing.collection_ids = collectionIds;
        await updateWord(existing);
        stats.wordsLinked++;
      }
      continue;
    }

    const id = await insertWord({ ...word, collection_ids: [collectionId] });
    const inserted = { ...word, id, collection_ids: [collectionId] };
    for (const text of [word.simplified, word.traditional]) {
      const key = text?.trim();
      if (key && !existingWordsMap.has(key)) existingWordsMap.set(key, inserted);
    }
    stats.wordsAdded++;
  }

  for (const clip of audio_clips) {
    if (await audioStore.get(clip.text)) continue;
    await audioStore.put(deserializeAudioClip(clip));
  }

  if (sentences.length) {
    const allWords = await getAllWords();
    const existingBySimplified = new Map((await getAllSentences()).map(s => [s.simplified, s]));
    for (const sentence of sentences) {
      const wordIds = findConnectedWordIds(allWords, sentence.traditional || '', sentence.simplified || '');
      const existing = existingBySimplified.get(sentence.simplified);
      if (existing) {
        const collectionIds = withId(existing.collection_ids, collectionId);
        if (collectionIds) {
          await updateSentence({
            ...existing,
            collection_ids: collectionIds,
            word_ids: Array.from(new Set([...(existing.word_ids || []), ...wordIds])),
          });
          stats.sentencesLinked++;
        }
        continue;
      }

      await insertSentence({ ...sentence, collection_ids: [collectionId], word_ids: wordIds });
      existingBySimplified.set(sentence.simplified, { ...sentence, collection_ids: [collectionId] });
      stats.sentencesAdded++;
    }
  }

  return stats;
}
