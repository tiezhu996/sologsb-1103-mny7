import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { RehearsalSheet, SheetChannelLine, SheetCueLine, SheetDraft } from '@/types/sheet'
import { db } from '@/utils/db'
import { createId } from '@/utils/id'
import { sortFixturesByChannel } from '@/utils/patch'
import { useCueStore } from '@/stores/cueStore'
import { useFixtureStore } from '@/stores/fixtureStore'
import { useLevelStore } from '@/stores/levelStore'

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 以生成日期 + 序号拼排演表编号 */
function buildSheetNo(sequence: number, generatedAt: Date): string {
  return `RS-${generatedAt.getFullYear()}${pad(generatedAt.getMonth() + 1)}${pad(generatedAt.getDate())}-${pad(sequence)}`
}

/**
 * 排演表仓库：勾选 Cue 生成条目快照并本地留存历史。
 * 快照生成后不再随 Cue 修改而变化；新旧差异由 utils/sheetDiff 即时比对得出。
 */
export const useSheetStore = defineStore('sheet', () => {
  const sheets = ref<RehearsalSheet[]>([])
  const hydrated = ref(false)

  const sheetsSorted = computed(() =>
    [...sheets.value].sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())
  )

  function sheetsOfSession(sessionId: string): RehearsalSheet[] {
    return sheetsSorted.value.filter((sheet) => sheet.sessionId === sessionId)
  }

  function sheetById(id: string): RehearsalSheet | null {
    return sheets.value.find((sheet) => sheet.id === id) ?? null
  }

  /** 下一张排演表在当天内的序号 */
  function nextSequence(generatedAt: Date): number {
    const prefix = `RS-${generatedAt.getFullYear()}${pad(generatedAt.getMonth() + 1)}${pad(generatedAt.getDate())}-`
    const used = sheets.value
      .filter((sheet) => sheet.sheetNo.startsWith(prefix))
      .map((sheet) => Number.parseInt(sheet.sheetNo.slice(prefix.length), 10))
      .filter((value) => Number.isFinite(value))
    return used.length === 0 ? 1 : Math.max(...used) + 1
  }

  async function hydrate(): Promise<void> {
    sheets.value = await db.sheets.toArray()
    hydrated.value = true
  }

  /** 按当前 Cue / 通道电平数据组装一组 Cue 的条目快照 */
  function buildCueLines(sessionId: string, cues: { id: string }[]): SheetCueLine[] {
    const cueStore = useCueStore()
    const levelStore = useLevelStore()
    const fixtureStore = useFixtureStore()

    const wantedIds = new Set(cues.map((cue) => cue.id))
    const ordered = cueStore.sortedCuesOfSession(sessionId).filter((cue) => wantedIds.has(cue.id))

    return ordered.map((cue) => {
      const channels: SheetChannelLine[] = sortFixturesByChannel(fixtureStore.fixturesOfSession(sessionId))
        .map((fixture) => {
          const level = levelStore.levelOf(cue.id, fixture.id)
          if (!level) return null
          return {
            channel: fixture.channel,
            position: fixture.position,
            fixtureType: fixture.fixtureType,
            gel: fixture.gel,
            intensity: level.intensity,
            colorTempK: level.colorTempK,
            focusNote: level.focusNote
          }
        })
        .filter((line): line is SheetChannelLine => line !== null)

      return {
        cueId: cue.id,
        cueNo: cue.cueNo,
        label: cue.label,
        trigger: cue.trigger,
        fadeInSec: cue.fadeInSec,
        fadeOutSec: cue.fadeOutSec,
        holdSec: cue.holdSec,
        note: cue.note,
        channels
      }
    })
  }

  /** 落库一张新排演表（不修改任何既有表） */
  async function persistSheet(input: {
    sessionId: string
    note: string
    cueLines: SheetCueLine[]
    removedCueNos: string[]
    refreshedFromSheetNo: string | null
  }): Promise<RehearsalSheet> {
    const generatedAt = new Date()
    const created: RehearsalSheet = {
      id: createId('sheet'),
      sessionId: input.sessionId,
      sheetNo: buildSheetNo(nextSequence(generatedAt), generatedAt),
      generatedAt: generatedAt.toISOString(),
      includedCueIds: input.cueLines.map((line) => line.cueId),
      note: input.note,
      cueLines: input.cueLines,
      removedCueNos: input.removedCueNos,
      refreshedFromSheetNo: input.refreshedFromSheetNo
    }
    await db.sheets.put(created)
    sheets.value = [...sheets.value, created]
    return created
  }

  /** 依据勾选的 Cue 组装条目快照并落库 */
  async function createSheet(draft: SheetDraft): Promise<RehearsalSheet | null> {
    const cueStore = useCueStore()
    const wanted = cueStore
      .sortedCuesOfSession(draft.sessionId)
      .filter((cue) => draft.cueIds.includes(cue.id))
    if (wanted.length === 0) return null

    const cueLines = buildCueLines(
      draft.sessionId,
      wanted.map((cue) => ({ id: cue.id }))
    )
    if (cueLines.length === 0) return null

    return persistSheet({
      sessionId: draft.sessionId,
      note: draft.note,
      cueLines,
      removedCueNos: [],
      refreshedFromSheetNo: null
    })
  }

  /**
   * 按最新内容另存：原表保持生成时内容不变，新表只收录原表里仍在的 Cue，
   * 已不再存在的编号单独列入 removedCueNos。
   * 返回 null 表示原表 Cue 已全部不存在，无法另存。
   */
  async function refreshSheet(sourceId: string, note?: string): Promise<RehearsalSheet | null> {
    const source = sheetById(sourceId)
    if (!source) return null
    const cueStore = useCueStore()
    const currentCueIds = new Set(cueStore.cuesOfSession(source.sessionId).map((cue) => cue.id))

    const removedCueNos = source.cueLines.filter((line) => !currentCueIds.has(line.cueId)).map((line) => line.cueNo)
    const survivorIds = source.cueLines.filter((line) => currentCueIds.has(line.cueId)).map((line) => line.cueId)
    if (survivorIds.length === 0) return null

    const cueLines = buildCueLines(source.sessionId, survivorIds.map((id) => ({ id })))
    return persistSheet({
      sessionId: source.sessionId,
      note: note ?? `由 ${source.sheetNo} 按最新内容另存`,
      cueLines,
      removedCueNos,
      refreshedFromSheetNo: source.sheetNo
    })
  }

  async function removeSheet(id: string): Promise<void> {
    const target = sheetById(id)
    if (!target) return
    await db.sheets.delete(id)
    sheets.value = sheets.value.filter((sheet) => sheet.id !== id)
  }

  async function removeBySession(sessionId: string): Promise<void> {
    const targets = sheetsOfSession(sessionId)
    if (targets.length === 0) return
    await db.sheets.bulkDelete(targets.map((sheet) => sheet.id))
    sheets.value = sheets.value.filter((sheet) => sheet.sessionId !== sessionId)
  }

  return {
    sheets,
    hydrated,
    sheetsSorted,
    sheetsOfSession,
    sheetById,
    hydrate,
    createSheet,
    refreshSheet,
    removeSheet,
    removeBySession
  }
})
