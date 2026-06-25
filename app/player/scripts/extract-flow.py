#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""extract-flow — 催眠4 のルート分岐グラフ（data/flow.json）を一次ソースから機械生成。

`md_scr.med`（MDE0 / MED エンジン）の `SMAIN` エントリは、ゲーム全体の進行を司る
マスタースクリプトであり、全ルート・全分岐・全エンドのシーン遷移をバイトコードで保持する。
本ツールはそれを復号・逆アセンブルして `Flow`（ADR 0002 / src/pipeline/types.ts）へ写像する。
HU-13 の暫定 route_map ポート（build-flow.ts）を置換する一次ソース（ADR 0005）。

SMAIN バイトコードの構造（逆解析結果。詳細は data_extract/text/_tools/smain_flow_guide.md）:
  - エントリ本体 = 16B サブヘッダ（平文）＋ payload（鍵 `tauromin` で復号）。
  - payload は 3 層:
      [0]            レコード列   : `u16 連番 + u8 長さL + L バイトのデータ`（L==オペコード値）
      [labelTblOff]  ラベル表     : u16 × 25（SMAIN_* hub の正規バイトオフセット）
      [strTblOff]    文字列表     : NUL 区切り（シーン名・hub ラベル名）
  - データ内側の先頭バイトが実オペコード:
      0x1b <u16 idx>   シーン呼び出し（idx = 文字列表 1 始まり）
      0x1c <u16 idx>   hub ラベルへの（条件）goto（idx = 文字列表 1 始まり）
      0x08/0x09 …      局所ジャンプ（提示イディオム。物語分岐ではない＝無視）
      0x1d …           select/フラグ判定マーカー
      その他            演出・区切り

使い方:
  python3 scripts/extract-flow.py [--src <md_scr.med>] [--out <flow.json>] [--disasm]
