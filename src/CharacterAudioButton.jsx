import { useEffect } from "react";
import { audioKey, isInManifest, playAudio, useAudio } from "./audio";
import { PlayButton } from "./PlayButton";

// Renders a pronunciation button for a single character, but only when audio is
// actually available (either a precomputed manifest clip or a cached clip) — so
// it never offers to TTS-generate for characters that have no audio. `word` is
// the resolved vocabulary entry for the character (carries the pinyin we key
// audio by); pass null/undefined when the character isn't a known word.
//
// With autoPlay, the clip plays once when this mounts (i.e. when the character
// is revealed). We drive autoplay here rather than via PlayButton's autoPlay
// because PlayButton only auto-plays already-cached clips, which would miss
// manifest-only clips; playAudio pulls from the manifest too. It won't generate
// because we only render (and autoplay) when audio is already available.
export function CharacterAudioButton({ word, autoPlay = false }) {
  const text = word?.pinyin ? audioKey(word.pinyin) : null;
  const [cached] = useAudio(text);
  const available = Boolean(text) && (isInManifest(text) || Boolean(cached));

  useEffect(() => {
    if (!autoPlay || !available || !text) return;
    const chineseText = word.simplified || word.traditional;
    // Best-effort: browsers block playback without a prior user gesture, so
    // swallow the rejection rather than surfacing an error.
    playAudio(text, { chineseText }).catch(() => {});
  }, [autoPlay, available, text]);

  if (!available) return null;

  return <PlayButton word={word} autoPlay={false} />;
}
