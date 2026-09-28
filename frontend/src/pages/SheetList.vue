<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  NAlert,
  NButton,
  NCheckbox,
  NInput,
  NModal,
  NPopover,
  NSelect,
  NSwitch,
  NTag,
  useDialog,
  useMessage
} from 'naive-ui'
import BlankHint from '@/components/common/BlankHint.vue'
import { useCueStore } from '@/stores/cueStore'
import { useFixtureStore } from '@/stores/fixtureStore'
import { useLevelStore } from '@/stores/levelStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useSheetStore } from '@/stores/sheetStore'
import type { RehearsalSheet, SheetDiff } from '@/types/sheet'
import { buildSheetText, cueTotalSeconds, formatDateTime, formatSeconds } from '@/utils/fade'
import { buildSheetFilename, copyText, downloadTextFile } from '@/utils/export'
import { diffSheet, formatChangeKinds } from '@/utils/sheetDiff'

const router = useRouter()
const message = useMessage()
const dialog = useDialog()
const sessionStore = useSessionStore()
const cueStore = useCueStore()
const fixtureStore = useFixtureStore()
const levelStore = useLevelStore()
const sheetStore = useSheetStore()

const showAllSessions = ref(false)
const note = ref('')
const previewSheet = ref<RehearsalSheet | null>(null)

const selectedSessionId = computed(() => sessionStore.currentSessionId ?? '')

const sessionOptions = computed(() =>
  sessionStore.sortedSessions.map((session) => ({ label: `${session.order}. ${session.title}`, value: session.id }))
)

const cues = computed(() => (selectedSessionId.value ? cueStore.sortedCuesOfSession(selectedSessionId.value) : []))
const selectedCount = computed(() => cues.value.filter((cue) => cueStore.isSelected(cue.id)).length)

const sheets = computed(() =>
  showAllSessions.value ? sheetStore.sheetsSorted : sheetStore.sheetsOfSession(selectedSessionId.value)
)

/**
 * 每张历史排演表相对当前 Cue / 电平数据的落后情况。
 * store 中的 cues / levels / fixtures 变化时自动重算。
 */
const diffMap = computed<Record<string, SheetDiff>>(() => {
  const result: Record<string, SheetDiff> = {}
  sheetStore.sheetsSorted.forEach((sheet) => {
    result[sheet.id] = diffSheet(
      sheet,
      cueStore.cuesOfSession(sheet.sessionId),
      levelStore.levels,
      fixtureStore.fixturesOfSession(sheet.sessionId)
    )
  })
  return result
})

function diffOf(sheet: RehearsalSheet): SheetDiff {
  return diffMap.value[sheet.id] ?? {
    status: 'up-to-date',
    changedCount: 0,
    changedCueNos: [],
    changedCueIds: [],
    detail: [],
    missingCueNos: []
  }
}

/** 场次已删除时无法读取当前 Cue，也就无法比对与另存 */
function isSessionAlive(sheet: RehearsalSheet): boolean {
  return sessionStore.sessionById(sheet.sessionId) !== null
}

/** 原表中仍存在、可收录进新表的 Cue 数 */
function survivorCount(sheet: RehearsalSheet): number {
  const currentIds = new Set(cueStore.cuesOfSession(sheet.sessionId).map((cue) => cue.id))
  return sheet.cueLines.filter((line) => currentIds.has(line.cueId)).length
}

const previewText = computed(() => {
  if (!previewSheet.value) return ''
  return buildSheetText(previewSheet.value, sessionStore.sessionById(previewSheet.value.sessionId) ?? undefined)
})

function handleSessionChange(value: string | number | Array<string | number> | null): void {
  if (typeof value === 'string') sessionStore.setCurrentSession(value)
}

function handleShowAll(value: string | number | boolean): void {
  showAllSessions.value = value === true
}

function selectAll(): void {
  cueStore.setSelection(cues.value.map((cue) => cue.id))
}

function invertSelection(): void {
  cueStore.setSelection(cues.value.filter((cue) => !cueStore.isSelected(cue.id)).map((cue) => cue.id))
}

function clearSelection(): void {
  cueStore.clearSelection()
}

async function generateSheet(): Promise<void> {
  if (!selectedSessionId.value) {
    message.warning('请先选择场次')
    return
  }
  if (selectedCount.value === 0) {
    message.warning('请至少勾选一条 Cue')
    return
  }
  const created = await sheetStore.createSheet({
    sessionId: selectedSessionId.value,
    cueIds: cues.value.filter((cue) => cueStore.isSelected(cue.id)).map((cue) => cue.id),
    note: note.value.trim()
  })
  if (!created) {
    message.error('生成失败：勾选的 Cue 已不存在')
    return
  }
  message.success(`已生成 ${created.sheetNo}，包含 ${created.cueLines.length} 条 Cue`)
  note.value = ''
  cueStore.clearSelection()
}

