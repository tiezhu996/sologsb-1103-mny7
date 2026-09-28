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
  /** 「按最新内容另存」时原表中已不再存在的 Cue 编号；全新生成为空数组 */
  removedCueNos: string[]
  /** 由哪张排演表另存而来（原表编号）；全新生成为 null */
  refreshedFromSheetNo: string | null
}

/** 生成排演表时提交的字段集合 */
export interface SheetDraft {
  sessionId: string
  cueIds: string[]
  note: string
}

/** 单条快照 Cue 相对当前内容的变化类别 */
export type SheetCueChangeKind = 'cueNo' | 'order' | 'transition' | 'levels'

/** 单条快照 Cue 的变化明细 */
export interface SheetCueChange {
  cueId: string
  /** 快照中记录的编号（编号被改动时与 cueNo 不同） */
  snapshotCueNo: string
  /** 当前编号 */
  cueNo: string
  kinds: SheetCueChangeKind[]
}

/** 历史排演表与当前 Cue 内容的比对结果 */
export interface SheetDiff {
  /** 是否落后于当前内容（有变化或有已删除 Cue 即落后） */
  status: 'up-to-date' | 'stale'
  /** 有新变化的 Cue 条数（不含已删除的） */
  changedCount: number
  changedCueNos: string[]
  changedCueIds: string[]
  detail: SheetCueChange[]
  /** 快照中已不再存在的 Cue 编号 */
  missingCueNos: string[]
}
