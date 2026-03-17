export const DEFAULT_DISPLAY_SCRIPT = 'simplified';

export function getPreferredChineseText(word, preferredScript = DEFAULT_DISPLAY_SCRIPT) {
  if (!word) {
    return '';
  }

  const fallbackScript = preferredScript === 'traditional' ? 'simplified' : 'traditional';
  return word[preferredScript] || word[fallbackScript] || '';
}
