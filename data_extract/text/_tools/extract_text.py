#!/usr/bin/env python3
"""md_scr.med (MED / DxLib engine, MarbleSoft) text extractor — generic.

- Header/entry count を動的にパース（MDE0）
- 復号鍵を `_VIEW` の既知平文（クリブ）から自動復元（ゲーム非依存）
- 各エントリを復号 → NUL 区切り文字列を本文/指示/ID に分類しデコード
- mode: auto = 文字列ごとに JP(SJIS)/CN(GBK) 自動判別（中文パッチ向け）
        jp   = 本文を Shift-JIS 固定（日本語オリジナル向け）
        cn   = 本文を GBK 固定

使い方:
  python3 extract_text.py [--src md_scr.med] [--out 出力dir] [--mode auto|jp|cn]
"""
import struct, os, re, argparse

# repo paths resolved from this file: data_extract/text/_tools -> repo root
_TOOLS = os.path.dirname(os.path.abspath(__file__))
_TEXT  = os.path.dirname(_TOOLS)                              # data_extract/text
ROOT   = os.path.dirname(os.path.dirname(_TEXT))             # repo root
CRIB = bytes([0x00,0x23,0x52,0x55,0x4C,0x45,0x5F,0x56,0x49,0x45,0x57,0x45,0x52,
              0x00,0x3A,0x56,0x49,0x45,0x57,0x5F,0x30,0x00,0x7B,0x00])  # 復号後 _VIEW 先頭24byte

def parse_index(data):
    assert data[:4] == b"MDE0", "not MDE0: %r" % data[:4]
    rs, n = struct.unpack_from("<HH", data, 4)
    ents = []; off = 0x10
    for _ in range(n):
        name = data[off:off+rs-12].split(b"\0")[0].decode("ascii", "replace")
        _, size, eo = struct.unpack_from("<III", data, off+rs-12); off += rs
        ents.append((name, size, eo))
    return ents

def recover_key(data, ents):
    view = next((data[o:o+sz] for nm, sz, o in ents if nm == "_VIEW"), None)
    if view is None:
        raise SystemExit("_VIEW エントリが無く鍵を自動復元できません")
    d = [(CRIB[i] - view[0x10+i]) & 0xFF for i in range(24)]          # key = plain - cipher
    L = next((L for L in range(1, 24) if all(d[i] == d[i+L] for i in range(24-L))), 24)
    key = [0]*L
    for i in range(24):
        key[(0x10+i) % L] = d[i]
    key = bytes(key)
    # 検証
    dec = bytearray(view)
    for p in range(0x10, len(dec)): dec[p] = (dec[p] + key[p % L]) & 0xFF
    assert bytes(dec[0x10:0x10+24]) == CRIB, "クリブ不一致：鍵復元に失敗"
    return key

def decrypt(eb, key):
    o = bytearray(eb)
    for p in range(0x10, len(o)): o[p] = (o[p] + key[p % len(key)]) & 0xFF
    return bytes(o)

CN = set("的一是不了人我在有他这中大来上国个到说们为子和你地出道也时年得就那要下以生会自着去之过家学对可她里后小么心多天而能好都然没日于起还发成事只作当想看文无开手十用主行又如前所本见经头面公同三已老从动两长知民样现分将外但身些与高意进把法第实回二理美点月命门题边白海口太话间今真切活感声音眼笑确定取消保存读返开始结束游戏菜单设置音量退出否你他她它们呢吗啊吧呀哦嗯啦哈嘿喂诶哼么哪谁什当如果因为所以但虽然不过而且还有就让被给对向从到")
JP = set("ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロワヲンー、。！？「」『』（）…—・")

def classify(b, mode):
    """returns (kind, text). kind: 'note'(指示) / 'id'(ASCII) / 'text'(本文)"""
    if all(0x20 <= x < 0x7f or x in (9,10,13) for x in b):
        return ("id", b.decode("ascii", "replace"))
    if b[:1] in (b'#', b';') or re.match(rb'^[A-Z][A-Z0-9_]{1,15}:', b):
        return ("note", b.decode("cp932", "replace"))          # エンジン指示は原語(日本語)
    if mode == "jp":
        return ("text", b.decode("cp932", "replace"))
    if mode == "cn":
        return ("text", b.decode("gbk", "replace"))
    # auto: 文字列ごとに判別
    j = b.decode("cp932", "replace"); g = b.decode("gbk", "replace")
    js = sum(ch in JP for ch in j) + sum(0x4e00 <= ord(c) <= 0x9fff for c in j)*0.3 - j.count("�")
    gs = sum(ch in CN for ch in g) + sum(0x4e00 <= ord(c) <= 0x9fff for c in g)*0.3 - g.count("�")
    if any(p in g for p in "，。！？：；「」『』（）…—、"): gs += 3
    return ("text", g) if gs >= js else ("text", j)

def is_texty(b):
    return len(b) >= 2 and not any(x < 0x20 and x not in (9,10,13) for x in b)

def main():
    ap = argparse.ArgumentParser()
    # 既定は日本語版。中文版は: --src original_game/saimin4_cn/md_scr.med --out <_TEXT>/md_scr_text_cn --mode cn
    ap.add_argument("--src", default=os.path.join(ROOT, "original_game", "saimin4_jp", "md_scr.med"))
    ap.add_argument("--out", default=os.path.join(_TEXT, "md_scr_text_jp"))
    ap.add_argument("--mode", choices=["auto","jp","cn"], default="auto")
    a = ap.parse_args()

    data = open(a.src, "rb").read()
    ents = parse_index(data)
    key = recover_key(data, ents)
    print("src   :", a.src)
    print("entries:", len(ents), " 復号鍵:", repr(key.decode("cp932","replace")), key.hex(), " mode:", a.mode)

    os.makedirs(a.out, exist_ok=True)
    combined = open(os.path.join(a.out, "_ALL_dialogue.txt"), "w", encoding="utf-8")
    stats = {"text":0, "note":0, "id":0}; nlines = 0
    for name, size, eo in ents:
        body = decrypt(data[eo:eo+size], key)[0x10:]
        rows = []
        for s in body.split(b"\0"):
            if not is_texty(s): continue
            kind, txt = classify(s, a.mode); txt = txt.strip()
            if not txt: continue
            stats[kind] += 1; rows.append((kind, txt))
        if rows:
            fn = os.path.join(a.out, re.sub(r"[^A-Za-z0-9_]+","_",name)+".txt")
            with open(fn, "w", encoding="utf-8") as f:
                for kind, txt in rows: f.write("[%s] %s\n" % (kind, txt))
            combined.write("\n##### %s #####\n" % name)
            for kind, txt in rows:
                if kind == "text": combined.write(txt+"\n"); nlines += 1
    combined.close()
    print("分類:", stats, " 本文行(_ALL_dialogue.txt):", nlines)
    print("出力:", a.out)

if __name__ == "__main__":
    main()
