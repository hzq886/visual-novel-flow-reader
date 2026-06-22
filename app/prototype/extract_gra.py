#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""md_gra2.med (DxLib/Marble MED, 非暗号) を解析し、PRS画像をPNG化。
GARbro ArcMED.cs / ImagePRS.cs の仕様を移植。"""
import struct, sys, os
from PIL import Image

SRC = "../2_元ゲーム/saimin4/md_gra2.med"

def parse_med(path, limit=None):
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
        if limit and len(entries) >= limit: break
    return f, entries, count

LEN_TABLE = [i+3 for i in range(0x100)]
LEN_TABLE[0xfe] = 0x400; LEN_TABLE[0xff] = 0x1000

def prs_decode(buf):
    """buf = entry bytes (PRS 'YB...'). returns (PIL Image)."""
    assert buf[0]==ord('Y') and buf[1]==ord('B'), "not PRS"
    flag = buf[2]; depth = buf[3]
    packed = struct.unpack_from("<I", buf, 4)[0]
    W = struct.unpack_from("<H", buf, 12)[0]
    H = struct.unpack_from("<H", buf, 14)[0]
    out = bytearray(W*H*depth)
    p = 0x10                      # input pos
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
        # CopyOverlapped
        s = dst - shift
        for k in range(length):
            out[dst+k] = out[s+k]
        dst += length
    # delta filter
    if flag & 0x80:
        for i in range(depth, olen):
            out[i] = (out[i] + out[i-depth]) & 0xff
    # BGR(A) -> RGB(A)
    mode = "RGB" if depth==3 else "RGBA"
    img = Image.frombytes(mode, (W, H), bytes(out))
    if depth == 3:
        b,g,r = img.split(); img = Image.merge("RGB",(r,g,b))
    else:
        b,g,r,a = img.split(); img = Image.merge("RGBA",(r,g,b,a))
    return img, (W,H,depth,flag,packed)

def extract_one(f, entries, target):
    ent = next((e for e in entries if e[0]==target), None)
    if not ent:
        print("  (見つからず:", target, ")"); return
    name,off,size = ent
    f.seek(off); data = f.read(size)
    if data[:2] != b'YB':
        print(f"  {name}: PRSでない (先頭={data[:4].hex()})"); return
    img,meta = prs_decode(data)
    os.makedirs("cg_out", exist_ok=True)
    outpng = f"cg_out/{name}.png"
    img.save(outpng)
    print(f"  保存 {outpng}  {img.size} {img.mode}  flag={meta[3]:#x}")

if __name__ == "__main__":
    # usage: extract_gra.py <archive.med> <entry1> [entry2 ...]
    archive = sys.argv[1] if len(sys.argv)>1 else SRC
    targets = sys.argv[2:]
    f, entries, count = parse_med(archive)
    print(f"{archive}: {count} entries")
    if not targets:
        for name,off,size in entries[:20]:
            print(f"  {name:24} off={off:>10} size={size:>8}")
    else:
        import time
        for t in targets:
            t0=time.time(); extract_one(f, entries, t); print(f"   ({time.time()-t0:.1f}s)")