function sheetTitle(sheet: RehearsalSheet): string {
  const session = sessionStore.sessionById(sheet.sessionId)
  return session ? `${session.order}. ${session.title}` : '（场次已删除）'
}

function cueNoSummary(sheet: RehearsalSheet): string {
  return sheet.cueLines.map((line) => line.cueNo).join('、')
}

function totalOf(sheet: RehearsalSheet): string {
  const total = sheet.cueLines.reduce(
    (sum, line) => sum + cueTotalSeconds({ fadeInSec: line.fadeInSec, holdSec: line.holdSec, fadeOutSec: line.fadeOutSec }),
    0
  )
  return formatSeconds(total)
}

async function handleCopy(sheet: RehearsalSheet): Promise<void> {
  const ok = await copyText(buildSheetText(sheet, sessionStore.sessionById(sheet.sessionId) ?? undefined))
  if (ok) message.success('排演表文本已复制到剪贴板')
  else message.error('复制失败，请改用下载')
}

function handleDownload(sheet: RehearsalSheet): void {
  downloadTextFile(buildSheetFilename(sheet.sheetNo, sheet.generatedAt), buildSheetText(sheet, sessionStore.sessionById(sheet.sessionId) ?? undefined))
  message.success('已导出纯文本排演表')
}

function confirmRemove(sheet: RehearsalSheet): void {
  dialog.warning({
    title: '删除排演表',
    content: `将删除 ${sheet.sheetNo}（生成于 ${formatDateTime(sheet.generatedAt)}），不影响场次与 Cue。`,
    positiveText: '确认删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await sheetStore.removeSheet(sheet.id)
      message.success('排演表已删除')
    }
  })
}

/** 按最新内容另存：原表不动，另建一张只收录仍在 Cue 的新表 */
async function refreshLatest(sheet: RehearsalSheet): Promise<void> {
  const created = await sheetStore.refreshSheet(sheet.id)
  if (!created) {
    message.warning('原表中的 Cue 已全部不存在，无法另存')
    return
  }
  const removedCount = created.removedCueNos.length
  message.success(
    `已另存为 ${created.sheetNo}，收录 ${created.cueLines.length} 条 Cue` +
      (removedCount > 0 ? `，另有 ${removedCount} 条原编号已不存在` : '')
  )
}

function goCues(): void {
  if (!selectedSessionId.value) {
    void router.push('/sessions')
    return
  }
  void router.push(`/sessions/${selectedSessionId.value}/cues`)
}

function goSessions(): void {
  void router.push('/sessions')
}
</script>

