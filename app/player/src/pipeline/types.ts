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

// ---- ビート（地の文 / セリフ）----
export const NarrationBeat = z.object({
  kind: z.literal('narration'),
  lines: z.array(z.string()),
  bg: BgRef.optional(),
  sprite: SpriteRef.optional(),
})
export type NarrationBeat = z.infer<typeof NarrationBeat>

export const LineBeat = z.object({
  kind: z.literal('line'),
  who: z.string(),
  voice: VoiceRef.optional(),
  lines: z.array(z.string()),
  bg: BgRef.optional(),
  sprite: SpriteRef.optional(),
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
  beats: z.array(Beat),
})
export type Scene = z.infer<typeof Scene>

// ---- フロー（ルート分岐グラフ）----
export const FlowNodeKind = z.enum(['start', 'arc', 'branch', 'end', 'omake'])
export type FlowNodeKind = z.infer<typeof FlowNodeKind>

export const FlowNode = z.object({
  id: z.string(),
  kind: FlowNodeKind,
  character: z.enum(['common', 'ayan', 'suzu', 'tuba', 'mako', 'kaede', 'branch', 'end', 'omake']),
  title: z.string(),
  icon: z.string().optional(),
  description: z.string().optional(),
  pos: z.object({ x: z.number(), y: z.number() }).optional(),
  scenes: z.array(z.string()),
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
