#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""saimin4 の BGM (md_bgm.med) を抽出する。

cv/se (md_cv.med / md_se.med) は DxLib DXA + 素の Ogg だったが、**BGM は別物**:
  - コンテナ : MED `MDN6`（**非暗号**。索引は CG の md_gra と同じ MED レイアウト）
  - 中身     : Marble 独自 **WADY**（ADPCM 系）。GARbro `Marble/AudioWADY.cs` を移植
  - 形式     : PCM s16le / 2ch / 44100Hz（ヘッダの WaveFormat 由来）

全 16 トラック M01..M16。各 WADY は `remaining == src_size`（= GARbro の `Decode`、
最も単純な「1 byte → 1 sample」方式）に該当する。本ツールはその方式を numpy で
ベクトル化して復号し、ffmpeg(libvorbis) で `.ogg` 書き出しする（cv/se と同じ規約）。

使い方:
  python3 extract_bgm.py            # 既定: 全 16 トラックを md_bgm_audio/ へ .ogg(Opus 128k)
  python3 extract_bgm.py --codec vorbis   # Ogg Vorbis（ffmpeg 内蔵 vorbis, cv/se と同コーデック）
  python3 extract_bgm.py --wav      # .wav（無劣化, ffmpeg 不要）
  python3 extract_bgm.py --list     # 索引のみ表示
  python3 extract_bgm.py --bitrate 160k
詳細は audio_BGM_WADY_unpack_guide.md。

