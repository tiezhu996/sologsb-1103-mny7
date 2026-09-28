import type { Cue } from '@/types/cue'
import type { CueLevel } from '@/types/level'
import type { Fixture } from '@/types/fixture'
import type {
  RehearsalSheet,
  SheetChannelChange,
  SheetCueChange,
  SheetDiff,
  SheetDiffKind
} from '@/types/sheet'
import { sortCues } from '@/utils/cueOrder'

/** 比对一条 Cue 快照与当前现场数据所需的现场视图（顺序无关，内部按时间轴归一化） */
export interface SheetDiffContext {
  /** 当前场次内仍存在的 Cue */
  cues: Cue[]
  /** 现场通道电平 */
  levels: CueLevel[]
  /** 现场灯位通道（channel 取自 fixture） */
  fixtures: Fixture[]
}

function emptyCounts(): Record<SheetDiffKind, number> {
  return { cueNo: 0, order: 0, transition: 0, channel: 0 }
}

/**
 * 比对单条 Cue 的通道亮度 / 色温。
 * 快照里按通道号记录；现场以 (cue, fixture) 的电平为准，通道号取自 fixture。
 */
function diffChannels(
  snapshotChannels: RehearsalSheet['cueLines'][number]['channels'],
  cue: Cue,
  context: SheetDiffContext
): SheetChannelChange[] {
  const changes: SheetChannelChange[] = []
  // channel -> 当前该通道对应 fixture 的电平
  const fixtureByChannel = new Map<number, Fixture>()
  context.fixtures.forEach((fixture) => {
    if (fixture.sessionId === cue.sessionId) fixtureByChannel.set(fixture.channel, fixture)
  })
  const levelByFixture = new Map<string, CueLevel>()
  context.levels.forEach((level) => {
    if (level.cueId === cue.id) levelByFixture.set(level.fixtureId, level)
  })

  snapshotChannels.forEach((snap) => {
    const fixture = fixtureByChannel.get(snap.channel)
    // 通道已被删除 / 改号，现场找不到同号通道时，旧的亮度色温无法对应，跳过
    if (!fixture) return
    const live = levelByFixture.get(fixture.id)
    if (!live) return
    if (live.intensity !== snap.intensity) {
      changes.push({ channel: snap.channel, field: 'intensity', from: snap.intensity, to: live.intensity })
    }
    if (live.colorTempK !== snap.colorTempK) {
      changes.push({ channel: snap.channel, field: 'colorTempK', from: snap.colorTempK, to: live.colorTempK })
    }
  })
  return changes
}

/**
 * 把一张历史排演表的生成时快照与当前现场数据对比，
 * 输出编号 / 顺序 / 过渡 / 通道亮度色温四类变化条数与涉及编号，
 * 并单列已不再存在的 Cue 编号。
 */
export function diffSheet(sheet: RehearsalSheet, context: SheetDiffContext): SheetDiff {
  const counts = emptyCounts()
  const changes: SheetCueChange[] = []
  const missingCueNos: string[] = []

  const liveById = new Map<string, Cue>()
  context.cues.forEach((cue) => liveById.set(cue.id, cue))

  // 当前时间轴顺序：cueId -> 位次（1 基，仅统计原表仍收录的 Cue 之间的相对顺序）
  const survivingIdsInLiveOrder = new Map<string, number>()
  let cursor = 0
  sortCues(context.cues).forEach((cue) => {
    if (sheet.cueLines.some((line) => line.cueId === cue.id)) {
      cursor += 1
      survivingIdsInLiveOrder.set(cue.id, cursor)
    }
  })

  sheet.cueLines.forEach((line) => {
    const live = liveById.get(line.cueId)
    if (!live) {
      missingCueNos.push(line.cueNo)
      return
    }

    const kinds: SheetDiffKind[] = []

    // 1. 编号变化
    const renumbered = live.cueNo !== line.cueNo
    if (renumbered) {
      kinds.push('cueNo')
      counts.cueNo += 1
    }

    // 2. 顺序变化（与仍收录 Cue 之间的相对位次比较）
    const liveSeq = survivingIdsInLiveOrder.get(line.cueId)
    if (liveSeq !== undefined && liveSeq !== line.seq) {
      kinds.push('order')
      counts.order += 1
    }

    // 3. 过渡变化（渐亮 / 保持 / 渐暗）
    const transitionChanged =
      live.fadeInSec !== line.fadeInSec || live.fadeOutSec !== line.fadeOutSec || live.holdSec !== line.holdSec
    if (transitionChanged) {
      kinds.push('transition')
      counts.transition += 1
    }

    // 4. 通道亮度 / 色温变化
    const channelChanges = diffChannels(line.channels, live, context)
    if (channelChanges.length > 0) {
      kinds.push('channel')
      counts.channel += channelChanges.length
    }

    if (kinds.length > 0) {
      changes.push({
        cueId: live.id,
        cueNo: live.cueNo,
        previousCueNo: renumbered ? line.cueNo : null,
        kinds,
        channelChanges
      })
    }
  })

  const totalCount = counts.cueNo + counts.order + counts.transition + counts.channel
  // 涉及编号：发生变化的 Cue（按当前编号），已删除的单列，不计入这里
  const changedCueNos = changes.map((change) => change.cueNo)

  return {
    counts,
    totalCount,
    changedCueNos,
    changes,
    missingCueNos,
    stale: totalCount > 0 || missingCueNos.length > 0
  }
}

/** 维度中文标签 */
export const SHEET_DIFF_KIND_LABELS: Record<SheetDiffKind, string> = {
  cueNo: '编号',
  order: '顺序',
  transition: '过渡',
  channel: '通道亮度色温'
}
