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
TEXT_DIR_CN = os.path.join(ROOT, "data_extract", "text", "md_scr_text_cn")
DEF_PATH = os.path.join(TEXT_DIR, "_DEF.txt")

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


# ───────────────────────── _DEF フラグ名解決 ─────────────────────────
_DEF_CACHE = None


def def_flag_table():
    """`_DEF.txt` を {スロット変数: 表示名} に。例 {'S71':'#軸2_1','S61':'S522'}。
    SMAIN のフラグ op（0x06 init / 0x1d select）が参照する**スロット番号**を実フラグ名へ解決する用。"""
    global _DEF_CACHE
    if _DEF_CACHE is None:
        table = {}
        if os.path.isfile(DEF_PATH):
            for line in open(DEF_PATH, encoding="utf-8"):
                m = re.match(r"\[(?:id|text|note)\]\s+(.*?)\s+(S\d+)\s*$", line.rstrip("\n"))
                if m:
                    name, slot = m.group(1).strip(), m.group(2)
                    if name and name != slot:  # 別名のみ採用（S1=S1 等の自明は捨てる）
                        table.setdefault(slot, name)
        _DEF_CACHE = table
    return _DEF_CACHE


def resolve_flag(slot):
    """フラグスロット番号 → 表示名。軸フラグ等は `_DEF` の名前を併記、無ければ `S<slot>`。"""
    var = "S%d" % slot
    name = def_flag_table().get(var)
    if name:
        return "%s/%s" % (var, name.lstrip("#"))
    return var


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
        # 検証済みの select マーカーのみ: `1d 00 <slot> f5 f5 eb 01 ff`（len 8）。
        # <slot> = フラグスロット番号。_DEF で実フラグ名（軸フラグ等）へ解決する（HU-20）。
        if length == 8 and op == 0x1d and args[3:6] == b"\xf5\xf5\xeb":
            pending_cond = resolve_flag(args[2])
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


# ───────────────────────── 選択肢メニュー i18n 抽出 ─────────────────────────
def _scene_menus(txt_path, code, txt_tag, id_tag):
    """シーン .txt から選択肢を抽出。選択肢 = 直後に `[id] <code>_NN_MM` が続く本文行。
    返り値: {menu_no: {opt_no: text}}。"""
    if not os.path.isfile(txt_path):
        return {}
    pat = re.compile(r"^\[" + id_tag + r"\] " + re.escape(code) + r"_(\d+)_(\d+)\s*$")
    lines = open(txt_path, encoding="utf-8").read().split("\n")
    menus = defaultdict(dict)
    for i, line in enumerate(lines):
        m = pat.match(line)
        if m and i > 0 and lines[i - 1].startswith("[" + txt_tag + "] "):
            menus[int(m.group(1))][int(m.group(2))] = lines[i - 1].split("] ", 1)[1].strip()
    return menus


# ナレーション文末約物（ここで止めれば選択肢ブロックの先頭境界になる）。
_NARR_END = ("。", "！", "？", "」", "』", "…", "♪", "．", ".", "、", "）", ")")


def _has_cjk(s):
    return any("぀" <= c <= "鿿" or "㐀" <= c <= "䶿" for c in s)


def _view_menu(txt_path, txt_tag, id_tag):
    """`_VIEW` 方式メニュー（選択肢 ID を持たないもの）の選択肢列を返す。
    `_VIEW`（メニュー UI）直前の `BG_BLACK` の手前に並ぶ命令文オプションを後方走査で集める。
    `_VIEW` はほぼ全シーンの末尾マーカーなので、ナレーション末尾（約物）/ タイトル(`\\N`)/
    ノート(`#`)/ 非 CJK を境界・除外して 2 択以上だけ採る（誤検出回避）。"""
    if not os.path.isfile(txt_path):
        return []
    lines = open(txt_path, encoding="utf-8").read().split("\n")
    vis = [i for i, l in enumerate(lines) if l.strip() == "[" + id_tag + "] _VIEW"]
    if not vis:
        return []
    v = vis[-1]
    anchor = v
    for k in range(v - 1, max(-1, v - 6), -1):
        if lines[k].strip() == "[" + id_tag + "] BG_BLACK":
            anchor = k
            break
    opts = []
    k = anchor - 1
    while k >= 0 and lines[k].startswith("[" + txt_tag + "] ") and len(opts) <= 5:
        t = lines[k].split("] ", 1)[1].strip()
        if not t or "\\N" in t or "\\n" in t or t.startswith("#") or t.endswith(_NARR_END) or not _has_cjk(t):
            break
        opts.append(t)
        k -= 1
    opts.reverse()
    return opts if len(opts) >= 2 else []


