#!/usr/bin/env python3
"""MED (md_scr.med) の復号鍵を `_VIEW` の既知平文（クリブ）から復元・検証する。
使い方: python3 recover_key.py [md_scr.med へのパス]
"""
import struct, sys, os

# repo root resolved from this file: data_extract/text/_tools -> repo root
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(_ROOT, "original_game", "saimin4_jp", "md_scr.med")
data = open(SRC, "rb").read()
assert data[:4] == b"MDE0", "not MDE0: %r" % data[:4]
rs, n = struct.unpack_from("<HH", data, 4)          # recordSize, count をヘッダから動的取得
entries = []; off = 0x10
for _ in range(n):
    name = data[off:off+rs-12].split(b"\x00")[0].decode("ascii", "replace")
    _, sz, o = struct.unpack_from("<III", data, off+rs-12); off += rs
    entries.append((name, sz, o))
emap = {nm: (sz, o) for nm, sz, o in entries}
print("src:", SRC, "| entries:", n, "recordSize:", rs)

# 復号後 _VIEW ペイロード(entry-local 0x10..) 先頭24byte は全 MED 共通で固定
crib = bytes([0x00,0x23,0x52,0x55,0x4C,0x45,0x5F,0x56,0x49,0x45,0x57,0x45,0x52,
              0x00,0x3A,0x56,0x49,0x45,0x57,0x5F,0x30,0x00,0x7B,0x00])
sz, o = emap["_VIEW"]; view = data[o:o+sz]
# GARbro: plain[p] = (cipher[p] + key[p%L]) & 0xff  =>  key = (plain - cipher)
d = [(crib[i] - view[0x10+i]) & 0xff for i in range(24)]   # d[i] = key[(0x10+i)%L]
L = next((L for L in range(1, 24) if all(d[i] == d[i+L] for i in range(24-L))), 24)
key = [0]*L
for i in range(24):
    key[(0x10+i) % L] = d[i]
key = bytes(key)
print("recovered period L =", L)
print("KEY (GARbro plain=cipher+key)  hex:", key.hex())
print("KEY (article  plain=cipher-key) hex:", bytes((-b) & 0xff for b in key).hex())
for enc in ("cp932", "gbk", "latin1"):
    try: print("  key as %-6s: %r" % (enc, key.decode(enc)))
    except Exception: print("  key as %-6s: err" % enc)

def decrypt(eb, K):
    out = bytearray(eb)
    for p in range(0x10, len(out)): out[p] = (out[p] + K[p % len(K)]) & 0xff
    return bytes(out)

dec = decrypt(view, key)
print("\n_VIEW decrypted payload[0:40]:", dec[0x10:0x10+40])
print("crib match:", dec[0x10:0x10+24] == crib)
for nm in ("_SYS_MES", "STAFF_ROLL"):
    if nm not in emap: continue
    s, oo = emap[nm]; t = decrypt(data[oo:oo+s], key)[0x10:]
    print("\n=== %s ===" % nm)
    print(" sjis:", t[:160].decode("cp932", "replace"))
