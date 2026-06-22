#!/usr/bin/env python3
"""md_scr.med (MDE0 container) extractor.
Splits the 339 named script entries into individual .bin blobs + a manifest.
Container/index layer is fully decoded; payload bytes are written as-is
(still engine-obfuscated, see analysis)."""
import os, struct, math, re
from collections import Counter

# repo paths resolved from this file: data_extract/text/_tools -> repo root
_TOOLS = os.path.dirname(os.path.abspath(__file__))
_TEXT  = os.path.dirname(_TOOLS)                              # data_extract/text
ROOT   = os.path.dirname(os.path.dirname(_TEXT))             # repo root
SRC = os.path.join(ROOT, "original_game", "saimin4_jp", "md_scr.med")   # cn: saimin4_cn/md_scr.med
OUT = os.path.join(_TEXT, "_md_scr_extracted_jp")            # 低レベル .bin 分割の作業出力

data = open(SRC, "rb").read()
assert data[:4] == b"MDE0", "not an MDE0 container: %r" % data[:4]
recsize = struct.unpack_from("<H", data, 4)[0]
count   = struct.unpack_from("<H", data, 6)[0]
assert recsize == 28, recsize
print("MDE0 container: %d bytes, recsize=%d, entries=%d" % (len(data), recsize, count))

# --- parse index (records start right after the 16-byte header) ---
entries = []
off = 16
for i in range(count):
    rec = data[off:off+recsize]; off += recsize
    name = rec[:16].split(b"\x00")[0].decode("ascii", "replace")
    cum_id, size, offset = struct.unpack_from("<III", rec, 16)
    entries.append((i, name, cum_id, size, offset))

# integrity checks
chain_ok = all(entries[k][4] + entries[k][3] == entries[k+1][4] for k in range(count-1))
end = entries[-1][4] + entries[-1][3]
print("contiguous offset chain:", chain_ok, "| data spans %d..%d (file %d)" % (entries[0][4], end, len(data)))

os.makedirs(OUT, exist_ok=True)

def ent(b):
    if not b: return 0.0
    c = Counter(b); n = len(b)
    return -sum((v/n)*math.log2(v/n) for v in c.values())

def safe(s):
    return re.sub(r"[^A-Za-z0-9_]+", "_", s) or "noname"

man = open(os.path.join(OUT, "manifest.tsv"), "w")
man.write("idx\tname\tcum_id\tsize\toffset\tsub_size\tsub_off\tcnt1\tcnt2\tsub_v4\tpayload_entropy\tfile\n")

total = 0
for idx, name, cum_id, size, offset in entries:
    blob = data[offset:offset+size]          # full entry: 16B subheader + payload
    fname = "%03d_%s.bin" % (idx, safe(name))
    open(os.path.join(OUT, fname), "wb").write(blob)
    total += size
    if size >= 16:
        s_size, s_off, c1, c2, v4 = struct.unpack_from("<IIHHI", blob, 0)
    else:
        s_size = s_off = c1 = c2 = v4 = -1
    man.write("%d\t%s\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%.3f\t%s\n" %
              (idx, name, cum_id, size, offset, s_size, s_off, c1, c2, v4,
               ent(blob[16:]), fname))
man.close()

print("extracted %d scripts, %d bytes total -> %s/" % (count, total, OUT))
print("manifest: %s/manifest.tsv" % OUT)