注: Homebrew の ffmpeg には libvorbis が無いことがある。BGM(音楽) には Opus が
音質/サイズとも最適なので既定は libopus。主要ブラウザの <audio> で再生可。
"""
import os, sys, struct, wave, argparse, subprocess
import numpy as np

# ---- repo paths resolved from this file: data_extract/audio/_tools -> repo root
_TOOLS = os.path.dirname(os.path.abspath(__file__))
_AUDIO = os.path.dirname(_TOOLS)                                 # data_extract/audio
ROOT   = os.path.dirname(os.path.dirname(_AUDIO))               # repo root
SRC    = os.path.join(ROOT, "original_game", "saimin4_jp", "md_bgm.med")  # jp/cn byte-identical
OUT    = os.path.join(_AUDIO, "md_bgm_audio")

# ---- GARbro Marble/AudioWADY.cs : WADY 復号テーブル（128 entry, ushort delta）----
SAMPLE_TABLE = np.array([
    0x0000,0x0002,0x0004,0x0006,0x0008,0x000A,0x000C,0x000F,
    0x0012,0x0015,0x0018,0x001C,0x0020,0x0024,0x0028,0x002C,
    0x0031,0x0036,0x003B,0x0040,0x0046,0x004C,0x0052,0x0058,
    0x005F,0x0066,0x006D,0x0074,0x007C,0x0084,0x008C,0x0094,
    0x00A0,0x00AA,0x00B4,0x00BE,0x00C8,0x00D2,0x00DC,0x00E6,
    0x00F0,0x00FF,0x010E,0x011D,0x012C,0x0140,0x0154,0x0168,
    0x017C,0x0190,0x01A9,0x01C2,0x01DB,0x01F4,0x020D,0x0226,
    0x0244,0x0262,0x028A,0x02BC,0x02EE,0x0320,0x0384,0x03E8,
    0x0000,0xFFFE,0xFFFC,0xFFFA,0xFFF8,0xFFF6,0xFFF4,0xFFF1,
    0xFFEE,0xFFEB,0xFFE8,0xFFE4,0xFFE0,0xFFDC,0xFFD8,0xFFD4,
    0xFFCF,0xFFCA,0xFFC5,0xFFC0,0xFFBA,0xFFB4,0xFFAE,0xFFA8,
    0xFFA1,0xFF9A,0xFF93,0xFF8C,0xFF84,0xFF7C,0xFF74,0xFF6C,
    0xFF60,0xFF56,0xFF4C,0xFF42,0xFF38,0xFF2E,0xFF24,0xFF1A,
    0xFF10,0xFF01,0xFEF2,0xFEE3,0xFED4,0xFEC0,0xFEAC,0xFE98,
    0xFE84,0xFE70,0xFE57,0xFE3E,0xFE25,0xFE0C,0xFDF3,0xFDDA,
    0xFDBC,0xFD9E,0xFD76,0xFD44,0xFD12,0xFCE0,0xFC7C,0xFC18,
], dtype=np.int64)


# ---- MED MDN6 コンテナ（非暗号）の索引パース ----------------------------
def parse_med(path):
    with open(path, "rb") as f:
        head = f.read(16)
        assert head[:2] == b"MD", "not a MED archive: %r" % head[:4]
        entry_len = struct.unpack_from("<H", head, 4)[0]
        count     = struct.unpack_from("<H", head, 6)[0]
        name_len  = entry_len - 8
        idx = f.read(entry_len * count)
    entries = []
    for i in range(count):
        rec = idx[i * entry_len:(i + 1) * entry_len]
        name = rec[:name_len].split(b"\x00")[0].decode("ascii", "replace")
        size, off = struct.unpack_from("<II", rec, name_len)   # MED 順は (size, offset)
        entries.append((name, off, size))
    return entries


# ---- WADY 復号（GARbro WadyInput.Decode = 方式1, numpy ベクトル化）-------
def _decode_channel(b, mul):
    """1 チャンネル分の WADY バイト列 b(uint8) を 16bit PCM(uint16) に復号。

    GARbro: 各 byte v について  v&0x80 ⇒ 絶対値 sample=(v<<9)、それ以外 ⇒
    sample += (ushort)(mul*SampleTable[v])。すべて 16bit でラップ。
    リセット境界で区切られた区間累積和としてベクトル化する。
    """
    b = b.astype(np.int64)
    is_reset = (b & 0x80) != 0
    delta = (mul * SAMPLE_TABLE[b & 0x7F]) & 0xFFFF           # product を先に 16bit 切り捨て
    delta = np.where(is_reset, 0, delta)
    cd = np.cumsum(delta)                                      # int64（オーバーフローしない）
    abs_val = (b << 9) & 0xFFFF                                # リセット時の絶対サンプル
    n = b.shape[0]
    last_reset = np.maximum.accumulate(np.where(is_reset, np.arange(n), -1))
    reset_base = abs_val - cd                                  # リセット位置で有効
    base = np.where(last_reset >= 0,
                    reset_base[np.where(last_reset >= 0, last_reset, 0)], 0)
    return ((base + cd) & 0xFFFF).astype("<u2")


def decode_wady(blob):
    """WADY blob -> (pcm_bytes, channels, rate)。方式1 (remaining==src_size) のみ対応。"""
    assert blob[:4] == b"WADY", "not WADY: %r" % blob[:4]
    mul      = blob[5]
    src_size = struct.unpack_from("<i", blob, 12)[0]
    channels = struct.unpack_from("<H", blob, 0x22)[0]
    rate     = struct.unpack_from("<I", blob, 0x24)[0]
    bits     = struct.unpack_from("<H", blob, 0x2E)[0]
    assert bits == 16, "unexpected bits=%d" % bits
    remaining = len(blob) - 0x30
    if remaining != src_size:
        raise NotImplementedError(
            "track uses WADY Decode2/Decode3 (remaining=%d != src_size=%d); "
            "see GARbro AudioWADY.cs" % (remaining, src_size))
    body = np.frombuffer(blob, dtype=np.uint8, count=src_size, offset=0x30)
    if channels == 1:
        pcm = _decode_channel(body, mul)
    else:
        n = (src_size // 2) * 2
        left  = _decode_channel(body[0:n:2], mul)
        right = _decode_channel(body[1:n:2], mul)
        pcm = np.empty(left.size + right.size, dtype="<u2")
        pcm[0::2] = left
        pcm[1::2] = right
    return pcm.tobytes(), channels, rate


# ---- 書き出し -----------------------------------------------------------
def write_wav(path, pcm, channels, rate):
    with wave.open(path, "wb") as w:
        w.setnchannels(channels); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(pcm)


# codec -> (出力拡張子, ffmpeg 出力オプション)
def _enc_opts(codec, bitrate):
    if codec == "opus":   return "ogg", ["-c:a", "libopus", "-b:a", bitrate]
    if codec == "vorbis": return "ogg", ["-c:a", "vorbis", "-strict", "-2", "-b:a", bitrate]
    if codec == "mp3":    return "mp3", ["-c:a", "libmp3lame", "-b:a", bitrate]
    raise SystemExit("unknown codec: " + codec)


def encode_audio(path, pcm, channels, rate, opts):
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
           "-f", "s16le", "-ar", str(rate), "-ac", str(channels), "-i", "pipe:0",
           *opts, path]
    p = subprocess.run(cmd, input=pcm, stderr=subprocess.PIPE)
    if p.returncode != 0:
        raise RuntimeError("ffmpeg failed: " + p.stderr.decode("utf-8", "replace"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=SRC)
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--wav", action="store_true", help=".wav 無劣化出力（ffmpeg 不要）")
    ap.add_argument("--codec", choices=["opus", "vorbis", "mp3"], default="opus")
    ap.add_argument("--bitrate", default="128k", help="ビットレート（既定 128k）")
    ap.add_argument("--list", action="store_true", help="索引のみ表示")
    a = ap.parse_args()

    entries = parse_med(a.src)
    fsize = os.path.getsize(a.src)
    print("src:", a.src)
    print("MDN6 entries:", len(entries), " filesize:", fsize)
    if a.list:
        with open(a.src, "rb") as f:
            for name, off, size in entries:
                f.seek(off); sig = f.read(4)
                print(f"  {name:6} off={off:>11} size={size:>10}  sig={sig!r}")
        return

    os.makedirs(a.out, exist_ok=True)
    if a.wav:
        ext, opts = "wav", None
    else:
        ext, opts = _enc_opts(a.codec, a.bitrate)
    data = open(a.src, "rb").read()
    total = 0
    for name, off, size in entries:
        pcm, ch, rate = decode_wady(data[off:off + size])
        out_path = os.path.join(a.out, "%s.%s" % (name, ext))
        if a.wav:
            write_wav(out_path, pcm, ch, rate)
        else:
            encode_audio(out_path, pcm, ch, rate, opts)
        secs = len(pcm) / (2 * ch * rate)
        osize = os.path.getsize(out_path)
        print(f"  {name} -> {os.path.basename(out_path):10}  {ch}ch {rate}Hz  "
              f"{secs:6.1f}s  out={osize//1024:>6}KB")
        total += 1
    print("done:", total, "tracks ->", a.out, "(%s)" % (ext if a.wav else a.codec))


if __name__ == "__main__":
    main()
