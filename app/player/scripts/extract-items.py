#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""extract-items — アイテムCG窓の表示仕様（座標・表示区間）を一次ソースから機械生成（HU-70）。

原エンジンのアイテムCG（ITEM_xx_yy・400×400）は背景ではなく**専用のオーバーレイ窓**で表示される。
シーン脚本 bytecode の該当命令（文字列参照はすべて 0 始まり。smain_flow_guide.md §3.12）:

    3b 00 <u16 idx> <u16 x> <u16 y> 00   アイテムCG窓を論理座標 (x, y) に表示
    3d 00/01 …                           窓のイン/アウト演出
    3c 00                                窓の破棄（このタイミングは抽出テキストに現れない）

窓の表示区間（0x3b〜0x3c）内に表示される本文（`0x01` 参照）は全 13 シーンで一意・単調増加
（機械検証済）。よって「区間内の本文行数 texts」で表示区間を表現し、build-scenes（parseScene）が
[id] ITEM_* マーカーから texts 行の本文を消費した時点で窓を閉じる。
照合用に「閉じ直後の本文 nextText」も保持し、ズレは build 時に fail-fast させる。

texts/nextText は **locale 別**: cn は 2 行セリフを 1 行へ統合翻訳した箇所で 2 行目が
1 バイトのプレースホルダ（スペースのみ）になっており、抽出テキスト（is_texty で除外）にも
parseScene にも現れない。よって「parseScene が本文として数える行」と同じフィルタ
（texty・非 ASCII 専用・非 note・非話者【】）を通した参照だけを数える。

出力: data/items.json（committed 生成物・手編集禁止）。原データ未配置時はスキップ（既存を維持）。

使い方:
  python3 scripts/extract-items.py [--out <items.json>]
"""
import argparse
import json
import os
import re
import struct

from med import decrypt, linear_records, parse_container  # 共通 MED デコード（HU-72）

# repo パス: app/player/scripts -> repo root
_HERE = os.path.dirname(os.path.abspath(__file__))
_APP_PLAYER = os.path.dirname(_HERE)
ROOT = os.path.dirname(os.path.dirname(_APP_PLAYER))
DEFAULT_OUT = os.path.join(_APP_PLAYER, "data", "items.json")
SRC_BY_LOCALE = {
    "jp": os.path.join(ROOT, "original_game", "saimin4_jp", "md_scr.med"),
    "cn": os.path.join(ROOT, "original_game", "saimin4_cn", "md_scr.med"),
}
ENCODING_BY_LOCALE = {"jp": "cp932", "cn": "gbk"}

OP_TEXT, OP_ITEM_SHOW, OP_ITEM_CLOSE = 0x01, 0x3B, 0x3C


def parse_scene(full):
    """復号済みエントリ → (records, strings)。records は各命令の data[len]（args のみ）の列。"""
    _, unk1, _, c2, _ = struct.unpack_from("<IIHHI", full[:0x10], 0)
    pl = full[0x10:]
    records = [args for (_pos, _lineno, _length, args) in linear_records(pl, unk1)]
    raw = pl[unk1 + 2 * c2:]
    strings, i = [], 0
    while i < len(raw):
        j = raw.find(b"\0", i)
        if j < 0:
            j = len(raw)
        strings.append(raw[i:j])
        i = j + 1
    return records, strings


# ───────────────────────────── アイテム窓の抽出 ─────────────────────────────
def is_countable_text(b, enc):
    """この 0x01 参照が parseScene の本文カウント対象になるか。

    extract_text.py の出力（txt）に [text] 行として現れ、かつ parseScene が本文として
    消費する行だけを数える: texty（2 バイト以上・制御文字なし）／strip 後に非空／
    ASCII 専用でない（= [id] 行になる）／note（#・;・大文字ラベル:）でない／話者【…】でない。
    cn の統合翻訳プレースホルダ（スペース 1 バイト）はここで落ちる。
    """
    if len(b) < 2 or any(x < 0x20 and x not in (9, 10, 13) for x in b):
        return False
    if all(0x20 <= x < 0x7F or x in (9, 10, 13) for x in b):
        return False  # ASCII 専用 → [id]
    if b[:1] in (b"#", b";") or re.match(rb"^[A-Z][A-Z0-9_]{1,15}:", b):
        return False  # note
    t = b.decode(enc, "replace").strip()
    if t == "" or re.match(r"^【.+】$", t):
        return False  # 空 / 話者タグ（parseScene は本文として数えない）
    return True


def scan_locale(locale):
    """1 ロケールの md_scr.med から scene → {item, x, y, texts, nextText} を抽出する。"""
    data = open(SRC_BY_LOCALE[locale], "rb").read()
    enc = ENCODING_BY_LOCALE[locale]
    out = {}
    for name, size, eo in parse_container(data):
        if not re.match(r"^\d", name):  # 本編シーンのみ（定義・演出マクロ表を除外）
            continue
        records, strings = parse_scene(decrypt(data[eo:eo + size]))

        def s(idx0):  # 文字列表は 0 始まり参照
            return strings[idx0].decode(enc, "replace").strip()

        spec = None
        in_item = False
        for args in records:
            op = args[0] if args else -1
            if op == OP_ITEM_SHOW and len(args) == 9:
                assert spec is None, f"{name}: アイテム窓が複数ある（想定外・要フォーマット拡張）"
                idx, x, y = struct.unpack_from("<HHH", args, 2)
                spec = {"item": s(idx), "x": x, "y": y, "texts": 0, "nextText": None}
                assert re.match(r"^ITEM_\d+_\d+$", spec["item"]), f"{name}: 0x3b の参照先が ITEM でない: {spec['item']!r}"
                in_item = True
            elif op == OP_ITEM_CLOSE:
                in_item = False
            elif op == OP_TEXT and len(args) == 3 and spec is not None:
                idx = struct.unpack_from("<H", args, 1)[0]
                if not is_countable_text(strings[idx], enc):
                    continue
                if in_item:
                    spec["texts"] += 1
                elif spec["nextText"] is None:
                    spec["nextText"] = s(idx)
        if spec is not None:
            assert not in_item and spec["nextText"], f"{name}: アイテム窓が閉じられていない"
            out[name] = spec
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=DEFAULT_OUT)
    a = ap.parse_args()

    per_locale = {}
    for locale, src in SRC_BY_LOCALE.items():
        if not os.path.exists(src):
            print(f"skip {locale}: 原データ未配置 ({src})")
            continue
        per_locale[locale] = scan_locale(locale)

    if not per_locale:
        print("原データが無いため items.json は生成しない（committed の既存を維持）")
        return

    # ロケール間の構造一致を検証（item/x/y は言語非依存。texts は統合翻訳で locale 差あり）し、
    # 単一表に統合する。
    locales = sorted(per_locale)
    base = per_locale[locales[0]]
    for other in locales[1:]:
        assert set(per_locale[other]) == set(base), "ロケール間でアイテム出現シーンが不一致"
        for code, spec in base.items():
            o = per_locale[other][code]
            same = {k: spec[k] for k in ("item", "x", "y")}
            assert same == {k: o[k] for k in same}, f"{code}: ロケール間で窓仕様が不一致: {same} != {o}"

    items = {
        code: {
            "item": spec["item"],
            "x": spec["x"],
            "y": spec["y"],
            "texts": {loc: per_locale[loc][code]["texts"] for loc in locales},
            "nextText": {loc: per_locale[loc][code]["nextText"] for loc in locales},
        }
        for code, spec in sorted(base.items())
    }
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump({"items": items}, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"items: {len(items)} シーン → {a.out}")


if __name__ == "__main__":
    main()
