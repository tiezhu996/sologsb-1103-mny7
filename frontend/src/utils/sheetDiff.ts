import type { Cue } from '@/types/cue'
import type { CueLevel } from '@/types/level'
import type { Fixture } from '@/types/fixture'
import type { SheetChannelLine, SheetCueChange, SheetCueChangeKind, SheetDiff } from '@/types/sheet'
import { sortCues } from '@/utils/cueOrder'
import { sortFixturesByChannel } from '@/utils/patch'

/** 变化类别的中文描述 */
export const CUE_CHANGE_LABELS: Record<SheetCueChangeKind, string> = {
  cueNo: '编号',
  order: '顺序',
  transition: '过渡',
  levels: '通道亮度色温'
}

/** 对比单通道亮度 / 色温（对焦说明不参与落后判定） */
function channelChanged(snapshot: SheetChannelLine, current: SheetChannelLine): boolean {
  return snapshot.channel !== current.channel || snapshot.intensity !== current.intensity || snapshot.colorTempK !== current.colorTempK
}

/**
 * 以生成时快照对比当前 Cue / 电平数据：
 * - 仍存在的 Cue 比对编号、顺序（相对位次）、过渡、通道亮度色温；
 * - 已删除的 Cue 不计入变化条数，编号单独列入 missingCueNos。
 */
export function diffSheet(
  sheet: { cueLines: readonly { cueId: string; cueNo: string; fadeInSec: number; fadeOutSec: number; holdSec: number; channels: readonly SheetChannelLine[] }[] },
  cues: readonly Cue[],
  levels: readonly CueLevel[],
  fixtures: readonly Fixture[]
): SheetDiff {
  const orderedCurrent = sortCues(cues)
  const currentById = new Map(orderedCurrent.map((cue) => [cue.id, cue]))

  // 只在「快照中且当前仍存在」的 Cue 子集内比较相对位次，
  // 新增 Cue 或删除 Cue 都不会把位次变化误报到其余 Cue 上
  const survivorIds = new Set(sheet.cueLines.map((line) => line.cueId).filter((id) => currentById.has(id)))
  const snapshotRank = new Map<string, number>()
  let snapshotCursor = 0
  sheet.cueLines.forEach((line) => {
    if (survivorIds.has(line.cueId)) snapshotRank.set(line.cueId, snapshotCursor++)
  })
  const currentRank = new Map<string, number>()
  let currentCursor = 0
  orderedCurrent.forEach((cue) => {
    if (survivorIds.has(cue.id)) currentRank.set(cue.id, currentCursor++)
  })

  const levelsByCue = new Map<string, CueLevel[]>()
  levels.forEach((level) => {
    const list = levelsByCue.get(level.cueId)
    if (list) list.push(level)
    else levelsByCue.set(level.cueId, [level])
  })

  /** 从当前数据还原一条 Cue 的通道亮度色温，口径与生成快照一致：
   *  按通道号顺序遍历灯具，仅收录已设电平的通道（含灯具排序，避免同通道号错位） */
  function currentChannels(cueId: string): SheetChannelLine[] {
    const levelByFixture = new Map(
      (levelsByCue.get(cueId) ?? []).map((level) => [level.fixtureId, level])
    )
    const lines: SheetChannelLine[] = []
    sortFixturesByChannel(fixtures).forEach((fixture) => {
      const level = levelByFixture.get(fixture.id)
      if (!level) return
      lines.push({
        channel: fixture.channel,
        position: fixture.position,
        fixtureType: fixture.fixtureType,
        gel: fixture.gel,
        intensity: level.intensity,
        colorTempK: level.colorTempK,
        focusNote: level.focusNote
      })
    })
    return lines
  }

  const detail: SheetCueChange[] = []
  const missingCueNos: string[] = []

  sheet.cueLines.forEach((line) => {
    const current = currentById.get(line.cueId)
    if (!current) {
      missingCueNos.push(line.cueNo)
      return
    }

    const kinds: SheetCueChangeKind[] = []
    if (current.cueNo !== line.cueNo) kinds.push('cueNo')

    if (snapshotRank.get(line.cueId)! !== currentRank.get(line.cueId)!) kinds.push('order')

    if (
      current.fadeInSec !== line.fadeInSec ||
      current.fadeOutSec !== line.fadeOutSec ||
      current.holdSec !== line.holdSec
    ) {
      kinds.push('transition')
    }

    const snapshotChannels = [...line.channels].sort((a, b) => a.channel - b.channel)
    const currentChannelList = currentChannels(line.cueId)
    let levelsChanged = snapshotChannels.length !== currentChannelList.length
    if (!levelsChanged) {
      for (let index = 0; index < snapshotChannels.length; index += 1) {
        if (channelChanged(snapshotChannels[index], currentChannelList[index])) {
          levelsChanged = true
          break
        }
      }
    }
    if (levelsChanged) kinds.push('levels')

    if (kinds.length > 0) {
      detail.push({
        cueId: line.cueId,
        snapshotCueNo: line.cueNo,
        cueNo: current.cueNo,
        kinds
      })
    }
  })

  return {
    status: detail.length > 0 || missingCueNos.length > 0 ? 'stale' : 'up-to-date',
    changedCount: detail.length,
    changedCueNos: detail.map((item) => (item.cueNo !== item.snapshotCueNo ? `${item.snapshotCueNo}→${item.cueNo}` : item.cueNo)),
    changedCueIds: detail.map((item) => item.cueId),
    detail,
    missingCueNos
  }
}

/** 把变化类别拼成「编号 / 顺序 / 过渡 / 通道亮度色温」式摘要 */
export function formatChangeKinds(kinds: readonly SheetCueChangeKind[]): string {
  return kinds.map((kind) => CUE_CHANGE_LABELS[kind]).join('、')
}
