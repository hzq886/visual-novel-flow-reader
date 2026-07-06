#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""med — MDE0（MED / MarbleSoft エンジン）コンテナの共通デコードプリミティブ。

`extract-flow.py`・`extract-items.py`・`extract-scenes.py` が共有する低レベル処理を集約する:
  - MDE0 index パース（`parse_container`）
  - payload 復号（`decrypt`、鍵 `tauromin`）
  - シーン脚本の線形レコード読み（`linear_records`。`u16 lineno + u8 len + data[len]`）

SMAIN 固有の 3 層分解（ラベル表つき・厳密 +1 lineno）や、各スクリプト固有の文字列表アクセス
規約（extract-flow の `SceneScript.s` は 1 始まり、extract-items は 0 始まり）は呼び出し側に残す。
本モジュールは「どのスクリプトでもバイト単位で同一」なプリミティブのみを提供する。
"""
import struct

# MED 復号鍵（_VIEW クリブから復元済。text_unpack_guide.md §4）。
KEY = b"tauromin"


def parse_container(data):
    """MDE0 コンテナの index をパースし [(name, size, entry_offset), ...] を返す。"""
    assert data[:4] == b"MDE0", "not MDE0: %r" % data[:4]
    recsize, count = struct.unpack_from("<HH", data, 4)
    ents = []
    off = 0x10
    for _ in range(count):
        name = data[off:off + recsize - 12].split(b"\0")[0].decode("ascii", "replace")
        _, size, eo = struct.unpack_from("<III", data, off + recsize - 12)
        off += recsize
        ents.append((name, size, eo))
    return ents


def decrypt(entry):
    """エントリ本体（16B サブヘッダ + payload）の payload を鍵 `tauromin` で復号する。"""
    out = bytearray(entry)
    for p in range(0x10, len(out)):
        out[p] = (out[p] + KEY[p % len(KEY)]) & 0xFF
    return bytes(out)


def linear_records(payload, limit):
    """シーン脚本の命令列を線形に読む（`u16 lineno + u8 len + データ[len]`）。

    lineno はソース行番号で非減少（SMAIN の厳密 +1 とは異なる）ため、len 前置で線形に読む。
    limit（= subheader unk1 = レコード列終端）まで。返り値は (pos, lineno, length, args) タプル列。
    """
    records, p = [], 0
    while p + 3 <= limit:
        lineno = struct.unpack_from("<H", payload, p)[0]
        length = payload[p + 2]
        if p + 3 + length > limit:
            break
        records.append((p, lineno, length, payload[p + 3:p + 3 + length]))
        p += 3 + length
    return records
