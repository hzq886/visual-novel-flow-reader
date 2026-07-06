#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""extract-scenes — シーン脚本 bytecode を正規化イベント列へ抽出（HU-73 / Sprint6）。

`md_scr.med` の本編シーン（コードが数字始まり）ごとに、描画/音声/本文の命令を **忠実な
イベント列**へ写し、`app/player/data/scene-events/<locale>.json`（jp+cn の 2 バンドル・
committed 生成物）を生成する。これが txt（文字列表ダンプ＝再参照が欠落）に代わる beat 生成の
一次ソースになる（HU-74 の buildScene が消費）。

シーン脚本の文字列参照は **0 始まり**（SMAIN の 1 始まりと異なる。HU-70 / smain_flow_guide §3.12）。
opcode → イベント（content を担う op のみ。flow/flag/timing 命令は beat 非関与で無視）:

  0x01 <idx>                    text      本文 1 行（0x00 は行終端＝暗黙・無視）
  0x0d <idx>                    speaker   話者名（主人公含む全発話に明示）
  0x14 <idx>                    voice     ボイス ID
  0x15 <idx> / 0x16 <idx>       se        効果音コード（0x16 は se 変種・当面 se 扱い）
  0x10 <byte1> <idx>           bg        背景/EV/黒（byte1 全モード。label で bg/EV/黒を分類）
  0x12 <mode> <cnt> <idx>*cnt   sprite    立ち絵スロット列（"-"=空き / null=0xffff 変更なし）
                                          mode bit 0x80 無し=establishing shot→第3要素 reset=true
                                          （適用前に全スロットをクリア。シーン転換の全体差し替え・HU-77）
  0x3b 00 <idx> <x> <y> 00      item      アイテム CG 窓（座標込み）
  0x3c 00                       itemclose アイテム窓の破棄
  0x6a <idx>                    off/bgv   立ち絵オフ / 背景ボイス（指す文字列で判別）
  0x6c <idx>                    flash     EFFECT:FLASHn（n=1-3。他 EFFECT: は無視）
  string[0]（\\N を含む）        title     タイトルカード（scene 級。0x2c 起点・現行規則と一致）

出力は原データ未配置時はスキップ（committed の既存を維持）。

使い方:
  python3 scripts/extract-scenes.py [--out-dir <data/scene-events>]
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
DEFAULT_OUT_DIR = os.path.join(_APP_PLAYER, "data", "scene-events")
SRC_BY_LOCALE = {
    "jp": os.path.join(ROOT, "original_game", "saimin4_jp", "md_scr.med"),
    "cn": os.path.join(ROOT, "original_game", "saimin4_cn", "md_scr.med"),
}
ENCODING_BY_LOCALE = {"jp": "cp932", "cn": "gbk"}

# content を担う op（イベント化する）。
HANDLED_OPS = {0x01, 0x0D, 0x14, 0x15, 0x16, 0x10, 0x12, 0x2C, 0x3B, 0x3C, 0x6A, 0x6C}
# beat に非関与と確認済みの op（HU-71 census で全数走査）。flow/flag/timing/演出パラメータ等。
# これらの u16 オペランドが偶然 content 文字列 index に一致することがあるが数値（wait 値・jump
# offset・fade ms・座標・flag slot）であり content 参照ではない（0x19 は -100〜14 の signed wait、
# 0x0a は f5…ff の menu/flag シグネチャ、0x26 は fade ms、0x3d は item 窓アニメ座標 等）。
IGNORED_OPS = {
    0x00, 0x02, 0x03, 0x04, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x13, 0x17, 0x19, 0x1A,
    0x1B, 0x1C, 0x1D, 0x1E, 0x1F, 0x21, 0x25, 0x26, 0x2A, 0x3D, 0x4F, 0x68, 0x6D,
}
NO_REF = 0xFFFF  # 0x12 スロットの「変更なし」番兵


def decode_string(b, enc):
    """文字列を種別ごとの符号化で復号（extract_text.py の classify と同一規則）。

    エンジン指示（`#背景…`/`#EV…`/`#<キャラ>…` 等の note、コロン命令）は **jp/cn とも日本語**
    （Shift-JIS）で格納されるため常に cp932。ASCII 専用（voice/se/id）はそのまま。本文・話者名・
    タイトルのみロケール言語（jp=cp932 / cn=gbk）で復号する。
    """
    if all(0x20 <= x < 0x7F or x in (9, 10, 13) for x in b):
        return b.decode("ascii", "replace").strip()
    if b[:1] in (b"#", b";") or re.match(rb"^[A-Z][A-Z0-9_]{1,15}:", b):
        return b.decode("cp932", "replace").strip()
    # 本文・話者・タイトル。行頭の全角インデント（U+3000）等も strip（extract_text.py と同一＝
    # 現行 parseScene 出力との parity。インデント保持は別途）。
    return b.decode(enc, "replace").strip()


