<template>
  <k-layout main="bili-live-music-state-machine-layout">
    <template #header>弹幕状态机</template>
    <el-scrollbar class="state-scrollbar">
      <main class="state-page">
        <header class="page-header">
          <div>
            <span class="eyebrow">BILIBILI DANMU</span>
            <h1>弹幕状态机</h1>
          </div>
          <a class="nav-button" href="/bili-live-music">‹ 返回直播点歌</a>
        </header>

        <PageDisabled
          v-if="!graphPageEnabled"
          title="弹幕状态机页面已关闭"
          config-key="enableDanmuStateMachinePage"
          target-label="返回直播点歌"
          target-path="/bili-live-music"
        />

        <template v-else>
          <section class="summary-band">
            <div class="state-summary">
              <span class="state-dot" :class="runtime.state"></span>
              <div><span>当前状态</span><strong>{{ stateLabels[runtime.state] }}</strong></div>
            </div>
            <dl>
              <div><dt>房间号</dt><dd>{{ runtime.roomId || '未配置' }}</dd></div>
              <div><dt>连接身份</dt><dd>{{ identityLabel(runtime.identity) }}</dd></div>
              <div><dt>连续失败</dt><dd>{{ runtime.failureCount }} 次</dd></div>
              <div><dt>下次重试</dt><dd>{{ retryText }}</dd></div>
            </dl>
            <button class="reconnect-button" type="button" :disabled="reconnecting" @click="reconnect">
              {{ reconnecting ? '正在重连' : '立即重连' }}
            </button>
          </section>

          <p v-if="notice" class="notice" :class="noticeType">{{ notice }}</p>
          <p v-if="runtime.lastError" class="error-line">{{ runtime.lastError }}</p>

          <section class="graph-section">
            <div class="section-heading">
              <div><span class="eyebrow">STATE GRAPH</span><h2>连接状态流转</h2></div>
              <span>第 {{ runtime.generation }} 代连接</span>
            </div>
            <div ref="graphScroll" class="graph-scroll">
              <div class="state-graph" role="img" aria-label="B站弹幕连接状态机">
                <svg viewBox="0 0 800 400" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                  <defs>
                    <marker id="danmu-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" /></marker>
                    <marker id="danmu-arrow-active" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" /></marker>
                  </defs>
                  <path data-from="disabled" data-to="starting" :class="edgeClass('disabled', 'starting')" d="M 160 75 L 216 75" />
                  <path data-from="stopped" data-to="starting" :class="edgeClass('stopped', 'starting')" d="M 160 307 C 176 240, 194 154, 216 92" />
                  <path data-from="starting" data-to="connected" :class="edgeClass('starting', 'connected')" d="M 344 75 L 472 75" />
                  <path data-from="starting" data-to="waiting" :class="edgeClass('starting', 'waiting')" d="M 344 100 C 400 128, 452 206, 500 272" />
                  <path data-from="connected" data-to="waiting" :class="edgeClass('connected', 'waiting')" d="M 536 110 L 536 272" />
                  <path data-from="waiting" data-to="reconnecting" :class="edgeClass('waiting', 'reconnecting')" d="M 472 307 L 344 307" />
                  <path data-from="reconnecting" data-to="connected" :class="edgeClass('reconnecting', 'connected')" d="M 280 342 C 330 388, 680 388, 680 205 C 680 120, 646 75, 600 75" />
                  <path data-from="reconnecting" data-to="waiting" :class="edgeClass('reconnecting', 'waiting')" d="M 344 330 C 388 370, 447 370, 488 342" />
                </svg>
                <div v-for="node in nodes" :key="node.state" class="state-node" :class="[node.state, { active: runtime.state === node.state }]" :style="node.style">
                  <span></span><strong>{{ node.label }}</strong><small>{{ node.state }}</small>
                </div>
              </div>
            </div>
          </section>

          <section class="history-section">
            <div class="section-heading"><div><span class="eyebrow">RECENT TRANSITIONS</span><h2>最近状态转换</h2></div><span>{{ history.length }} 条</span></div>
            <div v-if="history.length" class="history-list">
              <div v-for="item in [...history].reverse()" :key="item.id" class="history-row">
                <time>{{ formatTime(item.at) }}</time>
                <code>{{ item.from }} → {{ item.to }}</code>
                <span>{{ item.reason }}</span>
              </div>
            </div>
            <div v-else class="empty-state">暂无状态转换记录</div>
          </section>
        </template>
      </main>
    </el-scrollbar>
  </k-layout>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { send, store } from '@koishijs/client'
import PageDisabled from './components/page-disabled.vue'
import { fallbackDanmuState, identityLabel, stateLabels, type ConsoleFeatures, type DanmuReconnectResult, type DanmuRuntimeState, type DanmuStateTransition, type DanmuConnectionState } from './types'

