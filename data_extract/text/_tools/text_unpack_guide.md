# MEDエンジン（DxLib 改造版）テキスト抽出ガイダンス

対象: `催眠術４`のスクリプトファイル

> MEDエンジンはDxLibを魔改造した同人/商業ノベルゲーム向けエンジン。「テキストアーカイブの暗号化」「フォントキャッシュ（字形アトラス）の独自生成」など独自改変が入っており、GARbro だけでは本文を読めない（後述）。本書はその全工程を記録する。

---

## 0. サマリ

| 層 | 結論 |
|---|---|
| コンテナ `md_scr.med` | マジック `MDE0`、自前 RE で完全パース可 |
| 暗号 | 0x10 以降を **鍵バイトの繰り返し加算** 。鍵 = `tauromin`（8 byte） |
| 鍵入手 | `_VIEW` エントリの **既知の平文（クリブ）** から逆算（全 MED 共通のテクニック） |

---

## 1. エンジンの見分け方（シグネチャ）

以下が揃えば MED エンジン（GARbro の `MED` / `ArcFormats/DxLib/ArcMED.cs` / `FudegakiEncryption`）。

- ファイル名: `md_scr.med` `md_gra.med` `md_cv.med` `md_bgm.med` `md_se.med` `md_ogm.med` … ＋ `_FONTSET.MED` `_CONFIG.MED` ＋ `EXE.DAT`
- マジック: `MDE0`（スクリプト）/ `MDN1`（画像）/ `MDN6`（BGM）。音声 `md_cv/md_se` は別ヘッダ（`11 f2 24 55 …`）で別暗号
- 実行ファイルが **Borland C++ Builder（VCL）** 製
- `_FONTSET.MED` が異様に巨大（本作で 66 MB）＝事前レンダリングのフォントキャッシュ（開発元が DxLib の中韓対応を潰し、文字バッファの読み書きを自作した名残）

---

## 2. コンテナ `md_scr.med`（MDE0）構造

```
offset
0x00  "MDE0"                      マジック(4)
0x04  u16  recordSize  = 28       1 エントリのバイト数
0x06  u16  count       = 339      エントリ数
0x08  u8[8] = 0                   予約
0x10  ── エントリテーブル開始（recordSize × count）──
      エントリ = name[recordSize-12] (NUL終端ASCII)
                 u32  unknown   ← 累積行数らしき値。再パック時に影響するので無視不可
                 u32  size      ← エントリ本体のバイト長
                 u32  offset    ← ファイル先頭からのオフセット
0x2524 ── data 領域（offset は隙間なく連続）──
```

- 本作: recordSize=28（name=16byte）、count=339、data 開始 0x2524(=9508)。
- 各エントリ本体の先頭 **16 byte は平文サブヘッダ**:
  `u32 a / u32 unk1 / u16 c1 / u16 c2 / u32 d`
  `unk1` は**文字列領域の近くを指す**（本文スキャンの起点に使える）。
  ※ `a` は「size−0x10」相当のことが多いが本作では一致しないエントリもある。**圧縮ではない**（復号すれば直接読める。`a` を展開後サイズと誤認しないこと）。

---

## 3. 暗号方式（FudegakiEncryption）

GARbro `ArcMED.cs` の実装がそのまま正解。

```python
# plain[p] = (cipher[p] + key[p % len(key)]) & 0xFF   （p >= 0x10）
# 先頭 0x10 byte（サブヘッダ）は平文＝復号しない
# key = keyword 文字列を cp932(Shift-JIS) でエンコードしたバイト列
def decrypt(entry_bytes: bytes, key: bytes) -> bytes:
    out = bytearray(entry_bytes)
    L = len(key)
    for p in range(0x10, len(out)):
        out[p] = (out[p] + key[p % L]) & 0xFF
    return bytes(out)
```

- **本作の鍵 = `tauromin`**（`74 61 75 72 6f 6d 69 6e`、周期 8）。GARbro の keyword 欄にも `tauromin` を入れればよい。
- 符号の流儀に注意: 上記は GARbro 式 `plain = cipher + key`。中国語ローカライズ系の資料では `plain = cipher − key'` と書くことがあり、その場合 `key' = (−key) & 0xff`（本作なら `8c 9f 8b 8e 91 93 97 92`）。中身は同じ。

### ⚠️ GARbro の落とし穴
`IsEncrypted` 判定は `サブヘッダ先頭u32 + 0x10 == エントリサイズ` という単純式で、本作では **339 中 50 件しか真にならない**。残り 289（ストーリー脚本など）は「非暗号化」と誤判定され GARbro は素通り（復号しない）。
**実際は全エントリが同じ鍵で暗号化されている。** → GARbro 任せにせず、**全エントリに直接 `decrypt()` を適用**すること。これが「GARbro だけでは本文が読めない」決定的な理由。

---

## 4. 鍵の入手 ―― 決め手：`_VIEW` の既知の平文（クリブ）

鍵は実行ファイル内に平文では置かれず、ゲームごとに異なる。逆アセンブルせずとも、**全 MED アーカイブに必ず `_VIEW` エントリがあり、その復号後ペイロード先頭が固定**という性質で逆算できる。

復号後 `_VIEW` の payload（entry-local 0x10 から）先頭 24 byte は常に:

```
00 23 52 55 4C 45 5F 56 49 45 57 45 52 00 3A 56 49 45 57 5F 30 00 7B 00
=  \0 #  R  U  L  E  _  V  I  E  W  E  R \0 :  V  I  E  W  _  0 \0 {  \0
```

この既知の平文 `crib` と暗号文の差分で鍵が出る（GARbro 式 `plain = cipher + key` なら `key = plain − cipher`）:

