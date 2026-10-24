# Prints a markdown review of word and sentence changes in each collection vs HEAD, for the user to audit.
# Usage (from the repo root): python3 -I .claude/skills/textbook-import/scripts/review_diff.py [chapter ...]
import json, subprocess, sys


def load_head(path):
    r = subprocess.run(["git", "show", "HEAD:" + path], capture_output=True, text=True)
    return json.loads(r.stdout) if r.returncode == 0 else None


chapters = [int(c) for c in sys.argv[1:]] or range(1, 200)
for ch in chapters:
    path = f"dist/collections/collection-chapter-{ch}.json"
    try:
        new = json.load(open(path, encoding="utf-8"))
    except FileNotFoundError:
        continue
    old = load_head(path)
    print(f"\n### Chapter {ch}")
    if old is None:
        print("New chapter:")
        for w in new["words"]:
            print(f"- {w['traditional']} *{w['pinyin']}*: {w['english']} ({w['notes']})")
        for s in new.get("sentences", []):
            print(f"- {s['traditional']} | {s['pinyin']} | {s['english']}")
        continue

    old_words = {w["traditional"]: w for w in old["words"]}
    new_trad = {w["traditional"] for w in new["words"]}
    for w in new["words"]:
        o = old_words.get(w["traditional"])
        if o is None:
            print(f"- ➕ {w['traditional']} *{w['pinyin']}*: {w['english']} ({w['notes']})")
            continue
        for k in ("simplified", "pinyin", "english", "notes"):
            if o.get(k) != w.get(k):
                print(f"- ✏️ {w['traditional']} {k}: {o.get(k)} → {w.get(k)}")
    for t, o in old_words.items():
        if t not in new_trad:
            print(f"- ➖ {t} *{o['pinyin']}*: {o['english']}")

    old_sents = {s["traditional"]: s for s in old.get("sentences", [])}
    new_sents = {s["traditional"] for s in new.get("sentences", [])}
    for s in new.get("sentences", []):
        o = old_sents.get(s["traditional"])
        if o is None:
            print(f"- ➕ sentence: {s['traditional']} | {s['pinyin']} | {s['english']}")
        elif (o["pinyin"], o["english"]) != (s["pinyin"], s["english"]):
            print(f"- ✏️ sentence: {s['traditional']} | {o['pinyin']} → {s['pinyin']} | {o['english']} → {s['english']}")
    for t in old_sents:
        if t not in new_sents:
            print(f"- ➖ sentence: {t}")
