# Rewrites extracted pages in place: after each line set in the book's shifted pinyin/English font,
# adds a decoded copy prefixed with "» ". Run once per extraction (re-running duplicates lines).
# Usage: python3 -I decode.py <outdir>/*.txt
import sys
M = {'t':'í','p':'é','j':'à','i':'á','q':'è','u':'ì','z':'ò','~':'ú','Ɨ':'ā','ӽ':'ǎ','Ư':'ī','ԉ':'ǚ','ǀ':'ō','ӿ':'ǐ','ԁ':'ǒ','Ɲ':'ē','ǌ':'ū','Č':'ě','ԃ':'ǔ','൵':'ff','¿':'fi','³':'“','´':'”'}
SPECIAL = set(M) - set('tpjiquz~')
def dec(l): return ''.join(M.get(c) or (chr(ord(c)+29) if 33<=ord(c)<=93 and not c.isdigit() else c) for c in l)
def shifted(l):
    letters=[c for c in l if c.isascii() and c.isalpha()]
    if any(c in SPECIAL for c in l): return True
    return len(letters)>=4 and sum(c.isupper() for c in letters)/len(letters)>0.45
for f in sys.argv[1:]:
    lines=open(f,encoding='utf-8').read().split('\n')
    out=[]
    for l in lines:
        out.append(l)
        if shifted(l): out.append('» '+dec(l))
    open(f,'w',encoding='utf-8').write('\n'.join(out))
