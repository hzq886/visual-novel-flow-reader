# BGM（md_bgm.med = MED MDN6 + WADY）抽出ガイダンス

対象: `催眠術４` の BGM `md_bgm.med`

> 同じ `.med` でも **cv/se と bgm は別フォーマット**。cv/se は DxLib DXA + 素の Ogg
> （→ `audio_DXA_unpack_guide.md`）だったが、**bgm は Marble の MED コンテナ（`MDN6`）+
> WADY 音声**。cv/se で「身構えたが不要だった」WADY が、bgm では本番で出てくる。

---

## 0. サマリ

| 層 | 結論 |
|---|---|
| コンテナ `md_bgm.med` | MED **`MDN6`**（先頭 `4D 44 4E 36`）。**非暗号**。索引は CG の `md_gra`(MDN1) と同じ MED レイアウトで、`parse_med` がそのまま通る |
| 索引 | エントリ 16 件 `M01`..`M16`。レコード長 12B（name4 + size u32 + offset u32）。オフセット連続・`末尾==ファイルサイズ` で健全 |
| 中身 | 各エントリ先頭 `WADY` = **Marble 独自 ADPCM**。GARbro `Marble/AudioWADY.cs` を移植 |
| WADY 形式 | PCM **s16le / 2ch / 44100Hz**（WADY 内 WaveFormat 由来）。全 16 件が最も単純な `Decode`（`remaining==src_size`）方式 |
| 出力 | `md_bgm_audio/` に 16 トラック。既定は **Opus 128k**（Homebrew ffmpeg に libvorbis が無いため）。`--codec vorbis` で Ogg Vorbis も可 |

cv/se は jp/cn でバイト同一だったが、**bgm も jp/cn 同一**（同サイズ・同内容）。jp 版を参照。

---

## 1. コンテナ `MDN6`（非暗号 MED）

先頭 16 byte:

```
00  char[4] "MDN6"          マジック（MED 系。先頭2byteは "MD"）
04  u16     entry_len = 12  1 レコードのバイト長
06  u16     count     = 16  エントリ数
08  ...     "Left"+u32      ヘッダ余剰（無視。MED 共通 16B ヘッダの 8..15）
10  ──      索引（count レコード）──
```

各レコード（12B）: `name[4]`（"M01".."M16" + NUL）＋ `size`(u32) ＋ `offset`(u32)。
データ本体は索引直後（`0x10 + 12*16 = 0xD0 = 208`）から、各 WADY が無圧縮で連結。

> 索引パーサは **CG の `extract_gra.parse_med` と完全に同一仕様**（MDN1/MDN6 とも
> `entry_len@4 / count@6 / (size,offset)`）。`extract_bgm.py` は依存を避けて同じものを内包。

健全性チェック（実測）: `offset` は連続、最終 `offset+size == 194,877,696`（=ファイルサイズ）。

---

## 2. WADY 音声（GARbro `Marble/AudioWADY.cs`）

各エントリ先頭 0x30 が WADY ヘッダ:

```
00  char[4] "WADY"
04  u8      (=1)
05  u8      MulValue            ← 復号の乗数（本作 =4）
06  6 byte  （スキップ）
0C  i32     src_size            ← 圧縮データ長
10  16 byte （スキップ）
20  WaveFormat(16B): FormatTag(u16=1) Channels(u16=2) SamplesPerSecond(u32=44100)
                     AvgBytesPerSecond(u32) BlockAlign(u16=4) BitsPerSample(u16=16)
30  ──      WADY 本体（src_size byte）──
```

### 復号方式の分岐
GARbro `WadyInput` は `remaining = Length-0x30` と `src_size` の一致で方式を選ぶ:

- **`remaining == src_size` → `Decode`（方式1, 最単純）** … 本作 16 件すべてこれ。
- 不一致 → `Decode2/Decode3`（区間補間つき）。本作では未使用。

### 方式1（1 byte → 1 sample, ステレオは L/R 交互）

```
sampleL = sampleR = 0
各 byte v について（ステレオは L,R,L,R… の順）:
    if v & 0x80:  sample = (ushort)(v << 9)              # 絶対値リセット
    else:         sample += (ushort)(MulValue * SampleTable[v])   # 16bit 累積
    write_u16(sample)
```

要点:
- `MulValue * SampleTable[v]` を **先に 16bit 切り捨て**してから加算（C# の `(ushort)` 二重キャスト）。
- すべて **16bit ラップ**。`SampleTable` 後半（`0xFFFE`..`0xFC18`）が負方向デルタ。
- 出力 16bit を **符号付き int16** として WAV/PCM 化する。
- `extract_bgm.py` はこの漸化式を numpy でベクトル化（リセット境界で区切った区間累積和）。

検証の勘所（M01）: 復号後 PCM の **DC offset ≈ 0**（mean≈−0.7）・std≈3700・非クリップ・
無音から滑らかに立ち上がり（`0,0,…,-8,-8`）。署名付き解釈・エンディアンが正しい証拠。
再生時間 = `src_size/2 / 44100 = 173.3s` も索引と一致。

---

## 3. 実装パイプライン（1 スクリプト）

| スクリプト | 役割 |
|---|---|
| `extract_bgm.py` | MDN6 索引パース → WADY 方式1 を numpy 復号 → ffmpeg(pipe) で `.ogg` 書き出し |

```bash
python3 extract_bgm.py                 # 既定: md_bgm_audio/ へ Opus 128k .ogg ×16
python3 extract_bgm.py --codec vorbis  # Ogg Vorbis（cv/se と同コーデック・要 vorbis encoder）
python3 extract_bgm.py --wav           # 無劣化 WAV（ffmpeg 不要・~30MB/曲）
python3 extract_bgm.py --list          # 索引のみ
```

エンコードは一時 WAV を作らず生 PCM を ffmpeg の stdin へ直接 pipe。約 30 秒で全 16 件。

---

## 4. 心得・落とし穴

1. **`.med` を一括りにしない。** cv/se=DXA(`11f2…`)、bgm/gra=MED(`MD…`)。先頭4byteで判別。
2. **cv/se 編で WADY を「不要」と結論しても、bgm では本番。** フォーマットはアーカイブ毎。
3. **Homebrew ffmpeg に libvorbis が無いことがある。** `ffmpeg -encoders | grep vorbis` で確認。
   BGM(音楽) は **libopus** が音質/サイズ最良かつ主要ブラウザ `<audio>` で再生可 → 既定に採用。
4. **符号と 16bit ラップ。** WADY は ushort 累積。最後に int16 として書くと DC offset が消える
   （ずれると mean が大きく偏る／全面ノイズになる）。検証は DC offset と波形統計で。
5. **GARbro は仕様辞典。** 索引は CG と同じ `parse_med`、WADY は `AudioWADY.cs` をそのまま移植。

---
*注: bgm は MED `MDN6`（非暗号）+ WADY。「先頭4byteで MED と判別 → parse_med で 16 索引 →
各 WADY を方式1 で numpy 復号 → DC offset≈0 で検証 → Opus 書き出し」で全 16 トラック取得できる。*
