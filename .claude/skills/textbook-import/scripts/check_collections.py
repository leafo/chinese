# Validates every premade collection, syncs dist/collections/index.json, and reports audio impact.
# Usage (from the repo root): python3 -I .claude/skills/textbook-import/scripts/check_collections.py
#
# - Fails on: duplicate words/sentences in a chapter, empty fields, parentheses or ?/! in word
#   pinyin, words_used entries that are not a `simplified` of that chapter's words.
# - Warns on: sentences linking no words, missing objectives.
# - Adds index entries for new collection-chapter-N.json files and refreshes word/sentence counts.
# - Lists existing words/sentences whose audio key changed vs HEAD (their clips are now orphaned)
#   and counts items that have no audio yet.
import glob, json, re, subprocess, sys

COLLECTIONS = "dist/collections"
TONES = dict(zip("āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü",
                 "a1 a2 a3 a4 e1 e2 e3 e4 i1 i2 i3 i4 o1 o2 o3 o4 u1 u2 u3 u4 v1 v2 v3 v4 v".split()))


def audio_key(pinyin):
    # Mirrors audioKey() in src/audio.js plus the manifest's numbered-tone filenames.
    primary = next((s.strip() for s in pinyin.split("/") if s.strip()), pinyin)
    primary = re.sub(r"[^a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]", "", primary.lower())
    return "".join(TONES.get(c, c) for c in primary)


def load_head(path):
    r = subprocess.run(["git", "show", "HEAD:" + path], capture_output=True, text=True)
    return json.loads(r.stdout) if r.returncode == 0 else None


def chapter_num(path):
    return int(re.search(r"collection-chapter-(\d+)\.json$", path).group(1))


def check(path, d):
    errors, warnings = [], []
    words, sentences = d["words"], d.get("sentences", [])
    trad = [w["traditional"] for w in words]
    errors += [f"duplicate word {t}" for t in sorted(set(trad)) if trad.count(t) > 1]
    for w in words:
        for k in ("traditional", "simplified", "pinyin", "english", "notes"):
            if not w.get(k):
                errors.append(f"empty {k}: {w.get('traditional')}")
        if re.search(r"[()（）?!]", w.get("pinyin", "")):
            errors.append(f"pinyin has parentheses/punctuation (use ' / ' for alternates): {w['traditional']} {w['pinyin']}")
    simp = {w["simplified"] for w in words}
    st = [s["traditional"] for s in sentences]
    errors += [f"duplicate sentence {t}" for t in sorted(set(st)) if st.count(t) > 1]
    for s in sentences:
        for k in ("traditional", "simplified", "pinyin", "english"):
            if not s.get(k):
                errors.append(f"empty {k}: {s.get('traditional')}")
        bad = [u for u in s.get("words_used", []) if u not in simp]
        if bad:
            errors.append(f"words_used not in chapter words {bad}: {s['traditional']}")
        if not s.get("words_used"):
            warnings.append(f"sentence links no words: {s['traditional']}")
    if not d["collection"].get("objectives"):
        warnings.append("no objectives")
    return errors, warnings


def main():
    manifest = set(re.findall(r'^\s*"([^"]+)":', open("src/audio-manifest.js", encoding="utf-8").read(), re.M))
    index_path = f"{COLLECTIONS}/index.json"
    index = json.load(open(index_path, encoding="utf-8"))
    by_file = {e["file"]: e for e in index}
    failed = False

    for path in sorted(glob.glob(f"{COLLECTIONS}/collection-chapter-*.json"), key=chapter_num):
        d = json.load(open(path, encoding="utf-8"))
        name = path.split("/")[-1]
        errors, warnings = check(path, d)
        failed |= bool(errors)

        entry = by_file.get(name)
        if entry is None:
            entry = {"file": name, "name": d["collection"]["name"], "notes": d["collection"].get("notes", "")}
            index.append(entry)
            by_file[name] = entry
        entry["wordCount"] = len(d["words"])
        entry["sentenceCount"] = len(d.get("sentences", []))

        old = load_head(path) or {"words": [], "sentences": []}
        old_keys = {x["traditional"]: audio_key(x["pinyin"]) for x in old["words"] + old.get("sentences", [])}
        orphaned, no_audio = [], 0
        for x in d["words"] + d.get("sentences", []):
            k = audio_key(x["pinyin"])
            if k in manifest:
                continue
            if old_keys.get(x["traditional"]) in manifest:
                orphaned.append(x["traditional"])
            else:
                no_audio += 1

        print(f"{d['collection']['name']}: {entry['wordCount']} words, {entry['sentenceCount']} sentences, "
              f"{no_audio} without audio" + (f", ORPHANED audio: {orphaned}" if orphaned else ""))
        for e in errors:
            print(f"  ERROR {e}")
        for w in warnings:
            print(f"  warn  {w}")

    index.sort(key=lambda e: chapter_num(e["file"]))
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
        f.write("\n")
    sys.exit(1 if failed else 0)


main()
