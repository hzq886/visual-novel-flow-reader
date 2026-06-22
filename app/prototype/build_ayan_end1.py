#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""綾菜 END1 妊娠 ルート — 連貫読み物テキスト生成。
md_scr_text/*.txt から、攻略準拠のシーン順で [cn] 本文を抽出し、
選択肢ファイルは綾菜END1分岐のみを残して整形連結する。"""
import os, re

SRC = "../3_抽出データ/文字/md_scr_text"

# ───────── シーン順（SMAINフロー＋攻略準拠。共通ルートは翼・真琴を撤退でスキップ） ─────────
SCENES = [
 # ===== 共通ルート =====
 ("== プロローグ ==", None),
 "001_PRO001A","001_PRO001B","001_PRO001C","001_PRO001D","001_PRO001E","001_PRO001F","001_PRO001G","001_PRO001H","001_PRO001K",
 "001_PRO002A","001_PRO002B","001_PRO002B2","001_PRO002B3","001_PRO002C","001_PRO002D","001_PRO002E","001_PRO002F","001_PRO002G",
 ("== 綾菜との日常① ==", None),
 "002_AYAN001A","002_AYAN001B",
 "001_PRO002H",
 ("== 翼との接触 → 後悔して引く ==", None),
 # TUBA001D は TUBA001E の懊悔分岐とほぼ重複のため除外
 "006_TUBA001A","006_TUBA001B","006_TUBA001B2","006_TUBA001C","006_TUBA001E",
 ("== 綾菜との日常② ==", None),
 "002_AYAN002A","002_AYAN002B","002_AYAN002C","002_AYAN002D",
 "010_MAIN001A","001_PRO002I",
 ("== 真琴との接触 → 怒り・後悔して引く ==", None),
 "005_MAKO001A","005_MAKO001B","005_MAKO001C","005_MAKO001D","005_MAKO001E",
 "010_MAIN002A","001_PRO002J",
 ("== 綾菜との日常③ ==", None),
 "002_AYAN003A","002_AYAN003B","002_AYAN003C","002_AYAN004A","002_AYAN004B",
 "010_MAIN003A",
 # ===== 姉妹ルート（綾菜＋凉菜） =====
 ("== 姉妹ルート開始 ==", None),
 "002_AYAN005A","002_AYAN005B","002_AYAN005C",
 "011_SUBA001A",
 "003_SUZU001A","003_SUZU001B","003_SUZU001C","003_SUZU001D","003_SUZU001E",
 "011_SUBA002A",
 "003_SUZU002A","003_SUZU002B","003_SUZU002C","003_SUZU002D",
 "011_SUBA003A",
 "005_MAKO017A","005_MAKO017B","005_MAKO017C",
 "003_SUZU003A","003_SUZU003B","003_SUZU003C","003_SUZU003D","003_SUZU003E","003_SUZU003F",
 "011_SUBA004A",
 "002_AYAN006A","002_AYAN006B","002_AYAN006C","002_AYAN006D",
 "011_SUBA005A",
 "003_SUZU004A","003_SUZU004B","003_SUZU004C","003_SUZU004D","003_SUZU004E",
 "002_AYAN007A","002_AYAN007B","002_AYAN007C",
 "003_SUZU005A","003_SUZU005B","003_SUZU005C",
 # ===== 綾菜コミット → END1 妊娠 =====
 ("== 綾菜を「特別」に選ぶ ==", None),
 "002_AYAN008A",
 "002_AYAN009A","002_AYAN009B","002_AYAN009C",
 ("== 関键词を告げる → END1 妊娠 ==", None),
 "002_AYAN010A","002_AYAN010B","002_AYAN011A","002_AYAN011B","002_AYAN012A","002_AYAN012B",
]

# ───────── 分岐ファイルのキープ範囲（生.txt の1始まり行番号、両端含む） ─────────
# 範囲外の行は捨てる。指定なしのファイルは全[cn]採用。
KEEP = {
 "006_TUBA001B": [(1,162)],                       # 末尾メニュー(立刻后悔/沉溺)を除外
 "006_TUBA001C": [(1,242),(248,320)],             # 「我也到达了极限」分岐
 "006_TUBA001E": [(1,14),(19,42)],                # 「懊悔自己的所作所为」分岐
 "005_MAKO001D": [(1,15),(20,64)],                # 「后悔」分岐
 "005_MAKO001E": [(1,24)],                         # 撤退(前ブロック)
 "003_SUZU004C": [(1,382),(387,471)],             # 「任由她摆布」分岐
 "003_SUZU004E": [(1,30),(34,74)],                # 「就这样继续，享受和她们的秘密」分岐
 "002_AYAN008A": [(1,75),(91,134)],               # 「绫姐姐是特别的存在」分岐(MIX後)
 "002_AYAN010A": [(1,44),(49,96)],                # 「说出关键词」分岐(MIX前)
 "011_SUBA003A": [(1,132)],
 # 複雑系
 "005_MAKO001A": [(1,219)],                        # 「充满了愤怒」ブロック(214-219)まで含める
 "002_AYAN004B": [(1,211)],
 "003_SUZU004D": [(1,119),(148,676)],             # 「不要犹豫」分岐(MIX01〜MIX02)
 "010_MAIN003A": [(1,16)],                         # 姉妹/綾菜ブロック
}

def load(fn):
    p=os.path.join(SRC,fn+".txt")
    return open(p,encoding="utf-8").read().split("\n")

def in_ranges(i, ranges):
    if ranges is None: return True
    return any(a<=i<=b for a,b in ranges)

FILLER = {"…","。","…。","……。","………。","……","………"}

def extract(fn):
    lines=load(fn)
    ranges=KEEP.get(fn)
    out=[]
    title=None
    for i,l in enumerate(lines,1):
        if not l.startswith("[cn]"): continue
        if not in_ranges(i,ranges): continue
        t=l[5:].strip()
        if not t: continue
        # 1文字ゴミ行（バイナリヘッダ誤判定）を除外
        if len(t)==1 and t not in "…。、！？「」": continue
        if "�" in t: continue
        # 1行目がタイトル（\N 含む）の場合
        if title is None and ("\\N" in t or "\\n" in t):
            title=t.replace("\\N","／").replace("\\n","／"); continue
        out.append(t)
    return title, out

def fmt(scene_title, fn, body):
    """話者【名】＋「台詞」を統合、地の文はそのまま。"""
    res=[]
    head = f"【{scene_title}】" if scene_title else f"【{fn}】"
    res.append("\n"+"─"*54)
    res.append(f"◆ {head}   〔{fn}〕")
    res.append("─"*54)
    pend_spk=None
    for t in body:
        m=re.match(r"^【(.+?)】$", t)
        if m:
            pend_spk=m.group(1); continue
        if pend_spk:
            # 台詞行（「」始まり想定だがそうでなくても結合）
            res.append(f"{pend_spk}：{t}")
            pend_spk=None
        else:
            res.append(t)
    return res

def main():
    doc=[]
    doc.append("催眠（saimin4）  綾菜 END1 妊娠 ルート — 連貫読み物テキスト")
    doc.append("※ md_scr_text 抽出本文を攻略の選択に沿って綾菜END1経路のみ連結。")
    doc.append("※ [cn]=本編台詞/地の文。演出コメント・音声IDは除外。選択肢は綾菜END1分岐のみ採用。")
    n_scene=0
    for item in SCENES:
        if isinstance(item, tuple):
            doc.append("\n\n"+"="*54)
            doc.append("　"+item[0])
            doc.append("="*54)
            continue
        title, body = extract(item)
        if not body:
            doc.append(f"\n（空: {item}）"); continue
        doc.extend(fmt(title, item, body))
        n_scene+=1
    text="\n".join(doc)
    out="綾菜_END1_妊娠_ルート.txt"
    open(out,"w",encoding="utf-8").write(text)
    print("シーン数:",n_scene)
    print("総行数:",text.count("\n")+1)
    print("文字数:",len(text))
    print("出力:",out)

if __name__=="__main__":
    main()