<template>
  <div class="page">
    <header class="page__header">
      <div>
        <h1 class="page__title">排演表生成与导出</h1>
        <p class="page__subtitle">
          勾选若干 Cue 组合成排演表并本地留存历史，可预览、复制或导出纯文本。
        </p>
      </div>
      <div class="page__actions">
        <NButton @click="goSessions">场次编排</NButton>
        <NButton @click="goCues">Cue 时间轴</NButton>
      </div>
    </header>

    <NAlert v-if="sessionStore.sortedSessions.length === 0" type="info" :bordered="false">
      还没有场次。请先在场次编排中创建场次并插入 Cue，再来生成排演表。
    </NAlert>

    <template v-else>
      <section class="panel">
        <h2 class="panel__title">选择 Cue<span class="panel__title-tag">勾选集合跨页保存在 cueStore</span></h2>

        <div class="sheet-toolbar">
          <NSelect
            :value="selectedSessionId || null"
            :options="sessionOptions"
            placeholder="选择场次"
            style="width: 260px"
            @update:value="handleSessionChange"
          />
          <NButton size="small" @click="selectAll">全选本场</NButton>
          <NButton size="small" @click="invertSelection">反选</NButton>
          <NButton size="small" quaternary @click="clearSelection">清空勾选</NButton>
          <span class="toolbar__spacer" />
          <NTag size="small" :bordered="false" type="warning">
            已勾选 {{ selectedCount }} / {{ cues.length }}
          </NTag>
        </div>

        <div v-if="cues.length === 0" class="sheet-empty">
          <BlankHint
            title="本场还没有 Cue"
            description="排演表由 Cue 组合而成。先到 Cue 编排时间轴插入提示点，再回来勾选生成。"
            action-text="去插入 Cue"
            @action="goCues"
          />
        </div>

        <div v-else class="cue-select-list">
          <label
            v-for="cue in cues"
            :key="cue.id"
            class="cue-select"
            :class="{ 'cue-select--checked': cueStore.isSelected(cue.id) }"
          >
            <NCheckbox :checked="cueStore.isSelected(cue.id)" @update:checked="() => cueStore.toggleSelected(cue.id)" />
            <span class="cue-select__no mono">{{ cue.cueNo }}</span>
            <span class="cue-select__label">{{ cue.label || '（未填写提示语）' }}</span>
            <NTag size="tiny" :bordered="false">{{ cue.trigger }}</NTag>
            <span class="cue-select__duration mono">{{ formatSeconds(cueTotalSeconds(cue)) }}</span>
          </label>
        </div>

        <div class="sheet-generate">
          <NInput v-model:value="note" placeholder="制表备注，例如「技术合成第 2 版」" style="max-width: 420px" />
          <NButton type="primary" :disabled="selectedCount === 0" @click="generateSheet">生成排演表</NButton>
        </div>
      </section>

      <section class="panel">
        <div class="sheet-history-head">
          <h2 class="panel__title">历史排演表<span class="panel__title-tag">共 {{ sheets.length }} 张</span></h2>
          <span class="sheet-history-head__switch">
            <span class="muted">显示全部场次</span>
            <NSwitch :value="showAllSessions" size="small" @update:value="(value) => handleShowAll(value)" />
          </span>
        </div>

        <BlankHint
          v-if="sheets.length === 0"
          title="还没有生成过排演表"
          description="勾选上半部分的 Cue 后点击「生成排演表」，历史记录会保存在浏览器本地。"
          tip="排演表以生成时的场次与电平快照留档，之后修改 Cue 不会影响历史。"
        />

        <div v-else class="sheet-list">
          <article v-for="sheet in sheets" :key="sheet.id" class="sheet-card">
            <div class="sheet-card__head">
              <span class="sheet-card__no mono">{{ sheet.sheetNo }}</span>
              <span class="sheet-card__session">{{ sheetTitle(sheet) }}</span>
              <span class="toolbar__spacer" />
              <span class="sheet-card__time mono">{{ formatDateTime(sheet.generatedAt) }}</span>
            </div>

            <p class="sheet-card__cues mono">{{ cueNoSummary(sheet) || '（空表）' }}</p>

            <div class="sheet-card__meta">
              <span>Cue {{ sheet.cueLines.length }} 条</span>
              <span>过渡合计 {{ totalOf(sheet) }}</span>
              <span v-if="sheet.note">备注：{{ sheet.note }}</span>
            </div>

            <div v-if="sheet.refreshedFromSheetNo" class="sheet-card__refresh">
              由 {{ sheet.refreshedFromSheetNo }} 按最新内容另存
              <template v-if="sheet.removedCueNos.length > 0">
                ｜原表中已不再存在 {{ sheet.removedCueNos.length }} 条：
                <span class="sheet-card__missing-nos mono">{{ sheet.removedCueNos.join('、') }}</span>
              </template>
            </div>

            <div v-if="isSessionAlive(sheet)" class="sheet-card__diff">
              <template v-if="diffOf(sheet).status === 'up-to-date'">
                <NTag size="small" type="success" :bordered="false">与最新内容一致</NTag>
              </template>
              <template v-else>
                <NPopover trigger="click" placement="bottom" :show-arrow="false">
                  <template #trigger>
                    <NTag size="small" type="warning" :bordered="false" class="sheet-card__diff-tag">
                      有 {{ diffOf(sheet).changedCount }} 条变化
                    </NTag>
                  </template>
                  <ul class="diff-pop">
                    <li v-for="item in diffOf(sheet).detail" :key="item.cueId" class="diff-pop__item">
                      <span class="mono diff-pop__no">
                        {{ item.snapshotCueNo }}<template v-if="item.cueNo !== item.snapshotCueNo"> → {{ item.cueNo }}</template>
                      </span>
                      <span class="diff-pop__kinds">{{ formatChangeKinds(item.kinds) }}</span>
                    </li>
                    <li v-if="diffOf(sheet).detail.length === 0" class="diff-pop__empty">无参数变化</li>
                  </ul>
                </NPopover>
                <NTag
                  v-if="diffOf(sheet).missingCueNos.length > 0"
                  size="small"
                  type="error"
                  :bordered="false"
                  :title="diffOf(sheet).missingCueNos.join('、')"
                >
                  {{ diffOf(sheet).missingCueNos.length }} 条已不存在
                </NTag>
                <span class="sheet-card__diff-nos mono">
                  <template v-if="diffOf(sheet).changedCueNos.length > 0">
                    变化：{{ diffOf(sheet).changedCueNos.join('、') }}
                  </template>
                  <template v-if="diffOf(sheet).missingCueNos.length > 0">
                    <template v-if="diffOf(sheet).changedCueNos.length > 0">；</template>
                    已不存在：{{ diffOf(sheet).missingCueNos.join('、') }}
                  </template>
                </span>
              </template>
            </div>
            <div v-else class="sheet-card__diff">
              <NTag size="small" type="default" :bordered="false">场次已删除，无法比对</NTag>
            </div>

            <div class="sheet-card__actions">
              <NButton size="tiny" @click="previewSheet = sheet">预览</NButton>
              <NButton
                v-if="isSessionAlive(sheet) && diffOf(sheet).status === 'stale'"
                size="tiny"
                type="primary"
                :disabled="survivorCount(sheet) === 0"
                @click="refreshLatest(sheet)"
              >
                按最新内容另存
              </NButton>
              <NButton size="tiny" quaternary @click="handleCopy(sheet)">复制文本</NButton>
              <NButton size="tiny" quaternary @click="handleDownload(sheet)">下载 .txt</NButton>
              <NButton size="tiny" quaternary type="error" @click="confirmRemove(sheet)">删除</NButton>
            </div>
          </article>
        </div>
      </section>
    </template>

    <NModal
      :show="previewSheet !== null"
      preset="card"
      :title="previewSheet ? `排演表预览 · ${previewSheet.sheetNo}` : '排演表预览'"
      class="preview-modal"
      @update:show="(value) => { if (!value) previewSheet = null }"
    >
      <pre class="preview-text">{{ previewText }}</pre>
      <template #footer>
        <div class="modal-footer">
          <NButton @click="previewSheet = null">关闭</NButton>
          <NButton v-if="previewSheet" quaternary @click="handleCopy(previewSheet)">复制文本</NButton>
          <NButton v-if="previewSheet" type="primary" @click="handleDownload(previewSheet)">下载 .txt</NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.sheet-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.sheet-empty {
  margin-top: 14px;
}