interface StateMachineStore {
  danmu: DanmuRuntimeState
  danmuHistory: DanmuStateTransition[]
  features: ConsoleFeatures
}

const fallbackState: StateMachineStore = {
  danmu: fallbackDanmuState,
  danmuHistory: [],
  features: { musicManagementPage: true, danmuStateMachinePage: false },
}
const rpc = send as (type: string, ...args: any[]) => Promise<any>
const state = computed(() => (store['bili-live-music'] as StateMachineStore | undefined) || fallbackState)
const graphPageEnabled = computed(() => state.value.features?.danmuStateMachinePage ?? false)
const runtime = computed(() => state.value.danmu || fallbackDanmuState)
const history = computed(() => state.value.danmuHistory || [])
const reconnecting = ref(false)
const graphScroll = ref<HTMLElement>()
const notice = ref('')
const noticeType = ref<'success' | 'error'>('success')
const now = ref(Date.now())
const clock = window.setInterval(() => { now.value = Date.now() }, 500)
onBeforeUnmount(() => window.clearInterval(clock))
onMounted(() => void centerActiveNode())
watch(() => runtime.value.state, () => void centerActiveNode())

const retryText = computed(() => runtime.value.nextRetryAt
  ? `${Math.max(0, Math.ceil((runtime.value.nextRetryAt - now.value) / 1_000))} 秒后`
  : '—')
const latest = computed(() => history.value.at(-1))
const nodes: Array<{ state: DanmuConnectionState; label: string; style: Record<string, string> }> = [
  { state: 'disabled', label: '已禁用', style: { left: '32px', top: '40px' } },
  { state: 'starting', label: '正在启动', style: { left: '216px', top: '40px' } },
  { state: 'connected', label: '监听中', style: { left: '472px', top: '40px' } },
  { state: 'waiting', label: '等待重试', style: { left: '472px', top: '272px' } },
  { state: 'reconnecting', label: '正在重连', style: { left: '216px', top: '272px' } },
  { state: 'stopped', label: '已停止', style: { left: '32px', top: '272px' } },
]

function edgeClass(from: DanmuConnectionState, to: DanmuConnectionState) {
  return { edge: true, active: latest.value?.from === from && latest.value?.to === to }
}

async function centerActiveNode() {
  await nextTick()
  const container = graphScroll.value
  const active = container?.querySelector<HTMLElement>('.state-node.active')
  if (!container || !active) return
  const left = active.offsetLeft - (container.clientWidth - active.offsetWidth) / 2
  container.scrollTo({ left: Math.max(0, left), behavior: 'smooth' })
}

async function reconnect() {
  reconnecting.value = true
  notice.value = ''
  try {
    const result = await rpc('bili-live-music/danmu-reconnect') as DanmuReconnectResult
    notice.value = result.ok
      ? `重连成功，耗时 ${(result.elapsed / 1_000).toFixed(1)} 秒`
      : result.state.nextRetryAt
        ? `重连失败，将在 ${Math.max(0, Math.ceil((result.state.nextRetryAt - Date.now()) / 1_000))} 秒后重试`
        : result.state.lastError || '当前配置无法重连'
    noticeType.value = result.ok ? 'success' : 'error'
  } catch (error) {
    notice.value = `重连失败：${messageOf(error)}`
    noticeType.value = 'error'
  } finally {
    reconnecting.value = false
  }
}

function formatTime(value: number) {
  return new Date(value).toLocaleTimeString('zh-CN', { hour12: false })
}

function messageOf(error: unknown) {
  const normalized = (error instanceof Error ? error.message : String(error)).replace(/^Error:\s*/, '').split(/\r?\n/, 1)[0]
  return /unauthorized/i.test(normalized) ? '权限不足，需要 3 级权限' : normalized
}
</script>

