# ADR 0006: 効果音（se）・BGM のキュー抽出と割当

- ステータス: 採択（2026-06-27）
- 関連: [0002 データスキーマ](0002-data-schema.md) / [0003 アセットパイプライン](0003-asset-pipeline.md) / [0004 ボイス解決](0004-voice-resolution.md) / [`smain_flow_guide.md` §3.9](../../data_extract/text/_tools/smain_flow_guide.md)

## コンテキスト

HU-27 で全編エンジン化したが、bgm/se の**再生キュー**がシーンデータに無く実際に鳴らせなかった。
bgm 素材は `M01〜M16`、se は `8351a` 等の汎用名で、原テキスト（`[text]/[id]/[note]`）に bgm 名が
出ないことから、当初は「音声キューは bytecode 側」と想定して HU-28 を切り出した（[HU-28]）。

bytecode RE（[`smain_flow_guide.md` §3.9](../../data_extract/text/_tools/smain_flow_guide.md)）の結論:

- **se は bytecode に存在し抽出可能**。シーン脚本の `0x6c` が se 再生命令で、se コードは各シーンの
  文字列表に大文字で並ぶ。同コードは `extract_text.py` の `[id]` マーカーにも現れる（文字列表ダンプ）。
  - **訂正（HU-70 / [ADR 0009](0009-item-cg-overlay.md)）**: シーン脚本の文字列参照は 0 始まりで、
    se 再生命令は **`0x15`**（`0x6c` は `EFFECT:FLASHn` 実行）。「0x6c=se」は 1 始まり誤読だった。
    本 ADR の決定（se をテキスト `[id]` マーカーから抽出）自体は不変（→ §3.12 台帳）。
- **bgm（M01-M16 のトラック選択）は `md_scr.med` に一切エンコードされていない**（全 opcode/SMAIN/
  定義表/文字列を網羅確認済。`MUSIC:N` はタイトルメニュー専用）。恐らく実行ファイル側にハードコード。

## 決定

### スキーマ（types.ts）

- `SeRef{code, file|null}` を追加。`Beat.se?: SeRef[]`（narration/line とも、1 beat に複数可）。
- `BgmRef{track, file|null}` を追加。`Scene.bgm?: BgmRef`（シーン単位）。
- 既存同様 **`file=null` は未解決**を表し `validate` が検出する。

### se の抽出（テキスト `[id]` 経由）

- `parseScene` が `[id]` マーカーのうち se コード（`SE_RE = ^\d{4}[A-Za-z]$`）を beat に取り込む
  （ボイスID `CHAR_..._NN` や選択肢ID `<scene>_NN_MM`、制御マーカー `BG_BLACK` 等とは別形式）。
  現 beat があればそこへ、無ければ次 beat へ持ち越す。
- bytecode（`0x6c`）でなくテキスト `[id]` を採るのは: (a) 文字列表ダンプが 0x6c の 393 件より多い
  641 件（0x01 経由分を含む）で**より完全**、(b) jp/cn 両テキストに同位置で現れ整列問題が無い、
  (c) `parseScene`（voice と同流儀）に自然に統合できるため。bytecode RE はどの `[id]` が se かを
  実証した役割。
- `resolveScene` が manifest で実ファイルへ解決（se は小文字 `8351a.ogg`、ボイス同様大小文字無視）。

### bgm の割当（ルート＝character ベースの curated 対応）

- bgm はデータに無いため、**シーンコードの character（ルート）→ M01-M16 を `BGM_BY_CHARACTER`
  （`src/pipeline/audio.ts`）で curated 割当**する。`build-scenes` が `Scene.bgm` を付与。
- これは抽出値ではなく**編集可能な対応表**。正確な対応（実行ファイル解析や実聴）が判明したら差し替える。
- エンジン（`AudioManager.playBgm`）は同 track をシーン跨ぎで継続（同 URL は no-op）し、track が変わる
  遷移でクロスフェードする → 受入「bgm がシーンを跨いで継続・場面/ルート転換で切替」を満たす。

### エンジン配線（Stage.tsx）

- シーン変更で `playBgm(scene.bgm.file)`、各 beat 描画で `playSe(beat.se[*].file)`、終端で `stopBgm`。
- `AudioManager`（HU-27 実装の bgm/se/voice チャンネル）は変更なし。

### validate

- manifest がある環境では se/bgm の `file=null`（参照不整合）を **hard fail**（bg/sprite と同列）。
  manifest が無い環境（素材未配置）では se は file=null・bgm 未付与になるため照合をスキップ。

