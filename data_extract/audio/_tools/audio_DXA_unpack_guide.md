# DXA エンジン（DxLib 標準アーカイブ）音声抽出ガイダンス

対象: `催眠術４`の音声ファイル

> テキストの `md_scr.med` は MED 独自エンジンだが、**音声は MED ではない**。拡張子 `.med` に釣られると詰まる。実体は **DxLib 純正の DXA アーカイブ（version 4）** で、しかも**デフォルト鍵**（パスワード無し）でしか暗号化されていない。本書はその判別から全件抽出までを記録する。

---

## 0. サマリ

| 層 | 結論 |
|---|---|
| コンテナ `md_cv.med` / `md_se.med` | MED ではなく **DxLib DXA version 4**。先頭 `11 f2 24 55` = LE `0x5524F211`（既知の DXA 署名） |
| 暗号 | 12 byte 鍵の**繰り返し XOR**（位置 `(base+i)%12`）。鍵 = **DxLib デフォルト鍵** `55 aa 20 55 55 06 55 aa 55 d5 7c 66`（＝`DxKey.CreateKey("")`） |
| 鍵入手 | 署名と DXA v4 ヘッダ構造から逆算（クリブ不要）。cv/se 両方で同一鍵が出る version＝4 で確定 |
| 格納 | **無圧縮**（packed=-1）。中身は **素の Ogg Vorbis**（`OggS` / mono / 48kHz / libVorbis 1.3.5）。WADY ではない |
| 結果 | ボイス **7,309 本**（`cv_out/`）＋ 効果音 **229 本**（`se_out/`）。全件 `OggS` 検証済み |

ボイスのキャラ別内訳（接頭辞）: `tuba 1921 / suzu 1761 / ayan(綾菜) 1473 / mako 990 / kaed(楓) 600 / saki 358` ＋ あえぎ `BGV 51`・モブ各種 `mob* ~155`・`TEST 2`。

---

## 1. 「これは MED ではない」と気付くまで（フォーマット判別）

`md_*.med` という名前と MED エンジンの先入観から、最初は MED として開こうとして失敗する。見分けの決め手:

- マジックが MED の `MDE0`/`MDN1`/`MDN6` では**ない**。先頭 4 byte = `11 f2 24 55`。
- これを LE uint32 にすると **`0x5524F211`** → GARbro `DxLib/ArcDX.cs` `DxOpener.Signatures` に載っている**既知の DXA 署名**。
- `DxOpener` は拡張子 `dxa/hud/usi/**med**/dat/...` を受け持つ。つまり**同じ `.med` でも MED と DXA の 2 系統がある**。
- DXA は署名が鍵で XOR 済み。`signature ^ key0` の下位 16bit が `0x5844`（`"DX"`）になる鍵を当てれば、上位 16bit が version。

> 教訓: 拡張子・ファイル名でエンジンを決め打ちしない。**先頭 4 byte を必ず uint32 で見る**。GARbro の各 Opener の `Signatures` / `Extensions` 配列が事実上のフォーマット辞典。

---

## 2. コンテナ DXA version 4 構造

```
offset
0x00  u32  signature                    暗号化済み。復号(XOR)すると "DX" + u16 version(=4)
0x04  ── ここから 0x18 byte が暗号化ヘッダ（XOR キーは offset 4 から継続）──
0x04  u32  IndexSize                     インデックス領域のバイト長
0x08  u32  BaseOffset   (= 0x1C)         データ本体の基準オフセット
0x0C  u32  IndexOffset                   インデックス領域のファイル先頭からの位置
0x10  u32  FileTable                     （インデックス内）ファイルテーブルの相対位置
0x14  u32  DirTable                      （インデックス内）ディレクトリテーブルの相対位置
0x1C  ── データ本体（各エントリは無圧縮の .ogg がそのまま）──
...
IndexOffset ── インデックス領域（IndexSize byte、丸ごと XOR 暗号化）──
```

健全性チェック: **`IndexOffset + IndexSize == ファイルサイズ`**（cv/se とも一致）。

