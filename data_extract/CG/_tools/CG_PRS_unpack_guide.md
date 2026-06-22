# MED CG抽出ガイダンス

対象: `催眠术４`の画像 `md_gra.med`（イベントCG・背景・システム）・`md_gra2.med`（立ち絵差分 CH）

> テキストの `md_scr.med` は **MDE0**（暗号化 MED, 鍵 `tauromin`）、音声 `md_cv/se.med` は名前に反して **DxLib DXA v4**。
> 画像の 2 本はまた別で、**MDN1**（非暗号の Marble MED）＋中身は **PRS（`YB` 圧縮ビットマップ）**。同じ `.med` 拡張子でも中身は 3 系統あるので先頭バイトで判別する。

---

## 0. サマリ

| 層 | 結論 |
|---|---|
| コンテナ `md_gra.med` / `md_gra2.med` | **MDN1**（先頭 `4d 44 4e 31` = `"MDN1"`）。索引は**非暗号**（ファイル名がそのまま読める） |
| 索引 | 16byte ヘッダの後、`count` 件 × `entry_len` byte。1 件 = 名前(`entry_len-8`, NUL 詰め) + size(u32 LE) + offset(u32 LE) |
| 中身 | 各エントリは **PRS** 画像（先頭 `YB`）。LZ 系可逆圧縮 + delta フィルタ、BGRA 格納 |
| 暗号 | **無し**。索引もデータも素のまま（テキスト版 MDE0 と違いキー不要） |
| 結果 | `md_gra.med` → **1,267 枚** (`gra_out/`, 1.3GB) / `md_gra2.med` → **2,267 枚** (`gra2_out/`, 392MB)。全件 RGBA/RGB PNG、エラー 0 |

`md_gra.med` の内訳（接頭辞）: `EV 946`（イベントCG）/ `BG 149`（背景）/ `SYS 69` / `CHARVIEW 31` / `CG 19` / `MEM 16` / `ITEM 12` / `PRO 8` / `MENU 4` / `TITLE 3` ほか。
`md_gra2.med` は全 2,267 枚が `CH*`（立ち絵：表情・差分パーツ）。

---

## 1. フォーマット判別

`.med` 3 本（gra/cv/scr）は中身が全部違う。**先頭 4 byte を uint で見る**のが鉄則:

| 先頭4byte | 解釈 | エンジン |
|---|---|---|
| `4d 44 45 30` `MDE0` | 暗号化 MED | テキスト `md_scr.med`（鍵 `tauromin`） |
| `4d 44 4e 31` `MDN1` | 非暗号 MED | **画像 `md_gra*.med`（本書）** |
| `11 f2 24 55` `0x5524F211` | DXA v4 | 音声 `md_cv/se.med` |

MDN1 は GARbro `ArcMED.cs` の非暗号バリアント。索引が平文なので、`md_gra.med` を `strings` に通すだけで `EV001_01 BG17_01_00 …` と中身の名前が読める（これが MDE0 との一番分かりやすい違い）。

---

## 2. コンテナ MDN1 構造

```
offset  size  内容
0x00     4    "MDN1"
0x04     2    entry_len   (gra=29, gra2=27)   ← 1 索引レコードのバイト長
0x06     2    count       (gra=1267, gra2=2267)
0x08     8    予約/未使用（断片的な名前が残ることがあるが索引本体ではない）
0x10   entry_len*count   索引本体
         └ 1 レコード:
              name   : entry_len-8 byte（ASCII, NUL 詰め。拡張子なし）
              size   : u32 LE（アーカイブ内のエントリ長）
              offset : u32 LE（ファイル先頭からの絶対位置）
offset…       各エントリの実データ（PRS）
```

`entry_len` がアーカイブごとに違う＝名前欄の幅が違うだけ（gra=21字, gra2=19字）。`name_len = entry_len - 8` で求める。

---

## 3. PRS 画像（Marble `YB`）

各エントリ先頭 16byte がヘッダ:

```
0x00  2  "YB"
0x02  1  flag    （bit7=1 で delta フィルタ有り。実データは 0x83 が大半）
0x03  1  depth   （3=BGR, 4=BGRA。本作はほぼ 4）
0x04  4  packed  （圧縮ストリームのバイト長 = 消費すべき入力量）
0x08  4  (未使用)
0x0c  2  width   (u16 LE)
0x0e  2  height  (u16 LE)
0x10  …  圧縮ビットストリーム
```

### 展開アルゴリズム（GARbro `ImagePRS.cs` 準拠）
- MSB ファーストの制御ビット列。`ctl` を 1byte 読み、bit を `0x80→…→0x01` と下げながら使う。
- ビット=0 → リテラル 1byte をそのまま出力。
- ビット=1 → 後続バイト `b` でコピー指示:
  - `b & 0x80`: 長距離参照。`shift = read() | ((b&0x3f)<<8)`。さらに
    - `b & 0x40`: 追加 1byte で `length = LEN_TABLE[off]`（`LEN_TABLE[i]=i+3`、ただし `0xfe→0x400`, `0xff→0x1000`）。
    - else: `length=(shift&0xf)+3; shift>>=4`。
  - else（`b<0x80`）: `length=b>>2; b&=3`。`b==3` なら `length+=9` の**長リテラルコピー**、それ以外は `shift=length; length=b+2` の短距離参照。
  - 参照は `shift+1` バックして `length` byte **オーバーラップコピー**（自己参照あり）。
- `remaining`(=packed) を消費し切るか出力が埋まったら終了。

### 後処理
1. **delta フィルタ**（`flag&0x80`）: `out[i] += out[i-depth]`（各チャンネル独立の左隣加算）。
2. **BGR(A)→RGB(A)**: Pillow で `split()`→`merge()` して B と R を入れ替え。`depth==3` は RGB、`4` は RGBA で保存。

---

## 4. 再生成

```
# 既定: 両アーカイブを全展開（CPU-2 並列）
python3 "CG/_tools/extract_gra.py"

# 片方だけ / 一覧 / 並列数指定
python3 "CG/_tools/extract_gra.py" --only gra2
python3 "CG/_tools/extract_gra.py" --list
python3 "CG/_tools/extract_gra.py" --jobs 8
```

出力 → `md_gra_cg/`（md_gra.med）・`md_gra2_cg/`（md_gra2.med）。既存 PNG は自動スキップ（`skip`）。
画像 2 本は日本語版/中国語版でサイズ同一＝**バイト同一**なのでどちらでも結果は同じ。所要時間は 10 コアで合計 ≈ 3 分（gra2 ≈ 54s + gra ≈ 137s）。

---

## 5. 教訓

- **拡張子・ファイル名でエンジンを決めない**。`.med` だけで MDE0 / MDN1 / DXA の 3 種が混在する。先頭 4 byte が事実上の判別子。
- MDN1 は索引非暗号 → `strings` で中身カタログが先に分かる。MDE0（テキスト）だけがキー必須という非対称に注意。
- PRS は per-byte の純 Python だと 1 枚 ≈ 0.1〜0.7s。3,534 枚あるので **multiprocessing 必須**（各ワーカがファイルを開き直す。索引共有は不要）。
- 移植元は GARbro（`ArcMED.cs` / `ImagePRS.cs`）。`Signatures`/`Extensions` 配列が実質フォーマット辞典。