### 背景ボイス（BGV ループ）— HU-37 で追加

- シーン脚本の `[id] BGV_<CHAR>_<H|F>nnn[A|B]`（例 `BGV_AYAN_H001A`）= 背景ボイス（喘ぎ等の
  **ループ音声**）。`voice/BGV_*.ogg` は manifest 実在（voice カテゴリ）。
- **semantics（RE 結果）**: 単一ループチャンネル。新しい BGV が現在のループを置換し、**停止マーカーは
  原データに存在しない**（H001→H003 と強度が上がり、OFF を跨いでも継続）。よってシーン局所で、
  次の BGV まで／シーン離脱まで持続する。
- **データ**: `bg`/`sprite` と同じ **sticky** モデル。`parseScene` が `stickyBgv` を beat に
  snapshot し、変化時に narration を flush（HU-34）して正しい行から鳴らす。解決は voice と同じ
  `resolveVoice`（id→manifest 実ファイル。大小文字規則は [ADR 0004](0004-voice-resolution.md)）。
  スキーマは `Beat.bgv?: VoiceRef`。
- **エンジン**: `AudioManager` に第4チャンネル `playBgv`/`stopBgv`（`loop:true`・別URLで切替・
  同URL no-op）。`Stage` は各 beat で `beat.bgv.file` を `playBgv`、シーン離脱（`releaseVoices`）と
  終端で `stopBgv`。BGV はシーンを跨がない（bgm のみ跨ぐ）。

### ループ se（VOL_LPSE）— HU-76 で追加

- シーン脚本の `0x16`（`16 <u16 idx> 00`・length 4・207 件）= **ループ se**（`_SYSTEM` の `VOL_LPSE:3`
  チャンネル。§3.9）。`0x15`（length 3・ワンショット・`VOL_SE:3`）とは別命令・別チャンネル。se コードは
  81xx 系（動作音等）に集中し 63 シーンに出現。同一コードが `0x15`（ワンショット）でも使われる＝**再生モード
  の違い**（ファイル自体はループ専用ではなく、LPSE チャンネルでループ再生される）。
  - **注記（HU-76 で発見）**: HU-73/74 の se ハンドラは `length == 3` 条件だったため、length 4 の `0x16` は
    **一度も emit されていなかった**（暗黙ドロップ。txt もデデュープで拾わずパリティが偶然成立）。本 ADR で
    `0x16`→`lpse` として正式に取り込み、欠落を解消。
- **semantics（RE 結果）**: BGV と同型の**単一ループチャンネル**。新しい lpse が現在のループを置換し、
  **停止マーカーは原データに存在しない**（`8131A→B→C` と強度が上がる。start/stop バイト区別も無く末尾は
  常に `0x00`）。よってシーン局所で、次の lpse まで／シーン離脱まで持続する。
- **データ**: `bg`/`sprite`/`bgv` と同じ **sticky** モデル。`buildScene` が `stickyLpse` を beat に
  snapshot し、変化時に narration を flush（HU-34）。解決は se と同じ `resolveSe`（コード→manifest 実ファイル。
  16 コード全て実在）。スキーマは `Beat.lpse?: SeRef`（se 素材のため型は SeRef 共用）。
- **エンジン**: `AudioManager` に `playLpse`/`stopLpse`（`loop:true`・単一チャンネル・別 URL で切替・同 URL no-op）。
  `Stage` は各 beat で `beat.lpse.file` を `playLpse`、シーン離脱・終端で `stopLpse`。BGM のみシーンを跨ぐ
  （lpse は BGV 同様シーン局所）。

## 帰結

- 主要ルートで bgm がシーンを跨いで継続し、ルート転換でクロスフェードする。se は該当 beat で鳴る。
- `validate`：se 641 参照・bgm 288 シーンとも未解決 0（manifest 同期済）。
- BGM の track 対応は暫定（curated）。実聴での補正は `BGM_BY_CHARACTER` の編集で完結し、再ビルド不要の
  低リスク変更。H シーン等のムード別 bgm 変化（ルート内変動）は未対応＝将来の精緻化余地。
- BGV（`BGV_*` ループ喘ぎ）は **HU-37 で対応**（上記「背景ボイス」節）。45 種が解決（未解決 0）。
  音量個別制御（`VOL_SET:`/VOL_BGCV 等）は将来課題（HU-40）。