```python
crib = bytes([0x00,0x23,0x52,0x55,0x4C,0x45,0x5F,0x56,0x49,0x45,0x57,0x45,0x52,
              0x00,0x3A,0x56,0x49,0x45,0x57,0x5F,0x30,0x00,0x7B,0x00])
view = entry_bytes_of("_VIEW")            # 0x10 以降が暗号文
d = [(crib[i] - view[0x10 + i]) & 0xFF for i in range(24)]   # d[i] = key[(0x10+i) % L]
# d の最小周期 L を求め（経験上 L<=20）、key[(0x10+i)%L]=d[i] で鍵配列を復元
```

`recover_key.py` がこれを実装。本作の出力 → `key = b'tauromin'`、`L = 8`。

### 参考: 既知の他作品の鍵（中国語ローカライズ界隈で共有されているもの）
| 作品 | key（plain=cipher−key' 流儀） |
|---|---|
| それでも妻を愛してる / MONSTER PARK2 系 | `a1 b2 bb a9 b2 bf b2 bf b3 b7` |
| マリッジブルー | `b5 bf ad bf a7 bf` |
| 魔法少女はキスして変身る | `b7 b1 ae b7` |
| 光翼戦姫エクスティア1/2/A | 約20byteの長鍵 |

新版では本文中の `;----` 大量行が消え「繰り返しパターンを探す」旧来手法が効かなくなったため、**`_VIEW` クリブ法が現状の最善・汎用解**。

---

## 5. 本文のデコード（中国語版の場合）

復号後ペイロードは **NUL 区切りの文字列群**。文字コードが混在する:

| 種別 | 例 | エンコード |
|---|---|---|
| セリフ・地の文 | `「哟，欢迎回来。和君」` | **GBK（中国語・翻訳済み）** |
| 演出/コメント指示 | `#背景・喫茶店（夕）` `BODY:` `FACE:` `MUSIC:` | **Shift-JIS（オリジナルの日本語）** |
| ラベル/ボイスID | `AYAN_002_AYAN001A_001` `BG_BLACK` | ASCII |

判別の指針:
- 全バイト ASCII → そのまま
- 先頭が `#` `;` または `^[A-Z][A-Z0-9_]{1,15}:` → エンジン指示＝Shift-JIS で decode
- それ以外 → GBK と Shift-JIS 両方で decode し、**頻出字数/GBK の約物（「」，。）の有無**で多い方を採用（GBK が中国語セリフ）

---

## 6. 実装パイプライン（3 スクリプト）

| スクリプト | 役割 |
|---|---|
| `extract_scr.py` | MDE0 をパースし 339 エントリを生 blob に分割＋ manifest 出力（前段・任意） |
| `recover_key.py` | `_VIEW` クリブから鍵を復元・検証 |
| `extract_text.py` | 全エントリを `tauromin` で復号 → NUL 分割 → 日中自動判別デコード → `md_scr_text_[cn\|jp]/` へ |

出力 `md_scr_text_cn/`:
- `_ALL_dialogue.txt` … 全エントリのセリフ連結（中国語のみ、話者名 `【…】` 付き）
- `<エントリ名>.txt` … `[cn]/[jp]/[ascii]` タグ付き全文（文脈込み）

最小再現コード:
```python
import struct
data = open("saimin4/md_scr.med","rb").read()
rs, n = struct.unpack_from("<HH", data, 4)            # 28, 339
ents=[]; off=0x10
for _ in range(n):
    name=data[off:off+rs-12].split(b"\0")[0].decode("ascii","replace")
    _,size,eo=struct.unpack_from("<III", data, off+rs-12); off+=rs
    ents.append((name,size,eo))
KEY=b"tauromin"
def dec(b):
    o=bytearray(b)
    for p in range(0x10,len(o)): o[p]=(o[p]+KEY[p%len(KEY)])&0xFF
    return bytes(o)
for name,size,eo in ents:
    body = dec(data[eo:eo+size])[0x10:]
    for s in body.split(b"\0"):
        if len(s)<2 or any(x<0x20 and x not in (9,10,13) for x in s): continue
        # ここで §5 の判別をして decode
```

---

## 7. 心得・落とし穴

1. **スコア指標を間違えると確信的に迷う。** 「GBK/SJIS として構造的に妥当なバイト対の割合」は緩すぎ、定数鍵 `0x55` 連打でも高得点が出る。**頻出字の出現率**、最終的には**既知の平文（ground truth）**で判定すべき。
2. **巨大なフォントキャッシュ＝字形インデックス、と早合点しない。** `_FONTSET.MED` 66 MB を見て「文字は字形番号で原理的に復元困難」と誤結論した。実際は**単なる暗号化**で、鍵が分かれば標準文字コードで読める。
3. **`sub0 > size` を「圧縮」と誤認しない。** 圧縮ではなく別フィールド。zlib 等は通らないが、復号すれば直接読める。
4. **鍵を「非暗号化エントリ」に当てて延々失敗しない。** GARbro が非暗号化と誤判定するストーリー脚本に鍵を総当たりしても永遠に解けない。**全エントリが暗号化**されている前提で、まず `_VIEW` で鍵を取る。
5. **総当たりより、正しいクリブ一発。** 座標降下や鍵の総当たりで苦戦したが、`_VIEW` の固定 24 byte を使えば**一瞬で確定**。「正しいデータ × 正しい既知の平文」が最短。
6. **GARbro は入口であって出口ではない。** エントリ内の未知データを無視し、復号も一部しかしない。エンジンを理解して自前で復号・分割・デコードするのが結局速い。

---
*注: 本作の鍵は `tauromin`。MED 作品ごとに鍵は変わるが、`_VIEW` クリブ法（§4）でいつでも自力復元できる。*