本作 `md_cv.med` の実値:
`IndexSize=0xB95F0  BaseOffset=0x1C  IndexOffset=0x27750580  FileTable=0x6AD78  DirTable=0xB95E0`

### インデックス（ディレクトリツリー）= GARbro `IndexReaderV2`
インデックスは `IndexOffset` を基準に XOR 復号してから読む。ディレクトリの木構造で、エントリ 1 件 = **0x2C byte**:

```
0x00  u32  name_offset    （インデックス内、名前テーブルへの相対位置）
0x04  u32  attr           bit4(0x10)=ディレクトリ
0x08  u8[0x18]            タイムスタンプ等（スキップ）
0x20  u32  offset         BaseOffset からの相対オフセット → 実位置 = BaseOffset + offset
0x24  u32  size           展開後サイズ
0x28  i32  packed_size    -1 なら無圧縮（本作は全件 -1）
```

名前の取り出し（`extract_name`）: `name_offset` 位置の u16 を読み `u16*4+4` を足した先に NUL ターミナルの実ファイル名（cp932）。手前の領域は「圧縮名」用で本作では使わない。

---

## 3. 暗号方式（DxLib 標準・繰り返し XOR）

GARbro `DxLib/ArcDX.cs` の `EncryptedStream` / `DxOpener.Decrypt` がそのまま正解。

```python
KEY = bytes([0x55,0xaa,0x20,0x55,0x55,0x06,0x55,0xaa,0x55,0xd5,0x7c,0x66])  # 12 byte

def dxdecrypt(data, base_pos):
    # data[0] がファイル offset base_pos にあるとして XOR 復号
    out = bytearray(data); kp = base_pos % 12
    for i in range(len(out)):
        out[i] ^= KEY[kp]; kp = (kp + 1) % 12
    return bytes(out)
```

- キー位置は**絶対オフセット基準**: 署名は `base=0`、ヘッダ本体は `base=4`、インデックスは `base=IndexOffset`、各エントリは `base=entry.Offset`（v4 なので素直にエントリ位置）。
- 鍵は 12 byte 周期。**MED の `tauromin`（加算・8 周期）とは別物**なので混同しない。

### この鍵の正体 = DxLib デフォルト鍵
`DxKey.CreateKey("")`（空パスワード）の出力と**完全一致**:
12 個の `0xAA` を `key[0]^=0xFF; key[1]=RotR(…)…` と決まった手順で出した結果が `55 aa 20 55 55 06 55 aa 55 d5 7c 66`。
→ **開発元は音声アーカイブにカスタム鍵すら設定していない**（DxLib の既定のまま）。

---

## 4. 鍵の入手 ―― 署名＋ヘッダ構造からの逆算（クリブ不要）

DXA は鍵が無くても**署名から鍵前半・ヘッダの既知値から鍵後半**を復元できる（GARbro `GuessKey` と同じ原理）。version を 1..6 で総当たりし、健全な値が出る version を選ぶ。

```python
import struct, os
head = open(path,'rb').read(0x40); fsize = os.path.getsize(path)
for version in range(1, 7):
    key = bytearray(head[0:12])
    key[0]^=ord('D'); key[1]^=ord('X'); key[2]^=version   # 平文 sig = "DX"+ver
    base_offset = 0x1C if version > 3 else 0x18
    key[8] ^= base_offset                                  # 平文 BaseOffset の下位byte
    key0 = struct.unpack('<I', bytes(key[0:4]))[0]
    index_offset = struct.unpack('<I', head[12:16])[0] ^ key0
    if not (base_offset < index_offset < fsize): continue
    index_size = fsize - index_offset
    if index_size > 0xFFFFFF: continue
    key[4]^=index_size&0xff; key[5]^=(index_size>>8)&0xff; key[6]^=(index_size>>16)&0xff
    print(version, key.hex())   # ← 健全な version の行が答え
```

**決め手**: `md_cv.med` と `md_se.med` は**別ファイルだが同じ鍵**。両者で出力鍵が一致するのは **version=4 だけ**（v5 等は不一致）。さらにその鍵がデフォルト鍵と一致したので二重に確証が取れた。