<style scoped>
.state-page { --surface: var(--k-card-bg, #fff); --line: var(--k-color-divider, #dfe3e8); --text: var(--fg1, #20242a); --muted: var(--fg2, #68717d); --accent: #c92f6b; --success: #16835b; box-sizing: border-box; min-height: 100%; color: var(--text); background: var(--k-main-bg, #f5f6f8); font-family: system-ui, sans-serif; letter-spacing: 0; }
.state-scrollbar { width: 100%; height: 100%; }
.page-header, .summary-band, .graph-section, .history-section { padding: 24px clamp(18px, 4vw, 48px); }
.page-header { display: flex; align-items: center; justify-content: space-between; gap: 18px; border-bottom: 1px solid var(--line); background: var(--surface); }
h1, h2, p { margin: 0; } h1 { margin-top: 3px; font-size: 24px; } h2 { margin-top: 3px; font-size: 19px; }
.eyebrow { color: var(--accent); font-size: 11px; font-weight: 800; }
.nav-button, .reconnect-button { display: inline-flex; height: 38px; padding: 0 14px; align-items: center; border: 1px solid var(--line); border-radius: 6px; color: var(--text); background: var(--surface); cursor: pointer; font: inherit; text-decoration: none; }
.nav-button:hover { border-color: #e84d87; color: var(--accent); }
.summary-band { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 28px; border-bottom: 1px solid var(--line); background: var(--surface); }
.state-summary { display: flex; align-items: center; gap: 12px; min-width: 150px; }.state-summary div { display: grid; gap: 3px; }.state-summary span:not(.state-dot) { color: var(--muted); font-size: 11px; }.state-summary strong { font-size: 18px; }
.state-dot { width: 12px; height: 12px; border-radius: 50%; background: #8a929d; }.state-dot.connected { background: var(--success); box-shadow: 0 0 0 5px rgba(22, 131, 91, .13); }.state-dot.starting, .state-dot.reconnecting { background: #d58616; animation: pulse 1s ease-in-out infinite; }.state-dot.waiting { background: #d58616; }.state-dot.disabled, .state-dot.stopped { background: #8a929d; }
@keyframes pulse { 50% { opacity: .4; transform: scale(.75); } }
.summary-band dl { display: grid; grid-template-columns: repeat(4, minmax(90px, 1fr)); gap: 18px; margin: 0; }.summary-band dl div { min-width: 0; }.summary-band dt { color: var(--muted); font-size: 11px; }.summary-band dd { margin: 4px 0 0; overflow-wrap: anywhere; font-size: 13px; font-weight: 700; }
.reconnect-button { color: #fff; border-color: var(--accent); background: var(--accent); }.reconnect-button:disabled { cursor: wait; opacity: .55; }
.notice, .error-line { margin: 16px clamp(18px, 4vw, 48px) 0; padding: 10px 12px; border-left: 3px solid var(--success); background: rgba(22, 131, 91, .08); font-size: 13px; }.notice.error, .error-line { border-color: #c43b46; color: #b8323d; background: rgba(196, 59, 70, .08); }
.graph-section, .history-section { border-bottom: 1px solid var(--line); background: var(--surface); }.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 18px; }.section-heading > span { color: var(--muted); font-size: 12px; }
.graph-scroll { overflow-x: auto; }.state-graph { position: relative; width: 800px; min-width: 800px; height: 400px; margin: 0 auto; border: 1px solid var(--line); border-radius: 6px; background: var(--k-main-bg, #f7f8fa); }
.state-graph svg { position: absolute; inset: 0; width: 800px; height: 400px; }.edge { fill: none; stroke: #a9b0ba; stroke-width: 2; marker-end: url(#danmu-arrow); }.edge.active { stroke: #e84d87; stroke-width: 4; marker-end: url(#danmu-arrow-active); }.state-graph #danmu-arrow path { fill: #a9b0ba; }.state-graph #danmu-arrow-active path { fill: #e84d87; }
.state-node { position: absolute; display: grid; width: 128px; height: 70px; box-sizing: border-box; place-content: center; justify-items: center; gap: 2px; border: 1px solid #cbd1d8; border-radius: 6px; background: var(--surface); box-shadow: 0 4px 12px rgba(0, 0, 0, .05); }.state-node > span { width: 8px; height: 8px; border-radius: 50%; background: #8a929d; }.state-node strong { font-size: 14px; }.state-node small { color: var(--muted); font-family: ui-monospace, monospace; font-size: 10px; }.state-node.active { border-color: #e84d87; box-shadow: 0 0 0 3px rgba(232, 77, 135, .14); }.state-node.active > span { background: #e84d87; animation: pulse 1s ease-in-out infinite; }.state-node.connected.active { border-color: var(--success); box-shadow: 0 0 0 3px rgba(22, 131, 91, .13); }.state-node.connected.active > span { background: var(--success); }
.history-list { border-top: 1px solid var(--line); }.history-row { display: grid; grid-template-columns: 90px minmax(210px, 270px) minmax(0, 1fr); gap: 14px; padding: 11px 0; border-bottom: 1px solid var(--line); align-items: center; font-size: 12px; }.history-row time, .history-row span { color: var(--muted); }.history-row code { color: var(--accent); }.empty-state { padding: 28px; color: var(--muted); text-align: center; }
@media (max-width: 760px) { .page-header, .summary-band, .graph-section, .history-section { padding: 18px 14px; }.summary-band { grid-template-columns: 1fr; gap: 18px; }.summary-band dl { grid-template-columns: repeat(2, minmax(0, 1fr)); }.reconnect-button { width: 100%; }.history-row { grid-template-columns: 72px minmax(170px, 1fr); }.history-row span { grid-column: 1 / -1; }.page-header { align-items: flex-start; }.nav-button { padding: 0 10px; } }
</style>