def parse_scene(full):
    """復号済みエントリ → (records, strings)。records=(pos,lineno,length,args)、strings=生バイト列。"""
    _, unk1, _, c2, _ = struct.unpack_from("<IIHHI", full[:0x10], 0)
    pl = full[0x10:]
    records = linear_records(pl, unk1)
    raw = pl[unk1 + 2 * c2:]
    strings, i = [], 0
    while i < len(raw):
        j = raw.find(b"\0", i)
        if j < 0:
            j = len(raw)
        strings.append(raw[i:j])
        i = j + 1
    return records, strings


def classify(b):
    """文字列のクラス（content 網羅チェック用）。extract_text.py の分類と整合。"""
    if b == b"" or len(b) < 2:
        return "empty"
    t = b.decode("cp932", "replace")
    if t.startswith("#"):
        return "note"
    if t.startswith("【"):
        return "speaker"
    if re.match(r"^ITEM_\d+_\d+$", t) or t in ("BG_BLACK", "OFF") or re.match(r"^BGV_", t):
        return "id"
    if re.match(r"^[A-Z]+_\d{3}_", t) or re.match(r"^\d{4}[A-Za-z]$", t):
        return "id"
    if all(0x20 <= x < 0x7F for x in b):
        return "ascii"  # EFFECT:/MIX/_VIEW 等の制御。content ではない
    return "text"


def scan_locale(locale, coverage):
    """1 ロケールの md_scr.med → {code: {title?, events:[...]}}。coverage は取りこぼし集計 dict。"""
    data = open(SRC_BY_LOCALE[locale], "rb").read()
    enc = ENCODING_BY_LOCALE[locale]
    out = {}
    for name, size, eo in parse_container(data):
        if not re.match(r"^\d", name):  # 本編シーンのみ（定義・演出マクロ表を除外）
            continue
        records, strings = parse_scene(decrypt(data[eo:eo + size]))

        def s(idx):
            return decode_string(strings[idx], enc) if 0 <= idx < len(strings) else ""

        events = []
        item_open = 0
        for pos, lineno, length, args in records:
            op = args[0] if length else -1

            # content 網羅チェック: HANDLED でも IGNORED でもない **未知 op** が content 文字列を
            # 指したら取りこぼし候補として記録（将来 opcode が増えたら発火。既知 op の偶発一致では
            # 鳴らない）。既知 op の分類は HU-71 census で全数確定済。
            if op not in HANDLED_OPS:
                if op not in IGNORED_OPS:
                    for off in range(1, length - 1):
                        v = struct.unpack_from("<H", args, off)[0]
                        if 1 <= v < len(strings) and classify(strings[v]) in ("text", "note", "id"):
                            coverage.setdefault(op, []).append(f"{name}:L{lineno} [{v}]{s(v)[:24]}")
                continue

            if op == 0x01 and length == 3:
                events.append(["text", s(struct.unpack_from("<H", args, 1)[0])])
            elif op == 0x2C and length == 3:
                # タイトルカード命令。idx0 = 冒頭タイトル（scene 級で別途出力）＝ここでは無視。
                # idx>=1 = 中盤のセクションカード（"朝の風景\\N…" 等）→ 本文行として流す
                # （buildScene が \\N を検出して section card 化。現行 isSectionCard と整合）。
                idx = struct.unpack_from("<H", args, 1)[0]
                if idx != 0:
                    events.append(["text", s(idx)])
            elif op == 0x0D and length == 3:
                who = s(struct.unpack_from("<H", args, 1)[0]).strip("【】")
                events.append(["speaker", who])
            elif op == 0x14 and length == 3:
                events.append(["voice", s(struct.unpack_from("<H", args, 1)[0])])
            elif op in (0x15, 0x16) and length == 3:
                events.append(["se", s(struct.unpack_from("<H", args, 1)[0])])
            elif op == 0x10 and length == 4:
                events.append(["bg", s(struct.unpack_from("<H", args, 2)[0])])
            elif op == 0x12 and length >= 5:
                mode, cnt = args[1], args[2]
                slots = []
                for k in range(cnt):
                    v = struct.unpack_from("<H", args, 3 + 2 * k)[0]
                    slots.append(None if v == NO_REF else s(v))  # None=変更なし / "-"=空き
                # mode の 0x80 ビット無し（0x00）= establishing shot＝適用前に全スロットをクリアする
                # （シーン転換で構図を丸ごと差し替え。0x80 = 増分更新で他スロットを保持。HU-77）。
                reset = (mode & 0x80) == 0
                events.append(["sprite", slots, True] if reset else ["sprite", slots])
            elif op == 0x3B and length == 9:
                idx, x, y = struct.unpack_from("<HHH", args, 2)
                events.append(["item", s(idx), x, y])
                item_open += 1
            elif op == 0x3C:
                events.append(["itemclose"])
                item_open -= 1
            elif op == 0x6A and length == 3:
                v = s(struct.unpack_from("<H", args, 1)[0])
                if v == "OFF":
                    events.append(["off"])
                elif v.startswith("BGV_"):
                    events.append(["bgv", v])
            elif op == 0x6C and length == 3:
                m = re.match(r"^EFFECT:FLASH(\d)$", s(struct.unpack_from("<H", args, 1)[0]))
                if m:
                    events.append(["flash", int(m.group(1))])

        assert item_open == 0, f"{name}: アイテム窓の開閉が不均衡（{item_open}）"
        scene = {"events": events}
        if strings and (b"\\N" in strings[0] or b"\\n" in strings[0]):  # タイトル=string[0]
            scene["title"] = s(0)
        out[name] = scene
    return out


