import type { FixturePosition, FixtureType } from '@/types/fixture'
import type { CueTrigger } from '@/types/cue'

/** 排演表中的一行通道明细（生成时快照，便于历史留档） */
export interface SheetChannelLine {
  channel: number
  position: FixturePosition
  fixtureType: FixtureType
  gel: string
  intensity: number
  colorTempK: number
  focusNote: string
}

/** 排演表中的一条 Cue 条目 */
export interface SheetCueLine {
  cueId: string
  /** 生成时在表内的位次（1 基），用于和最新时间轴顺序比对 */
  seq: number
  cueNo: string
  label: string
  trigger: CueTrigger
  fadeInSec: number
  fadeOutSec: number
  holdSec: number
  note: string
  channels: SheetChannelLine[]
}

/** 排演表（RehearsalSheet）：勾选若干 Cue 组合出的可导出表 */
export interface RehearsalSheet {
  /** 主键 */
  id: string
  /** 所属场次 */
  sessionId: string
  /** 排演表编号，形如 `RS-20250925-01` */
  sheetNo: string
  /** 生成时间，ISO 字符串 */
  generatedAt: string
  /** 生成时勾选的 Cue id 列表 */
  includedCueIds: string[]
  /** 制表备注 */
  note: string
  /** 生成时的条目快照 */
  cueLines: SheetCueLine[]
  /**
   * 「按最新内容另存」时，原表中已不再存在（被删除）的 Cue 编号。
   * 仅另存产生的表会填写；直接生成的表为空数组。
   */
  missingCueNos: string[]
  /** 若是另存产生，记录来源排演表 id，否则为 null */
  derivedFromSheetId: string | null
}

/** 排演表落后差异的单个维度 */
export type SheetDiffKind = 'cueNo' | 'order' | 'transition' | 'channel'

/** 单条 Cue 的一条通道电平差异 */
export interface SheetChannelChange {
  channel: number
  /** 变化字段名 */
  field: 'intensity' | 'colorTempK'
  /** 快照中的旧值 */
  from: number
  /** 当前的新值 */
  to: number
}

/** 单条仍存在 Cue 的差异明细 */
export interface SheetCueChange {
  cueId: string
  /** 展示时优先用当前编号，编号变化时附带旧编号 */
  cueNo: string
  /** 编号变化前的旧编号 */
  previousCueNo: string | null
  /** 命中的差异维度 */
  kinds: SheetDiffKind[]
  /** 通道亮度 / 色温差异明细 */
  channelChanges: SheetChannelChange[]
}

/** 一张历史排演表相对当前现场数据的差异 */
export interface SheetDiff {
  /** 各维度变化条数（同一条 Cue 可在多个维度计数） */
  counts: Record<SheetDiffKind, number>
  /** 变化总条数（各维度之和） */
  totalCount: number
  /** 发生变化的 Cue 编号（去重，按当前编号） */
  changedCueNos: string[]
  /** 逐 Cue 明细 */
  changes: SheetCueChange[]
  /** 快照中已被删除的 Cue 编号 */
  missingCueNos: string[]
  /** 是否落后：有任意变化或有已删除 Cue */
  stale: boolean
}

/** 生成排演表时提交的字段集合 */
export interface SheetDraft {
  sessionId: string
  cueIds: string[]
  note: string
}
