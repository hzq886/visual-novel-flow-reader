#!/usr/bin/env python3
"""Extract all audio from saimin4's DxLib DXA v4 archives (md_cv.med / md_se.med).

Entries are stored uncompressed and are plain Ogg Vorbis files, so extraction is
just: decrypt (repeating-XOR, default DxLib key) -> write `.ogg`. No transcode.

Run with no args to extract both voice + SE to their project locations:
    python3 extract_cv.py
Or target one archive:
    python3 extract_cv.py /path/to/md_cv.med /path/to/out_dir
"""
import os, sys
from dxa_index import parse_index, KEY   # same dir; Python puts script dir on sys.path

# repo paths resolved from this file: data_extract/audio/_tools -> repo root
_TOOLS = os.path.dirname(os.path.abspath(__file__))
_AUDIO = os.path.dirname(_TOOLS)                                  # data_extract/audio
ROOT   = os.path.dirname(os.path.dirname(_AUDIO))                 # repo root
GAME   = os.path.join(ROOT, "original_game", "saimin4_jp")        # cv/se are byte-identical jp/cn
JOBS = [
    (f"{GAME}/md_cv.med", f"{_AUDIO}/md_cv_audio"),  # 7309 voice clips
    (f"{GAME}/md_se.med", f"{_AUDIO}/md_se_audio"),  # 229 sound effects
]

def _key_tiles(maxlen):
    """Precompute the 12 rotations of the key, tiled to `maxlen`, for fast XOR."""
    n = maxlen // 12 + 2
    return [((bytes(KEY[r:]) + bytes(KEY[:r])) * n)[:maxlen] for r in range(12)]

def extract(med_path, out_dir):
    h, entries = parse_index(med_path)
    tiles = _key_tiles(max(e['size'] for e in entries))
    os.makedirs(out_dir, exist_ok=True)
    total = 0
    with open(med_path, 'rb') as f:
        for e in entries:
            if e['packed']:
                raise SystemExit(f"packed entry unexpected: {e['name']}")
            f.seek(e['offset'])
            raw = f.read(e['size'])
            ks = tiles[e['offset'] % 12][:len(raw)]
            dec = (int.from_bytes(raw, 'big') ^ int.from_bytes(ks, 'big')).to_bytes(len(raw), 'big')
            out_path = os.path.join(out_dir, e['name'].replace('/', os.sep))
            os.makedirs(os.path.dirname(out_path) or '.', exist_ok=True)
            with open(out_path, 'wb') as o:
                o.write(dec)
            total += 1
    bad = 0
    for e in entries:
        p = os.path.join(out_dir, e['name'].replace('/', os.sep))
        with open(p, 'rb') as fh:
            if fh.read(4) != b'OggS':
                bad += 1
    print(f"{os.path.basename(med_path)} -> {out_dir}/  ({total} files, non-OggS: {bad})")

if __name__ == '__main__':
    if len(sys.argv) > 2:
        extract(sys.argv[1], sys.argv[2])
    else:
        for med, out in JOBS:
            extract(med, out)
