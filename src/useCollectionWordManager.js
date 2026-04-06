import { useState } from "react";
import { useWordSelection } from "./useWordSelection";
import { insertWord, updateWord, useAllWords } from "./words";
import { insertCollection } from "./collections";

export function useCollectionWordManager(extractedWords, setExtractedWords) {
  const [addExistingToCollection, setAddExistingToCollection] = useState({});
  const [existingWords] = useAllWords();

  const {
    setSelected, duplicateMatches, isWordSelected,
    selectedCount,
  } = useWordSelection(extractedWords, existingWords);

  const updateField = (index, field, value) => {
    const updated = [...extractedWords];
    updated[index] = { ...updated[index], [field]: value };
    setExtractedWords(updated);
  };

  const toggleAllCreateNew = () => {
    const allSelected = extractedWords.every((_, i) => isWordSelected(i));
    const nextSelected = !allSelected;
    const selection = {};
    extractedWords.forEach((_, i) => { selection[i] = nextSelected; });
    setSelected(selection);
    if (nextSelected) {
      setAddExistingToCollection({});
    }
  };

  const toggleCreateNew = (index) => {
    const nextSelected = !isWordSelected(index);
    setSelected((current) => ({ ...current, [index]: nextSelected }));
    if (duplicateMatches[index] && nextSelected) {
      setAddExistingToCollection((current) => ({ ...current, [index]: false }));
    }
  };

  const toggleAddExisting = (index) => {
    const nextValue = !addExistingToCollection[index];
    setAddExistingToCollection((current) => ({ ...current, [index]: nextValue }));
    if (nextValue) {
      setSelected((selected) => ({ ...selected, [index]: false }));
    }
  };

  const existingLinkedCount = Array.from(
    new Set(
      duplicateMatches
        .filter((duplicate, index) => duplicate && addExistingToCollection[index])
        .map((duplicate) => duplicate.id)
    )
  ).length;
  const totalWordsToAdd = selectedCount + existingLinkedCount;

  const saveCollectionWithWords = async (collectionData) => {
    const collectionId = await insertCollection(collectionData);

    const existingWordsToLink = new Map();
    duplicateMatches.forEach((duplicate, index) => {
      if (duplicate && addExistingToCollection[index]) {
        existingWordsToLink.set(duplicate.id, duplicate);
      }
    });

    for (const duplicate of existingWordsToLink.values()) {
      await updateWord({
        ...duplicate,
        collection_ids: [...(duplicate.collection_ids || []), collectionId],
      });
    }

    for (let i = 0; i < extractedWords.length; i++) {
      if (isWordSelected(i)) {
        await insertWord({
          ...extractedWords[i],
          collection_ids: [collectionId],
        });
      }
    }

    return collectionId;
  };

  const resetSelection = () => {
    setSelected({});
    setAddExistingToCollection({});
  };

  return {
    addExistingToCollection,
    duplicateMatches,
    isWordSelected,
    selectedCount,
    totalWordsToAdd,
    updateField,
    toggleAllCreateNew,
    toggleCreateNew,
    toggleAddExisting,
    saveCollectionWithWords,
    resetSelection,
  };
}