> version は署名単体では決まらない（鍵に依存）。**「同一鍵を使う 2 ファイルで鍵が一致する version」** を選ぶと一発で確定する。これが本作での近道。

---

## 5. 中身のデコード（不要だった）

復号したエントリの先頭は `4F 67 67 53` = **`OggS`**。すなわち中身は **Ogg Vorbis** がそのまま入っているだけ。GARbro が音声を WADY（Marble 独自 ADPCM）扱いするため身構えたが、本作は素の Ogg なので**追加デコード不要**。`.ogg` として書き出せばそのまま再生・解析できる（`ffprobe` で mono/48kHz/vorbis を確認）。

ファイル名の規約（ボイス）: `ayan_001_pro001A_001.ogg`＝`キャラ_???_シーンID_テイク番号`。
テキスト側スクリプトの**ボイス ID**（例 `AYAN_002_AYAN001A_001`）と突き合わせれば、台詞⇔音声の対応付けが可能。

---

## 6. 実装パイプライン（2 スクリプト）

| スクリプト | 役割 |
|---|---|
| `dxa_index.py` | DXA v4 のヘッダ＆インデックスを復号・解析し、エントリ一覧を返す共通ライブラリ（単体実行で index ダンプ） |
| `extract_cv.py` | 全エントリを XOR 復号して `.ogg` 書き出し＋ `OggS` 検証。引数なしで cv/se 両方を所定の場所へ |

入力は `saimin4_jp` 版を参照（cv/se は中国版とバイト同一なのでどちらでも可）。約 660MB を 2〜3 秒で展開（X="多倍長整数 XOR" で高速化）。

最小再現コード:
```python
import struct
KEY = bytes([0x55,0xaa,0x20,0x55,0x55,0x06,0x55,0xaa,0x55,0xd5,0x7c,0x66])
def dec(b, base):
    return bytes(c ^ KEY[(base+i)%12] for i,c in enumerate(b))
d = open("md_cv.med","rb").read()
assert dec(d[:4],0)[:2]==b"DX"
IndexSize,BaseOffset,IndexOffset,FileTable,DirTable = struct.unpack_from("<5I", dec(d[4:0x1c],4))
idx = dec(d[IndexOffset:IndexOffset+IndexSize], IndexOffset)
# idx を 0x2C 刻みで歩いて name/offset/size を取り、d[BaseOffset+offset:][:size] を dec(...,offset) → .ogg
```

---

## 7. 心得・落とし穴

1. **拡張子 `.med` で MED と決め打ちして弾かれる。** GARbro の MED Opener は先頭 `"MD"` を要求し `11f2…` を拒否する。が、これは**DXA**。**先頭 4 byte を uint32 で見て署名表と照合**するのが正解。
2. **WADY だと身構えて遠回りした。** GARbro が Marble 音声を WADY ADPCM として実装しているため複雑なデコーダを覚悟したが、復号したら `OggS`＝素の Ogg。**まず復号後の先頭バイトを見る**べきだった。
3. **version を署名から一意に決めようとして迷う。** 署名 `0x5524F211` だけでは version 不定。**同一鍵の 2 ファイルで鍵が一致する version（=4）** を選べば確定。GARbro が「v5 非対応」と振る舞っても、実体は v4。
4. **鍵がまさかのデフォルト。** カスタム鍵を探して総当たりしかけたが、復元した鍵は `DxKey.CreateKey("")` そのもの。**まず既定鍵を疑う**（DxLib 系は無設定のことが多い）。
5. **GARbro は入口であって出口ではない（テキスト編と同じ教訓）。** 拡張子の重複担当・version 非対応など GUI 任せだと素通り/失敗する。署名表と Decrypt 実装だけ借りて**自前で復号・分割するのが結局速い**。

---
*注: 本作の音声鍵は DxLib デフォルト（空パスワード）。`.med` でも中身は DXA v4。「先頭 4 byte を uint32 で見る → 署名表照合 → 同一鍵 2 ファイルで version 確定 → 既定鍵を疑う」で自力復元できる。*
