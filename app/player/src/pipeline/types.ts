import { z } from 'zod'

/**
 * シーン / フローの構造化データ契約（zod スキーマ＋型推論）。
 * 原データ `[text]/[id]/[note]` を parseScene が Scene に変換し、
 * フロー再抽出（extract-flow.py）が Flow を生成する。
 * 詳細は plan / docs/adr/0002-data-schema.md。
 */

// ---- 素材参照（file=null は未解決。validate が検出）----
export const BgRef = z.object({
  label: z.string(),
  file: z.string().nullable(),
})
export type BgRef = z.infer<typeof BgRef>

export const SpriteRef = z.object({
  label: z.string(),
  body: z.string().nullable(),
  face: z.string().nullable(),
  offset: z.tuple([z.number(), z.number()]).optional(),
})
export type SpriteRef = z.infer<typeof SpriteRef>

export const VoiceRef = z.object({
  id: z.string(),
  file: z.string().nullable(),
})
export type VoiceRef = z.infer<typeof VoiceRef>

// 効果音参照。code は原データの se コード（例 "8351A"）。file=null は未解決（validate が検出）。
// se キューはシーン脚本 bytecode の再生命令に由来（→ smain_flow_guide.md §4 / src/pipeline/audio.ts）。
export const SeRef = z.object({
  code: z.string(),
  file: z.string().nullable(),
})
export type SeRef = z.infer<typeof SeRef>

// BGM 参照。track は素材名（"M01"〜"M16"）。ルート（character）から curated 割当（audio.ts）。
export const BgmRef = z.object({
  track: z.string(),
  file: z.string().nullable(),
})
export type BgmRef = z.infer<typeof BgmRef>

// ---- 立ち絵/背景 解決テーブル（build-defs が _SPRSET/_BGSET から生成。resolve* の入力）----
// _SPRSET.txt の1ブロック。code に body/face の suffix を連結すると素材コードになる
// （例 code "CH01B_01_02" + body "_003_02" → "CH01B_01_02_003_02"）。
// body/face のキーは原データ通り先頭 "・" 付きラベル（シーン note と直結するため）。
export const SprsetEntry = z.object({
  code: z.string(), // "CH01B_01_02"
  body: z.record(z.string(), z.string()), // "・私服０２" → "_003_02"
  face: z.record(z.string(), z.tuple([z.string(), z.number(), z.number()])), // "・にっこり１" → ["_102_01", 342, 84]
})
export type SprsetEntry = z.infer<typeof SprsetEntry>

export const SprsetTable = z.record(z.string(), SprsetEntry) // prefixLabel → entry
export type SprsetTable = z.infer<typeof SprsetTable>

// _BGSET.txt: note ラベル（"#背景・喫茶店（夕）" など）→ [id] コード（"BG20_02_00"）。
export const BgsetTable = z.record(z.string(), z.string())
export type BgsetTable = z.infer<typeof BgsetTable>

// ---- ビート（地の文 / セリフ）----
export const NarrationBeat = z.object({
  kind: z.literal('narration'),
  lines: z.array(z.string()),
  bg: BgRef.optional(),
  sprite: SpriteRef.optional(),
  se: z.array(SeRef).optional(), // この beat で鳴らす効果音（ワンショット、複数可）
})
export type NarrationBeat = z.infer<typeof NarrationBeat>

export const LineBeat = z.object({
  kind: z.literal('line'),
  who: z.string(),
  voice: VoiceRef.optional(),
  lines: z.array(z.string()),
  bg: BgRef.optional(),
  sprite: SpriteRef.optional(),
  se: z.array(SeRef).optional(), // この beat で鳴らす効果音（ワンショット、複数可）
})
export type LineBeat = z.infer<typeof LineBeat>

export const Beat = z.discriminatedUnion('kind', [NarrationBeat, LineBeat])
export type Beat = z.infer<typeof Beat>

// ---- シーン ----
export const Locale = z.enum(['jp', 'cn'])
export type Locale = z.infer<typeof Locale>

export const Scene = z.object({
  code: z.string(), // "002_AYAN001A"
  route: z.string(), // "002"（prefix）。意味付けは flow で解釈
  locale: Locale,
  title: z.string().optional(),
  // シーンの BGM（ルート＝character から curated 割当）。エンジンがシーン跨ぎで継続し、
  // 別 track のシーンへ遷移時にクロスフェードする（AudioManager.playBgm）。
  bgm: BgmRef.optional(),
  beats: z.array(Beat),
})
export type Scene = z.infer<typeof Scene>

// ---- フロー（ルート分岐グラフ）----
export const FlowNodeKind = z.enum(['start', 'arc', 'branch', 'end', 'omake'])
export type FlowNodeKind = z.infer<typeof FlowNodeKind>

// 選択肢メニュー（シーン脚本の `<scene>_NN_MM` 選択肢ID から抽出。jp/cn i18n）。
export const FlowChoice = z.object({
  scene: z.string(), // 選択肢を含むシーンコード
  options: z.array(
    z.object({
      jp: z.string(),
      cn: z.string().nullable(), // cn 未抽出は null
      // ルート分岐（SMAIN len-8 switch）の選択肢のみ付与（HU-21）。非分岐の局所選択肢は持たない。
      flag: z.string().optional(), // この選択肢が書くフラグ＝値（例 "S71/軸2_1=2"）
      target: z.string().optional(), // 分岐先ノード id
      targetTitle: z.string().optional(), // 分岐先ノードの表示タイトル
    }),
  ),
})
export type FlowChoice = z.infer<typeof FlowChoice>

export const FlowNode = z.object({
  id: z.string(),
  kind: FlowNodeKind,
  character: z.enum(['common', 'ayan', 'suzu', 'tuba', 'mako', 'kaede', 'branch', 'end', 'omake']),
  title: z.string(),
  icon: z.string().optional(),
  description: z.string().optional(),
  pos: z.object({ x: z.number(), y: z.number() }).optional(),
  scenes: z.array(z.string()),
  choices: z.array(FlowChoice).optional(),
  groups: z
    .array(
      z.object({
        key: z.string(),
        tone: z.string(),
        title: z.string(),
        kids: z.array(z.object({ code: z.string(), label: z.string() })),
      }),
    )
    .optional(),
})
export type FlowNode = z.infer<typeof FlowNode>

export const FlowEdge = z.object({
  source: z.string(),
  target: z.string(),
  label: z.string().optional(),
  character: z.string().optional(),
  condition: z.object({ flags: z.array(z.string()) }).optional(),
})
export type FlowEdge = z.infer<typeof FlowEdge>

export const Flow = z.object({
  nodes: z.array(FlowNode),
  edges: z.array(FlowEdge),
})
export type Flow = z.infer<typeof Flow>

// ---- 素材 manifest（fetch-assets が生成、resolve* の照合先）----
export const ManifestEntry = z.object({
  category: z.enum(['cg', 'sprite', 'voice', 'se', 'bgm']),
  file: z.string(), // public/assets からの相対パス（例 "voice/ayan_002_ayan001A_001.ogg"）
  size: z.number(),
  sha256: z.string().nullable(),
})
export type ManifestEntry = z.infer<typeof ManifestEntry>

export const Manifest = z.object({
  generatedFrom: z.string(), // ASSET_SRC の絶対パス
  entries: z.array(ManifestEntry),
})
export type Manifest = z.infer<typeof Manifest>
