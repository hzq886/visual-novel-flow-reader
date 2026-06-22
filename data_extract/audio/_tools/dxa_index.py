#!/usr/bin/env python3
"""DxLib DXA v4 archive index parser (saimin4 md_cv.med / md_se.med).

These "audio" containers look like MED files (`.med` extension) but are NOT MED.
They are standard **DxLib DXA version 4** archives encrypted with the DxLib
*default* key (empty password). This module decrypts the header + index and
yields the entry list. See `audio_DXA_unpack_guide.md` for the full write-up.

Run standalone to dump the index of one archive:
    python3 dxa_index.py ../../../original_game/saimin4_jp/md_cv.med
"""
import struct, os, sys

# repo root resolved from this file: data_extract/audio/_tools -> repo root
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

# DxLib default key == DxKey.CreateKey("")  (12 bytes, repeating XOR)
KEY = bytes([0x55, 0xaa, 0x20, 0x55, 0x55, 0x06, 0x55, 0xaa, 0x55, 0xd5, 0x7c, 0x66])

def dxdecrypt(data, base_pos):
    """XOR-decrypt `data` whose first byte sits at file offset `base_pos`."""
    out = bytearray(data)
    kp = base_pos % 12
    k = KEY
    for i in range(len(out)):
        out[i] ^= k[kp]
        kp += 1
        if kp == 12:
            kp = 0
    return bytes(out)

def read_header(path):
    fsize = os.path.getsize(path)
    with open(path, 'rb') as f:
        raw = f.read(4 + 0x18)
    sig = dxdecrypt(raw[0:4], 0)                 # -> b'DX' + version
    assert sig[:2] == b'DX', f"not a DXA archive: {sig!r}"
    version = sig[2]
    assert version == 4, f"only v4 handled here, got v{version}"
    hdr = dxdecrypt(raw[4:4 + 0x18], 4)          # header keystream continues from offset 4
    IndexSize, BaseOffset, IndexOffset, FileTable, DirTable = struct.unpack('<5I', hdr[:20])
    return dict(fsize=fsize, version=version, IndexSize=IndexSize, BaseOffset=BaseOffset,
                IndexOffset=IndexOffset, FileTable=FileTable, DirTable=DirTable)

def parse_index(path):
    """Return (header_dict, [entry, ...]); entry = name/offset/size/unpacked/packed."""
    h = read_header(path)
    with open(path, 'rb') as f:
        f.seek(h['IndexOffset'])
        enc = f.read(h['IndexSize'])
    idx = dxdecrypt(enc, h['IndexOffset'])       # index decrypts with base_position = IndexOffset
    FileTable, DirTable, BaseOffset = h['FileTable'], h['DirTable'], h['BaseOffset']
    ENTRY = 0x2C
    u16 = lambda p: struct.unpack_from('<H', idx, p)[0]
    u32 = lambda p: struct.unpack_from('<I', idx, p)[0]
    i32 = lambda p: struct.unpack_from('<i', idx, p)[0]
    def cstr(p):
        return idx[p:idx.index(b'\x00', p)]
    def extract_name(table_offset):
        name_off = u16(table_offset) * 4 + 4     # skip the packed-name blob, read the plain name
        b = cstr(table_offset + name_off)
        try:
            return b.decode('cp932')
        except Exception:
            return b.decode('latin1')
    entries = []
    def read_file_table(root, table_offset):
        p = DirTable + table_offset
        DirOffset, ParentDirOffset, FileCount, dirFileTable = (i32(p), i32(p + 4), i32(p + 8), i32(p + 12))
        if DirOffset != -1 and ParentDirOffset != -1:
            nm = extract_name(u32(FileTable + DirOffset))
            root = (root + '/' + nm) if root else nm
        cur = FileTable + dirFileTable
        for _ in range(FileCount):
            name_offset, attr, offset = u32(cur), u32(cur + 4), u32(cur + 0x20)
            if attr & 0x10:                       # FILE_ATTRIBUTE_DIRECTORY
                read_file_table(root, offset)
            else:
                size, packed = u32(cur + 0x24), i32(cur + 0x28)
                nm = extract_name(name_offset)
                full = (root + '/' + nm) if root else nm
                is_packed = packed != -1          # -1 == stored uncompressed
                esize = packed if is_packed else size
                entries.append(dict(name=full, offset=BaseOffset + offset, size=esize,
                                    unpacked=size, packed=is_packed))
            cur += ENTRY
    read_file_table("", 0)
    return h, entries

if __name__ == '__main__':
    default = os.path.join(_ROOT, "original_game", "saimin4_jp", "md_cv.med")
    path = sys.argv[1] if len(sys.argv) > 1 else default
    h, entries = parse_index(path)
    print("HEADER:", h)
    print("ENTRIES:", len(entries))
    for e in entries[:30]:
        print(f"  {e['name']:40s} off=0x{e['offset']:X} size={e['size']} packed={e['packed']}")