def extract_choices():
    """全シーンの選択肢メニュー（jp/cn）を抽出。各シーン脚本の `<scene>_NN_MM` 選択肢 ID を
    権威ある印として用いる（ボイス ID `CHAR_...` とは別形式）。誤検出回避のため 2 択以上の
    メニューのみ採用。返り値: {scene_code: [ {scene, options:[{jp,cn}]} per menu ]}。"""
    if not os.path.isdir(TEXT_DIR):
        return {}
    by_scene = {}
    for fn in os.listdir(TEXT_DIR):
        m = re.match(r"^(\d{3}_[A-Z][A-Za-z0-9]*)\.txt$", fn)
        if not m:
            continue
        code = m.group(1)
        jp_path = os.path.join(TEXT_DIR, code + ".txt")
        cn_path = os.path.join(TEXT_DIR_CN, code + ".txt")
        jp = _scene_menus(jp_path, code, "text", "id")
        cn = _scene_menus(cn_path, code, "cn", "ascii")
        menus = []
        # (1) 選択肢 ID `<scene>_NN_MM` 方式（HU-18）。
        for mn in sorted(jp):
            opts = jp[mn]
            if len(opts) < 2:  # 単独行は地の文の誤検出 → メニュー扱いしない
                continue
            menus.append({
                "scene": code,
                "options": [{"jp": opts[o], "cn": cn.get(mn, {}).get(o)} for o in sorted(opts)],
            })
        # (2) `_VIEW` 方式（選択肢 ID を持たないメニュー。HU-19）。
        vjp = _view_menu(jp_path, "text", "id")
        if vjp:
            vcn = _view_menu(cn_path, "cn", "ascii")
            menus.append({
                "scene": code,
                "options": [{"jp": t, "cn": vcn[i] if i < len(vcn) else None} for i, t in enumerate(vjp)],
            })
        if menus:
            by_scene[code] = menus
    return by_scene


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


def to_flow(g, start, real_codes, choices_by_scene):
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
        # 内包シーンの選択肢メニュー（シーン順）をノードに付与。
        node_choices = [menu for c in scenes for menu in choices_by_scene.get(c, [])]
        if node_choices:
            node["choices"] = node_choices
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


# ───────────────────────── SMAIN ロード ─────────────────────────
def load_smain(src):
    data = open(src, "rb").read()
    ents = parse_container(data)
    name, size, eo = next(e for e in ents if e[0] == "SMAIN")
    payload = decrypt(data[eo:eo + size])[0x10:]
    sm = Smain(payload)
    return sm, extract_events(sm)


def sibling_locale_src(src):
    """saimin4_jp ↔ saimin4_cn のもう一方のパスを返す（--diff の既定相手）。"""
    if "saimin4_jp" in src:
        return src.replace("saimin4_jp", "saimin4_cn")
    if "saimin4_cn" in src:
        return src.replace("saimin4_cn", "saimin4_jp")
    return None


