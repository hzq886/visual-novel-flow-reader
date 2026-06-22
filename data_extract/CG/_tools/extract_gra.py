#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""md_gra.med / md_gra2.med (DxLib/Marble MED, 非暗号) の PRS 画像を全て PNG 化。

GARbro ArcMED.cs / ImagePRS.cs の仕様を移植。multiprocessing で並列展開する。

  md_gra.med  (1267 枚: EV/BG/SYS/CG/MEM/ITEM ...) → gra_out/
  md_gra2.med (2267 枚: CH 立ち絵差分)             → gra2_out/

使い方:
  python3 extract_gra.py                  # 既定: 両アーカイブを全展開
  python3 extract_gra.py --list           # エントリ一覧のみ表示
  python3 extract_gra.py --only gra2      # md_gra2.med だけ
  python3 extract_gra.py --jobs 8         # 並列数指定（既定: CPU-2）
"""
import struct, sys, os, time, argparse
from multiprocessing import Pool, cpu_count
from PIL import Image

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CG_DIR     = os.path.dirname(SCRIPT_DIR)                       # data_extract/CG
ROOT       = os.path.dirname(os.path.dirname(CG_DIR))          # プロジェクト直下
GAME       = os.path.join(ROOT, "original_game", "saimin4_jp") # gra は中文/日本語版でバイト同一

# (キー, アーカイブ, 出力フォルダ)
JOBS = {
    "gra":  (os.path.join(GAME, "md_gra.med"),  os.path.join(CG_DIR, "md_gra_cg")),
    "gra2": (os.path.join(GAME, "md_gra2.med"), os.path.join(CG_DIR, "md_gra2_cg")),
}

# ---- MED コンテナ（非暗号: 索引はそのまま）------------------------------
def parse_med(path):
    f = open(path, "rb")
    head = f.read(16)
    assert head[:2] == b"MD", "not a MED archive"
    entry_len = struct.unpack_from("<H", head, 4)[0]
    count     = struct.unpack_from("<H", head, 6)[0]
    name_len  = entry_len - 8
    f.seek(16)
    idx = f.read(entry_len * count)
    entries = []
    for i in range(count):
        rec = idx[i*entry_len:(i+1)*entry_len]
        name = rec[:name_len].split(b"\x00")[0].decode("ascii", "replace")
        size, off = struct.unpack_from("<II", rec, name_len)
        entries.append((name, off, size))
    f.close()
    return entries, count

# ---- PRS 伸長（Marble 'YB...'）------------------------------------------
LEN_TABLE = [i+3 for i in range(0x100)]
LEN_TABLE[0xfe] = 0x400; LEN_TABLE[0xff] = 0x1000

def prs_decode(buf):
    assert buf[0]==ord('Y') and buf[1]==ord('B'), "not PRS"
    flag = buf[2]; depth = buf[3]
    packed = struct.unpack_from("<I", buf, 4)[0]
    W = struct.unpack_from("<H", buf, 12)[0]
    H = struct.unpack_from("<H", buf, 14)[0]
    out = bytearray(W*H*depth)
    p = 0x10
    dst = 0
    remaining = packed
    bit = 0; ctl = 0
    olen = len(out)
    def rd():
        nonlocal p
        v = buf[p]; p += 1; return v
    while remaining > 0 and dst < olen:
        bit >>= 1
        if bit == 0:
            ctl = rd(); remaining -= 1; bit = 0x80
        if remaining <= 0: break
        if (ctl & bit) == 0:
            out[dst] = rd(); dst += 1; remaining -= 1; continue
        b = rd(); remaining -= 1
        length = 0; shift = 0
        if b & 0x80:
            if remaining <= 0: break
            shift = rd(); remaining -= 1
            shift |= (b & 0x3f) << 8
            if b & 0x40:
                if remaining <= 0: break
                off = rd(); remaining -= 1
                length = LEN_TABLE[off]
            else:
                length = (shift & 0xf) + 3
                shift >>= 4
        else:
            length = b >> 2
            b &= 3
            if b == 3:
                length += 9
                out[dst:dst+length] = buf[p:p+length]; p += length
                remaining -= length; dst += length; continue
            shift = length
            length = b + 2
        shift += 1
        if dst < shift: raise ValueError("bad offset")
        length = min(length, olen - dst)
        s = dst - shift
        for k in range(length):
            out[dst+k] = out[s+k]
        dst += length
    # delta filter
    if flag & 0x80:
        for i in range(depth, olen):
            out[i] = (out[i] + out[i-depth]) & 0xff
    mode = "RGB" if depth==3 else "RGBA"
    img = Image.frombytes(mode, (W, H), bytes(out))
    if depth == 3:
        b,g,r = img.split(); img = Image.merge("RGB",(r,g,b))
    else:
        b,g,r,a = img.split(); img = Image.merge("RGBA",(r,g,b,a))
    return img

# ---- 1 エントリ処理（ワーカ）-------------------------------------------
def work(task):
    archive, name, off, size, out_dir = task
    outpng = os.path.join(out_dir, name + ".png")
    if os.path.exists(outpng):
        return ("skip", name)
    try:
        with open(archive, "rb") as f:
            f.seek(off); data = f.read(size)
        if data[:2] != b"YB":
            return ("nonprs", name)
        img = prs_decode(data)
        img.save(outpng)
        return ("ok", name)
    except Exception as e:
        return ("err", f"{name}: {e}")

def run_job(key, jobs_n):
    archive, out_dir = JOBS[key]
    os.makedirs(out_dir, exist_ok=True)
    entries, count = parse_med(archive)
    tasks = [(archive, n, o, s, out_dir) for (n,o,s) in entries]
    print(f"[{key}] {os.path.basename(archive)}: {count} entries → {out_dir}")
    t0 = time.time()
    stats = {"ok":0,"skip":0,"nonprs":0,"err":0}
    errs = []
    with Pool(jobs_n) as pool:
        for i, (status, info) in enumerate(pool.imap_unordered(work, tasks, chunksize=8), 1):
            stats[status] += 1
            if status in ("err","nonprs"): errs.append(info)
            if i % 200 == 0 or i == count:
                el = time.time()-t0
                print(f"  {i}/{count}  ok={stats['ok']} skip={stats['skip']} "
                      f"err={stats['err']} nonprs={stats['nonprs']}  ({el:.1f}s)")
    print(f"[{key}] 完了: {stats}  {time.time()-t0:.1f}s")
    for e in errs[:20]:
        print("   !", e)
    return stats

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=list(JOBS.keys()), help="片方のみ展開")
    ap.add_argument("--list", action="store_true", help="エントリ一覧のみ")
    ap.add_argument("--jobs", type=int, default=max(1, cpu_count()-2))
    args = ap.parse_args()

    keys = [args.only] if args.only else list(JOBS.keys())

    if args.list:
        for k in keys:
            archive, _ = JOBS[k]
            entries, count = parse_med(archive)
            print(f"\n[{k}] {archive}: {count} entries")
            for n,o,s in entries[:20]:
                print(f"  {n:28} off={o:>11} size={s:>9}")
        return

    total = {"ok":0,"skip":0,"nonprs":0,"err":0}
    for k in keys:
        st = run_job(k, args.jobs)
        for kk in total: total[kk]+=st[kk]
    print(f"\n=== 合計: {total} ===")

if __name__ == "__main__":
    main()
