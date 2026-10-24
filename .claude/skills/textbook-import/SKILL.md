---
name: textbook-import
description: Build or audit premade chapter collections (dist/collections/collection-chapter-N.json) from the 來學華語 (Let's Learn Mandarin) textbook PDFs. Use when asked to add a new chapter from a book/lesson, re-check an existing chapter against the book, or fix collection words/sentences. Covers PDF text extraction, the book's font quirks, chapter↔lesson mapping, and the word, pinyin, sentence and audio conventions.
---

# Importing textbook chapters

Premade collections live in `dist/collections/`: one `collection-chapter-N.json` per chapter plus `index.json`, which the app reads to list them. Each chapter is one lesson of the 來學華語 (Let's Learn Mandarin) textbooks.

## Chapter ↔ book mapping

Chapter = 10 × (book − 1) + lesson. Book 1 is chapters 1–10, Book 2 is 11–20, Book 3 would be 21–30.

| Book | PDF in repo root | Lesson start pages (printed) | Vocab index (PDF page) |
|---|---|---|---|
| 1 | `084.來學華語課本第一冊.pdf` | 1, 13, 25, 41, 57, 73, 89, 105, 121, 139 | p174 |
| 2 | `087.來學華語課本第二冊.pdf` | 1, 17, 35, 53, 67, 81, 99, 113, 127, 141 | p180 |

**PDF page = printed page + 12** in both books. A lesson runs from its start page to the page before the next lesson's start; skip the 文化單元 culture-unit pages at the end of some lessons. For a new book, read its 目次 table of contents (around PDF p8) and confirm the offset by finding a page whose first line is the printed page number.

The PDFs are not committed. They come from huayuworld.org's eBookstore (`https://www.huayuworld.org/upload/eBookstore/PDF/第二語言教材/<file>.pdf`). The site's bot protection serves a 212-byte HTML challenge page to curl, so the user downloads them in a browser into the repo root. If a "PDF" is tiny, it's that challenge page.

## Setup (once per machine)

Extraction output goes in `.book-extract/`, which is git-ignored via `.git/info/exclude`:

```bash
grep -qx ".book-extract/" .git/info/exclude || echo ".book-extract/" >> .git/info/exclude
npm install --prefix .book-extract/tools pdfjs-dist@4
node .claude/skills/textbook-import/scripts/extract.mjs 087.來學華語課本第二冊.pdf .book-extract/book2
python3 -I .claude/skills/textbook-import/scripts/decode.py .book-extract/book2/*.txt   # run once only
```

Do the same for each book. One-off helper scripts for a given import go in `.book-extract/scripts/`, never in the repo proper. Page images can't be rendered on the user's ARM machine (the canvas library segfaults), so work from the text.

## Reading the extracted text

Each lesson has: a title page with **Learning Objectives**; the 課文 dialogue; 生詞 Vocabulary as numbered entries (`N. 漢字 pinyin POS english`); 短語 Phrases; sometimes 專有名詞 Proper Nouns and 補充生詞 Supplementary Vocabulary (the numbering continues across these sections, and the section heading often prints *after* its items); 語法 Grammar with example sentences; and 綜合活動 Classroom Activities.

Font quirks:
- Chinese in the dialogue and vocab headwords is usually garbled CJK from a wrong font mapping. Ignore it. Readable characters come from:
  - **"1. Read aloud"** under Classroom Activities: the whole dialogue in clean text. Find it with `grep -l "Read aloud" .book-extract/bookN/*.txt`.
  - **Grammar example sentences**, which are mostly readable.
  - **The vocab index**: lines like `jiārén 家人 … family (members) 2-1`, where `2-1` means lesson 2, item 1. `grep -h -E " 2-[0-9]+$" .book-extract/book2/p1[8-9]*.txt` lists a whole lesson's vocab with characters and English.
- Pinyin and much of the English are in a shifted font. `decode.py` adds a decoded copy on the next line, prefixed with `» `. The decoder is lossy: ù, ó, ǘ/ǜ and some other vowels get dropped or garbled ("wǎngl" = wǎnglù, "hyng" = hóng, "zuy" = zuó), and spaces and punctuation are lost. Fill these in from your own knowledge of Mandarin; never copy a broken decoding. Cross-check every word against the index and the English.

## Words

Include, in book order:
- 生詞 Vocabulary, notes `"Part of speech: <POS>"` using the book's abbreviation (N, V, Vs, Vaux, Adv, M, Conj, Prep, Ptc, Pron, QPr, Det, Num…).
- 短語 Phrases, notes `"Phrases"`.
- 補充生詞 Supplementary Vocabulary, notes `"Supplementary Vocabulary; Part of speech: <POS>"`.

Exclude:
- **Names of any kind**: character names (王明文, 林美美), surnames (王, 張, 李, 林), and named places or businesses (迪士尼樂園, 美味餐廳). Titles are words: 先生, 小姐, 太太.
- 專有名詞 entries that are names. Countries and cities (美國, 臺灣, 臺北) are fine as ordinary `Part of speech: N` words.
- Words from other lessons (no "leaking" future vocab into early chapters) and extras from grammar pages or activity lists, unless the user asks. The one exception: a lesson's headline fixed grammar frame may be a single entry, notes `"Grammar: <one-line explanation>"`, e.g. 又……又……, 什麼……都…….

Fields:
- `traditional` as the book prints it. `simplified` is your own conversion: 臺→台, 妳→你, 姊→姐 (a word like 你/妳 still gets a single simplified form, 你).
- `english` uses the book's gloss; a user's extra nuance may stay if it isn't wrong.
- Extra notes go after the POS: `"Part of speech: N; note: …"`.

**Pinyin** uses tone marks and is written joined the way the book writes the word (`qǐngwèn`, `bǎihuògōngsī`), with spaces only where the book has them (`xià ge xīngqī`). No parentheses or `?!` — grading compares characters exactly and does not strip parentheses. Alternates use ` / `: grading accepts any variant, while audio and the syllable picker use the **first**. Convention: **Mainland reading first, Taiwan/textbook reading as the alternate**:
- 星期 `xīngqīwǔ / xīngqíwǔ`, 差不多 `chàbùduō / chābùduō`, 和 `hé / hàn`, 謝謝 `xièxie / xièxiè`
- Neutral vs. full tone: `xǐhuān / xǐhuan`, `shūfú / shūfu`, `xuésheng / xuéshēng`, `dōngxi / dōngxī`. When editing an existing word, keep its current first reading so its audio clip still matches, and add the other as the alternate.
- Colloquial Taiwan readings: 誰 `shéi / shuí`, 這 `zhè / zhèi`, 那 `nà / nèi`, 哪 `nǎ / něi`, 哪裡 `nǎlǐ / nǎr`.

## Sentences

Aim for 10–15 per chapter:
- Most should come from the Read-aloud dialogue and grammar examples, trimmed to one idea each. Fill gaps with sentences of your own.
- Every grammar point in the lesson gets at least one sentence, and most of the chapter's words appear somewhere.
- Use only vocabulary taught by this lesson (this and earlier chapters). Avoid fancier words (藉此, 越來越, 計劃…) and patterns from later lessons (e.g. 太……了 before Book 2 L1).
- People in sentences come only from this cast: 明文 / 王明文, 家文 / 王家文, 王先生, 林小姐 / 林美美, 劉小姐. No English names (the book's Gloria, Lisa, Kevin, Jose → use 林小姐 or 劉小姐). Swap other people the book uses in examples (張先生, 李老師, 王太太, 王小姐…) for one of these too. Names are never words or `words_used` entries.

Fields:
- `traditional`, `simplified`, `english`, and `notes: ""`.
- `pinyin`: one reading only, never ` / `. Use the Mainland form (xīngqī, chàbùduō, hé, xuésheng, xiānsheng), spaced by word, capitalized, with punctuation.
- `words_used`: the `simplified` forms of **this chapter's** words that appear in the sentence. Each must exactly match a word's `simplified` (frames like `又……又……` are allowed even though they aren't substrings). Never list words from other chapters.

## File format

```json
{
  "format": "chinese-collection-export",
  "version": 2,
  "exportedAt": "<ISO timestamp>",
  "collection": {"name": "Chapter 14", "notes": "<lesson's English title, sentence case>", "objectives": "<Learning Objectives, semicolon-separated>"},
  "words": [{"traditional": "", "simplified": "", "pinyin": "", "english": "", "notes": ""}],
  "sentences": [{"traditional": "", "simplified": "", "pinyin": "", "english": "", "notes": "", "words_used": []}]
}
```

Write it with `json.dump(..., ensure_ascii=False, indent=2)` plus a trailing newline. In `words_used` checks, `assert` that every non-frame entry is a substring of the sentence's `simplified`.

## Audio

The user generates TTS separately, so new chapters have no `audio_clips`. Never edit `audio_clips` arrays or `src/audio-manifest.js`. A clip is keyed by the item's pinyin (first variant, lowercased, letters and tone marks only; see `audioKey` in `src/audio.js`). So changing spacing, capitalization or punctuation is free, but changing a tone or syllable of an existing word or sentence orphans its clip. Avoid that unless fixing a real error, and always report which clips you orphaned.

## Workflow

1. Confirm the PDF exists (not the 212-byte challenge page). Run setup if `.book-extract/bookN/` is missing.
2. Find the lesson's pages and read the objectives, vocab, phrases, supplementary, grammar and Read-aloud pages.
3. Write `collection-chapter-N.json` with a script in `.book-extract/scripts/`.
4. Run `python3 -I .claude/skills/textbook-import/scripts/check_collections.py`. It validates every chapter, adds or refreshes `index.json` entries, and lists orphaned audio relative to HEAD. Fix every ERROR.
5. Run `npm run build`.
6. Show the user `python3 -I .claude/skills/textbook-import/scripts/review_diff.py N` (words with pinyin and English, then sentences) so they can audit, and call out anything you were unsure about.
7. Don't stage or commit until the user asks. When they do, stage only `dist/collections/` files (the PDFs and backups in the repo root stay untracked).

For several chapters at once, one subagent per one or two chapters works well. Give each one this skill's rules and have them edit only their own chapter files; run `check_collections.py` yourself afterwards.