def diff_structure(src_a, src_b):
    """2 版の SMAIN 制御構造（レコード数・文字列数・opcode 分布・イベント列）を比較する。
    str_off 等の非構造的差異は無視。完全一致なら 0、構造差があれば 1 を返す。"""
    sm_a, ev_a = load_smain(src_a)
    sm_b, ev_b = load_smain(src_b)

    def sig(sm, ev):
        op = dict(Counter(args[0] for (_, _, _, args) in sm.records if args).most_common())
        seq = [(e["kind"], e["name"]) for e in ev]
        return {"records": len(sm.records), "strings": len(sm.strings), "ops": op, "seq": seq}

    sa, sb = sig(sm_a, ev_a), sig(sm_b, ev_b)
    print("[extract-flow --diff] 制御構造比較")
    print("  A: %s" % os.path.relpath(src_a, ROOT))
    print("  B: %s" % os.path.relpath(src_b, ROOT))
    diffs = []
    if sa["records"] != sb["records"]:
        diffs.append("records %d≠%d" % (sa["records"], sb["records"]))
    if sa["strings"] != sb["strings"]:
        diffs.append("strings %d≠%d" % (sa["strings"], sb["strings"]))
    if sa["ops"] != sb["ops"]:
        diffs.append("opcode histogram 不一致")
    if sa["seq"] != sb["seq"]:
        n = sum(1 for x, y in zip(sa["seq"], sb["seq"]) if x != y) + abs(len(sa["seq"]) - len(sb["seq"]))
        diffs.append("イベント列 %d 箇所相違" % n)
        for i, (x, y) in enumerate(zip(sa["seq"], sb["seq"])):
            if x != y:
                print("    seq[%d]: %s ≠ %s" % (i, x, y))
                break
    print("  records=%d strings=%d ops=%d種 events=%d"
          % (sa["records"], sa["strings"], len(sa["ops"]), len(sa["seq"])))
    if diffs:
        print("  ✗ 構造差: %s" % " / ".join(diffs))
        return 1
    print("  ✓ オペコード/ラベル/イベント構造は完全一致（str_off 等の非構造差は無視）")
    return 0


# ───────────────────────── main ─────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=DEFAULT_SRC)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--disasm", action="store_true", help="逆アセンブル列を stdout に出して終了")
    ap.add_argument("--diff", nargs="?", const="@sibling", metavar="OTHER_MED",
                    help="--src と OTHER_MED（既定: jp↔cn の対）の制御構造を比較して終了")
    a = ap.parse_args()

    if a.diff is not None:
        other = sibling_locale_src(a.src) if a.diff == "@sibling" else a.diff
        if not other or not os.path.isfile(a.src) or not os.path.isfile(other):
            print("[extract-flow --diff] 原データ未配置のため比較スキップ（jp/cn 両方が要る）")
            return
        raise SystemExit(diff_structure(a.src, other))

    if not os.path.isfile(a.src):
        # 原データ（md_scr.med）は git 外。未配置なら committed の flow.json を保ったまま黙ってスキップ。
        # （data:all を生データ無しの環境でも通すため。一次生成にはローカルに原ファイルが要る）
        print("[extract-flow] 原データ未配置のためスキップ: %s" % a.src)
        return

    sm, events = load_smain(a.src)

    if a.disasm:
        dump_disasm(sm, events)
        return

    real_codes = set()
    if os.path.isdir(TEXT_DIR):
        real_codes = {f[:-4] for f in os.listdir(TEXT_DIR) if re.match(r"^\d.*\.txt$", f)}

    choices_by_scene = extract_choices()

    g, start = build_graph(events)
    resolve_entries(g, start)
    contract_chains(g, start)
    flow = to_flow(g, start, real_codes, choices_by_scene)

    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(flow, f, ensure_ascii=False, indent=2)
        f.write("\n")

    n_scene = len({c for n in flow["nodes"] for c in n["scenes"]})
    n_hub = sum(1 for n in flow["nodes"] if n["kind"] == "branch")
    n_end = sum(1 for n in flow["nodes"] if n["kind"] == "end")
    unresolved = sorted({c for n in flow["nodes"] for c in n["scenes"]} - real_codes) if real_codes else []
    n_menu = sum(len(n.get("choices", [])) for n in flow["nodes"])
    n_opt = sum(len(c["options"]) for n in flow["nodes"] for c in n.get("choices", []))
    print("[extract-flow] SMAIN -> %s" % os.path.relpath(a.out, ROOT))
    print("  ✓ %d ノード（hub %d / end %d）/ %d エッジ / 実シーン参照 %d 件"
          % (len(flow["nodes"]), n_hub, n_end, len(flow["edges"]), n_scene))
    print("  ✓ 選択肢メニュー %d 件 / 選択肢 %d 個（jp/cn i18n）" % (n_menu, n_opt))
    if unresolved:
        print("  ⚠ 原テキスト不在のシーン参照: %s" % ", ".join(unresolved))


if __name__ == "__main__":
    main()