"""
import argparse
import json
import os
import re
import struct
from collections import Counter, defaultdict

# repo パス: app/player/scripts -> repo root
_HERE = os.path.dirname(os.path.abspath(__file__))
_APP_PLAYER = os.path.dirname(_HERE)
ROOT = os.path.dirname(os.path.dirname(_APP_PLAYER))
DEFAULT_SRC = os.path.join(ROOT, "original_game", "saimin4_jp", "md_scr.med")
DEFAULT_OUT = os.path.join(_APP_PLAYER, "data", "flow.json")
TEXT_DIR = os.path.join(ROOT, "data_extract", "text", "md_scr_text_jp")

KEY = b"tauromin"  # MED 復号鍵（_VIEW クリブから復元済。text_unpack_guide.md §4）

# シーンコード接頭辞（NNN_XXX）→ Flow キャラ enum。route_map の配色を踏襲。
CHAR_BY_TOKEN = {
    "PRO": "common", "MAIN": "common",
    "AYAN": "ayan", "SUBA": "ayan",
    "SUZU": "suzu", "FUTA": "suzu",
    "TUBA": "tuba", "SUBT": "tuba",
    "MAKO": "mako",
    "KAED": "kaede",
    "SUBTM": "tuba",  # 翼＋真琴 複合ルート（暫定 tuba レーン）
    "NUKE": "omake",
}


# ───────────────────────── MDE0 コンテナ / SMAIN 復号 ─────────────────────────
def parse_container(data):
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
    out = bytearray(entry)
    for p in range(0x10, len(out)):
        out[p] = (out[p] + KEY[p % len(KEY)]) & 0xFF
    return bytes(out)


# ───────────────────────── SMAIN payload の逆アセンブル ─────────────────────────
class Smain:
    """SMAIN payload を 3 層（レコード列 / ラベル表 / 文字列表）に分解する。"""

    def __init__(self, payload):
        self.payload = payload
        # 文字列表は payload 末尾側の NUL 区切り ASCII 群。最初のシーン名（NNN_XXX）出現位置を起点に。
        m = re.search(rb"\d{3}_[A-Z]", payload)
        assert m, "SMAIN に文字列表の起点（NNN_XXX）が見つからない"
        self.str_off = m.start()
        self.strings = self._parse_strings(payload[self.str_off:])
        # レコード列は payload 先頭から、文字列表手前まで。最終レコード直後にラベル表が挟まる。
        self.records, self.rec_end = self._parse_records(payload, self.str_off)

    @staticmethod
    def _parse_strings(buf):
        strings, i = [], 0
        while i < len(buf):
            j = buf.find(b"\0", i)
            if j < 0:
                j = len(buf)
            if j > i:
                strings.append(buf[i:j].decode("cp932", "replace"))
            i = j + 1
        return strings

    @staticmethod
    def _parse_records(payload, limit):
        """`u16 連番 + u8 長さ + データ` を、連番が 1 ずつ増える制約で読む。
        破綻（次の連番が一致しない）した位置でレコード列終端＝ラベル表開始とみなす。"""
        records = []
        p, expected = 0, 0
        while p + 3 <= limit:
            lineno = struct.unpack_from("<H", payload, p)[0]
            if lineno != expected:
                break
            length = payload[p + 2]
            if p + 3 + length > limit:
                break
            args = payload[p + 3:p + 3 + length]
            records.append((p, lineno, length, args))
            p += 3 + length
            expected += 1
        return records, p

    def string(self, idx_1based):
        return self.strings[idx_1based - 1]


# ───────────────────────── イベント列（シーン / hub / END） ─────────────────────────
HUB_END = {"NORMAL_END", "TRUE_END"}


def is_real_scene(code):
    return bool(re.match(r"^\d{3}_[A-Z]", code))


def char_of(code):
    m = re.match(r"^\d{3}_([A-Z]+?)\d", code)
    if not m:
        return "common"
    return CHAR_BY_TOKEN.get(m.group(1), "common")


def extract_events(sm):
    """レコード列を走査し、ノードになるイベント（scene / hub / end / staff）を順に返す。
    各イベント = dict(kind, name, pos, cond)。直前の 0x1d は次イベントへ choice フラグとして付与。"""
    events = []
    pending_cond = None
    for (pos, lineno, length, args) in sm.records:
        if not args:
            continue
        op = args[0]
        # 検証済みの select マーカーのみ: `1d 00 <id> f5 f5 eb 01 ff`（len 8）。
        # id は SMAIN ローカルの選択分岐 id（_DEF 軸フラグへの解決は後続課題）。
        if length == 8 and op == 0x1d and args[3:6] == b"\xf5\xf5\xeb":
            pending_cond = "SEL_%02X" % args[2]
            continue
        if op != 0x1b and op != 0x1c:
            continue
        idx = struct.unpack_from("<H", args, 1)[0]
        name = sm.string(idx)
        if op == 0x1b:
            kind = "staff" if name == "STAFF_ROLL" else "scene"
        else:  # 0x1c
            kind = "end" if name in HUB_END else "hub"
        events.append({"kind": kind, "name": name, "pos": pos, "cond": pending_cond})
        pending_cond = None
    return events


# ───────────────────────── グラフ構築（ノード=ユニーク名、エッジ=連接） ─────────────────────────
class Graph:
    def __init__(self):
        self.scenes = {}   # node_id -> ordered list of scene codes（収縮で増える）
        self.kind = {}     # node_id -> 'start'|'arc'|'branch'|'end'|'omake'
        self.firstpos = {} # node_id -> 最小 payload オフセット（レイアウト順）
        self.adj = defaultdict(dict)  # u -> {v: cond_label_or_None}
        self.indeg = Counter()

    def add_node(self, nid, kind, scene_codes, pos):
        if nid not in self.kind:
            self.kind[nid] = kind
            self.scenes[nid] = list(scene_codes)
            self.firstpos[nid] = pos
        else:
            self.firstpos[nid] = min(self.firstpos[nid], pos)

    def add_edge(self, u, v, cond=None):
        if u == v:
            return
        if v not in self.adj[u]:
            self.adj[u][v] = cond
            self.indeg[v] += 1
        elif cond and not self.adj[u][v]:
            self.adj[u][v] = cond

    def outdeg(self, u):
        return len(self.adj[u])


def node_id_of(ev):
    """イベント → ノード id。scene はコード自身、hub/end/staff は名前。"""
    return ev["name"]


def kind_of(ev):
    return {"scene": "arc", "hub": "branch", "end": "end", "staff": "omake"}[ev["kind"]]


def build_graph(events):
    g = Graph()
    START = "start"
    g.add_node(START, "start", [], -1)
    # ノード登録（同名は集約＝再入シーン・合流 hub が 1 ノードに畳まれる）
    for ev in events:
        nid = node_id_of(ev)
        codes = [ev["name"]] if ev["kind"] == "scene" else []
        g.add_node(nid, kind_of(ev), codes, ev["pos"])
    # 連接エッジ。END は終端なので END からの流出は張らない（直後は別ブロックの入口）。
    prev = START
    prev_kind = "start"
    for ev in events:
        nid = node_id_of(ev)
        if prev_kind != "end":
            g.add_edge(prev, nid, ev.get("cond"))
        prev, prev_kind = nid, ev["kind"]
    return g, START


# キャラ → ルート hub の語幹候補（ルート入口を hub へ結ぶための一致キー）。
ROUTE_BASES = {
    "ayan": ["AYAN"], "suzu": ["SUZU", "SISTER"], "tuba": ["TUBA"],
    "mako": ["MAKO"], "kaede": ["KAED", "TUBA"], "common": [],
}


def hub_base(nid):
    return re.sub(r"\d+$", "", nid.replace("SMAIN_", ""))


def resolve_entries(g, start):
    """END で分断され流入 0 になったルート入口を、ルート名の一致する hub（無ければ start）へ結ぶ。
    SMAIN の if/else レイアウト上、分岐先ブロックは END の後に置かれ連接では到達できないため。
    正確な goto オフセット解決は HU-16（ラベル表照合）で精緻化。"""
    hubs = [n for n in g.kind if g.kind[n] == "branch"]
    ends = [n for n in g.kind if g.kind[n] == "end"]
    for nid in list(g.kind):
        if nid == start or g.indeg[nid] > 0:
            continue
        pos = g.firstpos[nid]
        if g.kind[nid] == "arc":
            # ルート入口: ルート名一致の hub のうち入口より前で最も近い → 一致する最初 → start
            bases = ROUTE_BASES.get(char_of_node(g, nid), [])
            match = [h for h in hubs if hub_base(h) in bases]
            before = [h for h in match if g.firstpos[h] <= pos]
            src = (max(before, key=lambda h: g.firstpos[h]) if before
                   else min(match, key=lambda h: g.firstpos[h]) if match
                   else start)
        else:
            # スタッフロール等の omake はエンディング後に流れる → 直近の END（無ければ start）から
            before = [e for e in ends if g.firstpos[e] <= pos]
            src = max(before, key=lambda e: g.firstpos[e]) if before else (ends[0] if ends else start)
        g.add_edge(src, nid, None)


def contract_chains(g, start):
    """in/out 次数 1 の直列ラン（arc 同士）を 1 ノードへ収縮。hub/end/start/omake は境界として保つ。"""
    changed = True
    while changed:
        changed = False
        for u in list(g.adj.keys()):
            if u not in g.kind or g.kind[u] != "arc" or g.outdeg(u) != 1:
                continue
            v = next(iter(g.adj[u]))
            if v == start or g.kind.get(v) != "arc" or g.indeg[v] != 1:
                continue
            # u の唯一の後続 v（in 次数1）を u へ吸収
            g.scenes[u].extend(g.scenes[v])
            # v の後続を u へ付け替え
            del g.adj[u][v]
            g.indeg[v] -= 1
            for w, cond in g.adj.get(v, {}).items():
                g.indeg[w] -= 1  # v からの分を一旦減らし add_edge で復元
                g.add_edge(u, w, cond)
            # v を撤去
            g.adj.pop(v, None)
            g.kind.pop(v, None)
            g.scenes.pop(v, None)
            g.firstpos.pop(v, None)
            changed = True
            break
    return g


# ───────────────────────── レイアウト（層化 DAG） ─────────────────────────
def assign_columns(g, start):
    """前方エッジ（target.firstpos > source.firstpos）の最長距離で列を決める（後方=再入は無視）。"""
    col = {}
    order = sorted(g.kind, key=lambda n: g.firstpos[n])

    def fwd(u, v):
        return g.firstpos[v] > g.firstpos[u]

    for n in order:
        col[n] = 0
    # firstpos 昇順に走査すれば前方エッジは確定済みの祖先のみ参照
    for u in order:
        for v in g.adj.get(u, {}):
            if fwd(u, v):
                col[v] = max(col[v], col[u] + 1)
    return col


CHAR_LANE = {"common": 0, "ayan": 1, "suzu": 2, "tuba": 3, "mako": 4, "kaede": 5,
             "branch": 0, "end": 0, "omake": 6, "start": 0}


def layout(g, start):
    col = assign_columns(g, start)
    COLW, ROWH = 300, 120
    # 列ごとに firstpos 順で縦積み（キャラレーンで軽くバイアス）
    by_col = defaultdict(list)
    for n in g.kind:
        by_col[col[n]].append(n)
    pos = {}
    for c, nodes in by_col.items():
        nodes.sort(key=lambda n: (CHAR_LANE.get(char_of_node(g, n), 0), g.firstpos[n]))
        for row, n in enumerate(nodes):
            pos[n] = (c * COLW, row * ROWH)
    return pos


def char_of_node(g, n):
    k = g.kind[n]
    if k == "branch":
        return "branch"
    if k == "end":
        return "end"
    if k == "omake":
        return "omake"
    if k == "start":
        return "common"
    # arc: 内包シーンの最多キャラ
    chars = Counter(char_of(c) for c in g.scenes[n])
    return chars.most_common(1)[0][0] if chars else "common"


# ───────────────────────── Flow JSON 出力 ─────────────────────────
END_TITLE = {"NORMAL_END": "ノーマルEND", "TRUE_END": "トゥルーEND"}
HUB_ICON = "◆"


def short(code):
    """002_AYAN001A -> AYAN001A（表示用）。"""
    return re.sub(r"^\d{3}_", "", code)


def node_title(g, nid):
    k = g.kind[nid]
    if k == "start":
        return "スタート"
    if k == "end":
        return END_TITLE.get(nid, nid)
    if k == "omake":
        return "スタッフロール"
    if k == "branch":
        return nid.replace("SMAIN_", "")
    codes = g.scenes[nid]
    if not codes:
        return nid
    if len(codes) == 1:
        return short(codes[0])
    return "%s‥%s" % (short(codes[0]), short(codes[-1]))


def node_icon(g, nid):
    k = g.kind[nid]
    return {"start": "▶", "branch": "◆", "end": "★", "omake": "🎬"}.get(k)


def to_flow(g, start, real_codes):
    pos = layout(g, start)
    nodes = []
    for nid in sorted(g.kind, key=lambda n: (pos[n][0], pos[n][1])):
        k = g.kind[nid]
        scenes = [c for c in g.scenes[nid] if c in real_codes]
        node = {
            "id": nid,
            "kind": k,
            "character": char_of_node(g, nid),
            "title": node_title(g, nid),
        }
        ico = node_icon(g, nid)
        if ico:
            node["icon"] = ico
        node["pos"] = {"x": pos[nid][0], "y": pos[nid][1]}
        node["scenes"] = scenes
        nodes.append(node)
    edges = []
    for u in g.adj:
        for v, cond in g.adj[u].items():
            e = {"source": u, "target": v}
            uc = char_of_node(g, u)
            if uc not in ("branch", "end", "omake"):
                e["character"] = uc
            if cond:
                e["condition"] = {"flags": [cond]}
            edges.append(e)
    edges.sort(key=lambda e: (e["source"], e["target"]))
    return {"nodes": nodes, "edges": edges}


# ───────────────────────── disasm ダンプ（監査用） ─────────────────────────
def dump_disasm(sm, events):
    print("# SMAIN disasm: %d records, %d strings, str_off=0x%04x rec_end=0x%04x"
          % (len(sm.records), len(sm.strings), sm.str_off, sm.rec_end))
    opcount = Counter(args[0] for (_, _, _, args) in sm.records if args)
    print("# inner-opcode histogram:", dict(opcount.most_common()))
    for ev in events:
        tag = {"scene": "S ", "hub": "H>", "end": "E*", "staff": "##"}[ev["kind"]]
        cond = "  <%s>" % ev["cond"] if ev["cond"] else ""
        print("  %s %s%s" % (tag, ev["name"], cond))


# ───────────────────────── main ─────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=DEFAULT_SRC)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--disasm", action="store_true", help="逆アセンブル列を stdout に出して終了")
    a = ap.parse_args()

    if not os.path.isfile(a.src):
        # 原データ（md_scr.med）は git 外。未配置なら committed の flow.json を保ったまま黙ってスキップ。
        # （data:all を生データ無しの環境でも通すため。一次生成にはローカルに原ファイルが要る）
        print("[extract-flow] 原データ未配置のためスキップ: %s" % a.src)
        return

    data = open(a.src, "rb").read()
    ents = parse_container(data)
    name, size, eo = next(e for e in ents if e[0] == "SMAIN")
    payload = decrypt(data[eo:eo + size])[0x10:]
    sm = Smain(payload)
    events = extract_events(sm)

    if a.disasm:
        dump_disasm(sm, events)
        return

    real_codes = set()
    if os.path.isdir(TEXT_DIR):
        real_codes = {f[:-4] for f in os.listdir(TEXT_DIR) if re.match(r"^\d.*\.txt$", f)}

    g, start = build_graph(events)
    resolve_entries(g, start)
    contract_chains(g, start)
    flow = to_flow(g, start, real_codes)

    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(flow, f, ensure_ascii=False, indent=2)
        f.write("\n")

    n_scene = len({c for n in flow["nodes"] for c in n["scenes"]})
    n_hub = sum(1 for n in flow["nodes"] if n["kind"] == "branch")
    n_end = sum(1 for n in flow["nodes"] if n["kind"] == "end")
    unresolved = sorted({c for n in flow["nodes"] for c in n["scenes"]} - real_codes) if real_codes else []
    print("[extract-flow] SMAIN -> %s" % os.path.relpath(a.out, ROOT))
    print("  ✓ %d ノード（hub %d / end %d）/ %d エッジ / 実シーン参照 %d 件"
          % (len(flow["nodes"]), n_hub, n_end, len(flow["edges"]), n_scene))
    if unresolved:
        print("  ⚠ 原テキスト不在のシーン参照: %s" % ", ".join(unresolved))


if __name__ == "__main__":
    main()