.cue-select-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 14px;
  max-height: 360px;
  overflow-y: auto;
  padding-right: 4px;
}

.cue-select {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  cursor: pointer;
  transition: border-color 0.16s ease, background 0.16s ease;
}

.cue-select:hover {
  background: rgba(255, 255, 255, 0.045);
}

.cue-select--checked {
  border-color: rgba(242, 181, 68, 0.55);
  background: rgba(242, 181, 68, 0.08);
}

.cue-select__no {
  font-weight: 600;
  color: #f2b544;
  min-width: 62px;
}

.cue-select__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.cue-select__duration {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
}

.sheet-generate {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
  flex-wrap: wrap;
}

.sheet-history-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.sheet-history-head__switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.sheet-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 12px;
}

.sheet-card {
  padding: 14px 16px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.07);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sheet-card__head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.sheet-card__no {
  font-weight: 600;
  color: #f2b544;
}

.sheet-card__session {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
}

.sheet-card__time {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
}

.sheet-card__cues {
  margin: 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
  line-height: 1.7;
  word-break: break-all;
}

.sheet-card__meta {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
}

.sheet-card__actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.sheet-card__refresh {
  font-size: 12px;
  color: rgba(78, 161, 242, 0.85);
  line-height: 1.6;
}

.sheet-card__missing-nos {
  color: rgba(255, 255, 255, 0.65);
}

.sheet-card__diff {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.sheet-card__diff-tag {
  cursor: pointer;
}

.sheet-card__diff-nos {
  font-size: 11px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.5);
  word-break: break-all;
}

.diff-pop {
  margin: 0;
  padding: 0;
  list-style: none;
  min-width: 220px;
  max-width: 320px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.diff-pop__item {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
}

.diff-pop__no {
  color: #f2b544;
  white-space: nowrap;
}

.diff-pop__kinds {
  color: rgba(255, 255, 255, 0.75);
  text-align: right;
}

.diff-pop__empty {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
}

.preview-modal {
  width: 720px;
  max-width: 94vw;
}

.preview-text {
  margin: 0;
  max-height: 60vh;
  overflow: auto;
  padding: 14px 16px;
  border-radius: 10px;
  background: #0b0d12;
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-family: 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.75;
  white-space: pre;
  color: rgba(255, 255, 255, 0.82);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
