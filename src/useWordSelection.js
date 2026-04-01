import { useState, useMemo } from "react";
import { buildExistingWordsMap, getPossibleDuplicate } from "./duplicates";

export function useWordSelection(extractedWords, existingWords) {
  const [selected, setSelected] = useState({});

  const existingWordsMap = useMemo(
    () => buildExistingWordsMap(existingWords || []),
    [existingWords]
  );

  const duplicateMatches = useMemo(
    () => extractedWords?.map((word) => getPossibleDuplicate(word, existingWordsMap)) || [],
    [extractedWords, existingWordsMap]
  );

  const isWordSelected = (index) => (
    index in selected ? selected[index] : !duplicateMatches[index]
  );

  const toggleAll = () => {
    const allSelected = extractedWords.every((_, i) => isWordSelected(i));
    const sel = {};
    extractedWords.forEach((_, i) => { sel[i] = !allSelected; });
    setSelected(sel);
  };

  const toggleOne = (index) => {
    setSelected({ ...selected, [index]: !isWordSelected(index) });
  };

  const selectedCount = extractedWords
    ? extractedWords.filter((_, i) => isWordSelected(i)).length
    : 0;

  return {
    selected,
    setSelected,
    duplicateMatches,
    isWordSelected,
    toggleAll,
    toggleOne,
    selectedCount,
  };
}
