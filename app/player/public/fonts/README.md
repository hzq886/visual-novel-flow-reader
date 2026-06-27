# 同梱フォント（字幕・題字・UI 用）

原データの使用文字だけにサブセットした woff2。locale 別に出し分ける（jp=和文 / cn=簡体字）。

| ファイル                               | 書体                | 用途         | ライセンス                                                                    |
| -------------------------------------- | ------------------- | ------------ | ----------------------------------------------------------------------------- |
| `zen-kaku-gothic-new-jp-400/700.woff2` | Zen Kaku Gothic New | jp（日本語） | SIL Open Font License 1.1（`Zen_Kaku_Gothic_New-OFL.txt`）                    |
| `alibaba-puhuiti-3-cn-400/700.woff2`   | Alibaba PuHuiTi 3.0 | cn（簡体字） | Alibaba PuHuiTi 無償商用ライセンス（[公式](https://fonts.alibabagroup.com/)） |

## 生成手順（再現）

`fonttools`（`pyftsubset`）で、全シーン JSON（jp/cn）＋UI から抽出した使用文字に絞ってサブセット。

```sh
# 使用文字抽出（jp/cn 別）→ charset-*.txt
# pyftsubset <font> --text-file=charset-<loc>.txt --flavor=woff2 \
#   --layout-features='kern,palt,liga,locl' --no-hinting --desubroutinize
```

- 元フォント取得元: Zen Kaku Gothic New = Google Fonts（`ofl/zenkakugothicnew`）/ Alibaba PuHuiTi 3 = npm `alibabapuhuiti-3-55-regular` / `-3-85-bold`（jsDelivr）。
- 使用文字が増えた場合は再サブセットが必要（不足字は system フォントにフォールバック）。