def dump_bundle(bundle):
    """イベントは 1 行ずつの読みやすい/diff しやすい形で JSON 直列化する。"""
    parts = []
    for code in sorted(bundle):
        sc = bundle[code]
        head = f"  {json.dumps(code)}: {{"
        body = []
        if "title" in sc:
            body.append(f'    "title": {json.dumps(sc["title"], ensure_ascii=False)},')
        if sc["events"]:
            evs = ",\n".join("      " + json.dumps(e, ensure_ascii=False) for e in sc["events"])
            body.append(f'    "events": [\n{evs}\n    ]')
        else:
            body.append('    "events": []')
        parts.append(head + "\n" + "\n".join(body) + "\n  }")
    return "{\n" + ",\n".join(parts) + "\n}\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", default=DEFAULT_OUT_DIR)
    a = ap.parse_args()

    per_locale = {}
    coverage = {}
    for locale, src in SRC_BY_LOCALE.items():
        if not os.path.exists(src):
            print(f"skip {locale}: 原データ未配置 ({src})")
            continue
        per_locale[locale] = scan_locale(locale, coverage)

    if not per_locale:
        print("原データが無いため scene-events は生成しない（committed の既存を維持）")
        return

    # content 網羅チェック（HANDLED 外の op が content を指していないか）。
    if coverage:
        print("⚠ 未処理 op が content 文字列を参照（取りこぼし候補・要確認）:")
        for op, exs in sorted(coverage.items()):
            print(f"   0x{op:02x}: {len(exs)}件  例 {exs[0]}")
    else:
        print("✓ content op 網羅: 未処理 op による content 参照なし")

    # jp/cn 構造対応チェック（text/speaker を除くイベント列が一致するか。非致命・報告のみ）。
    if len(per_locale) == 2:
        jp, cn = per_locale["jp"], per_locale["cn"]
        mismatch = []
        structural = lambda evs: [e for e in evs if e[0] not in ("text", "speaker")]
        for code in sorted(set(jp) & set(cn)):
            if structural(jp[code]["events"]) != structural(cn[code]["events"]):
                mismatch.append(code)
        if mismatch:
            print(f"⚠ jp/cn 構造差のあるシーン {len(mismatch)}件: {mismatch[:8]}")
        else:
            print("✓ jp/cn 構造一致（text/speaker 以外のイベント列が全シーンで一致）")

    os.makedirs(a.out_dir, exist_ok=True)
    for locale, bundle in per_locale.items():
        path = os.path.join(a.out_dir, f"{locale}.json")
        with open(path, "w", encoding="utf-8") as f:
            f.write(dump_bundle(bundle))
        n_ev = sum(len(sc["events"]) for sc in bundle.values())
        print(f"{locale}: {len(bundle)} シーン / {n_ev} イベント → {path}")


if __name__ == "__main__":
    main()
