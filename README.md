# プロジェクト構成

```
visual-novel-flow-reader/
├── app/                         … オリジナルゲームを再構築したwebアプリ
├── original_game/               … ゲーム本体
├── data_extract/
│   ├── text/                    … md_scr.med から抽出したテキスト（中国語版＋日本語版）
│   │   ├── _tools/                  抽出ツール一式＋ガイダンス
│   │   │   ├── extract_scr.py        MDE0コンテナ→生blob分割
│   │   │   ├── recover_key.py        _VIEWクリブから復号鍵を自動復元（パス引数可）
│   │   │   ├── extract_text.py       全エントリ復号→本文/指示/ID分類（鍵は_VIEW自動復元, --mode auto|jp|cn）
│   │   │   └── text_unpack_guide.md   解析・解読のガイダンス
│   │   ├── md_scr_text_cn/           中国語版テキスト（339ファイル＋_ALL_dialogue.txt：本文36,790行）
│   │   └── md_scr_text_jp/           日本語版テキスト（339ファイル＋_ALL_dialogue.txt：本文44,744行）
│   ├── audio/                     … 音声。cv/se=DXA v4(Ogg)、bgm=MED MDN6+WADY と別系統
│   │   ├── _tools/                  抽出ツール一式＋ガイダンス
│   │   │   ├── dxa_index.py          DXA v4 ヘッダ＆インデックス復号・解析（cv/se）
│   │   │   ├── extract_cv.py         全エントリ XOR 復号→ .ogg 書き出し（cv/se 両対応）
│   │   │   ├── extract_bgm.py        md_bgm.med(MDN6)→WADY 復号→Opus .ogg（bgm 16曲）
│   │   │   ├── audio_DXA_unpack_guide.md    cv/se(DXA) 解析ガイダンス
│   │   │   └── audio_BGM_WADY_unpack_guide.md  bgm(MDN6+WADY) 解析ガイダンス
│   │   ├── md_cv_audio/                   ボイス 7,309 本（.ogg / mono 48kHz Vorbis）
│   │   ├── md_se_audio/                   効果音 229 本（.ogg）
│   │   └── md_bgm_audio/                  BGM 16 曲（M01..M16 / .ogg Opus 44.1kHz stereo）
│   └── CG/                        … md_gra.med / md_gra2.med から抽出した画像（PRS→PNG）
│       ├── _tools/                  抽出ツール一式＋ガイダンス
│       │   ├── extract_gra.py        MDN1 索引→PRS 全件 PNG 化（multiprocessing 並列）
│       │   └── CG_PRS_unpack_guide.md   解析・解読のガイダンス
│       ├── md_gra_cg/                 md_gra.med  1,267 枚（EV/BG/SYS/CG ... / .png）
│       └── md_gra2_cg/                md_gra2.med 2,267 枚（CH 立ち絵差分 / .png）
└── README.md   （本ファイル）
```
