<template>
  <k-layout main="bili-live-music-layout">
    <template #header>直播点歌</template>
    <el-scrollbar class="music-scrollbar">
      <main class="music-page">
    <header class="page-header">
      <div>
        <h1>直播点歌</h1>
        <p class="provider">{{ state.provider || '正在连接音乐服务' }}</p>
      </div>
      <div class="page-header-actions">
        <a class="nav-button" href="/bili-live-music/danmu-state-machine">弹幕状态机 ›</a>
        <div v-if="musicPageEnabled" class="status" :class="state.phase === 'loading' ? 'loading' : state.playing ? 'playing' : state.paused ? 'paused' : !state.playerReady ? 'disconnected' : 'idle'">
          <span class="status-dot"></span>
          {{ state.phase === 'loading' ? '正在加载' : state.playing ? '播放中' : state.paused ? '已暂停' : !state.playerReady ? '播放器未就绪' : '空闲' }}
        </div>
      </div>
    </header>

    <PageDisabled
      v-if="!musicPageEnabled"
      title="直播点歌管理页面已关闭"
      config-key="enableMusicManagementPage"
      target-label="前往弹幕状态机"
      target-path="/bili-live-music/danmu-state-machine"
    />

    <template v-else>
    <p v-if="notice" class="notice" :class="noticeType">{{ notice }}</p>

    <section class="section danmu-section">
      <div class="section-heading">
        <div>
          <span class="eyebrow">B 站弹幕监听</span>
          <h2 class="danmu-title"><span class="danmu-dot" :class="danmu.state"></span>{{ stateLabels[danmu.state] }}</h2>
          <p class="backend-detail">房间 {{ danmu.roomId || '未配置' }} · {{ identityLabel(danmu.identity) }}</p>
        </div>
        <button class="command-button" :disabled="danmuReconnecting" @click="reconnectDanmu">
          {{ danmuReconnecting ? '正在重连' : '↻ 立即重连' }}
        </button>
      </div>
      <dl class="danmu-meta">
        <div><dt>连接尝试</dt><dd>{{ danmu.attempt }} 次</dd></div>
        <div><dt>连续失败</dt><dd>{{ danmu.failureCount }} 次</dd></div>
        <div><dt>连接时间</dt><dd>{{ danmu.connectedAt ? formatDateTime(danmu.connectedAt) : '—' }}</dd></div>
        <div><dt>下次重试</dt><dd>{{ danmuRetryText }}</dd></div>
      </dl>
      <p v-if="danmu.lastError" class="backend-error">{{ danmu.lastError }}</p>
    </section>

    <section class="section backend-section">
      <div class="section-heading">
        <div>
          <span class="eyebrow">播放后端</span>
          <h2>{{ state.playback.kind === 'vlc' ? 'VLC 本地播放器' : 'OBS 浏览器播放器' }}</h2>
          <p class="backend-detail">{{ state.playback.detail }}</p>
        </div>
        <div v-if="state.playback.kind === 'vlc'" class="backend-actions">
          <button class="command-button" :disabled="busy.has('vlc-detect')" @click="detectVlc">⌕ 检测 VLC</button>
          <button class="command-button" :disabled="busy.has('vlc-devices') || !state.playerReady" @click="queryVlcDevices">♫ 查询音频设备</button>
          <button class="command-button danger" :disabled="busy.has('vlc-restart')" @click="restartVlc">↻ 重启 VLC</button>
        </div>
      </div>
      <p v-if="state.backendError" class="backend-error">{{ state.backendError }}</p>
      <div class="volume-control">
        <label for="playback-volume">🔊 播放音量</label>
        <input
          id="playback-volume"
          :value="volumeDraft"
          type="range"
          min="0"
          max="100"
          step="1"
          aria-label="播放音量"
          @input="onVolumeInput"
          @change="onVolumeChange"
        />
        <output for="playback-volume">{{ volumeDraft }}%</output>
      </div>
      <dl v-if="state.playback.kind === 'vlc'" class="backend-meta">
        <div><dt>运行状态</dt><dd>{{ playbackStatusLabel(state.playback.status) }}</dd></div>
        <div><dt>VLC 版本</dt><dd>{{ state.playback.version || '尚未检测' }}</dd></div>
        <div><dt>可执行文件</dt><dd>{{ state.playback.executable || 'vlc' }}</dd></div>
        <div><dt>音频设备</dt><dd>{{ state.playback.audioDevice || '系统默认' }}</dd></div>
      </dl>
      <div v-if="vlcDevices.length" class="device-list">
        <strong>VLC 音频设备</strong>
        <div v-for="device in vlcDevices" :key="device.id" class="device-row">
          <span>{{ device.name }}</span>
          <code>{{ device.id }}</code>
          <button class="icon-button" title="复制设备 ID" aria-label="复制设备 ID" @click="copyDeviceId(device.id)">⧉</button>
        </div>
      </div>
    </section>

    <section class="section current-section">
      <div class="section-heading">
        <div>
          <span class="eyebrow">当前播放</span>
          <h2>{{ displayedItem ? displayedItem.song.title : '暂无播放' }}</h2>
        </div>
        <div v-if="state.current || state.queue.length || state.lastFinished" class="playback-controls">
          <button class="icon-button" title="上一首" aria-label="上一首" :disabled="!state.history.length || busy.has('previous')" @click="previousTrack">⏮</button>
          <button class="icon-button primary-control" :title="playbackButtonLabel" :aria-label="playbackButtonLabel" :disabled="busy.has('toggle') || state.phase === 'loading' || (!state.current && !state.queue.length)" @click="togglePlayback">{{ state.phase === 'loading' ? '…' : !state.current || state.paused ? '▶' : '⏸' }}</button>
          <button class="icon-button danger" title="下一首" aria-label="下一首" :disabled="!state.current || busy.has('skip')" @click="skipCurrent">⏭</button>
        </div>
      </div>

      <div v-if="displayedItem" class="current-track-frame">
        <div class="current-track">
          <div class="current-cover-wrap">
            <img v-if="displayedItem.song.cover" :src="displayedItem.song.cover" alt="" class="cover large" />
            <div v-else class="cover large cover-fallback" aria-hidden="true">♫</div>
            <div v-if="state.current && state.phase === 'loading'" class="loading-mask">
              <span class="loading-spinner" aria-hidden="true"></span>
              <span>正在加载</span>
            </div>
          </div>
          <div class="track-details">
            <strong>{{ displayedItem.song.artist }}</strong>
            <span>{{ sourceLabel(displayedItem.song.source) }}<template v-if="displayedItem.song.album"> · {{ displayedItem.song.album }}</template></span>
            <span>{{ formatDuration(displayedItem.song.duration) }} · {{ displayedItem.song.quality || '自动音质' }}</span>
            <div class="track-progress-row">
              <div
                class="track-progress"
                role="progressbar"
                aria-label="歌曲播放进度"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-valuenow="progressPercent(displayedPosition, displayedItem.song.duration)"
              >
                <span :style="{ width: `${progressPercent(displayedPosition, displayedItem.song.duration)}%` }"></span>
              </div>
              <span class="track-time">{{ formatPosition(displayedPosition) }} / {{ formatPosition(displayedItem.song.duration) }}</span>
            </div>
            <span>点歌人：{{ displayedItem.requester.name }} · {{ originLabel(displayedItem.requester.origin) }}</span>
          </div>
        </div>
        <div v-if="!state.current && state.lastFinished" class="finished-mask" :class="state.lastFinished.reason">
          <strong>{{ finishTitle(state.lastFinished.reason) }}</strong>
          <span>{{ state.queue.length ? `等待队列 ${state.queue.length} 首` : '队列为空' }}</span>
        </div>
      </div>
      <div v-else class="empty-state">队列就绪</div>
    </section>

    <section class="section search-section">
      <div class="section-heading compact">
        <div>
          <span class="eyebrow">手动点歌</span>
          <h2>搜索歌曲</h2>
        </div>
        <span v-if="songs.length" class="count">{{ songs.length }} 条结果</span>
      </div>

      <form class="search-bar" @submit.prevent="searchSongs">
        <input v-model="keyword" type="search" placeholder="歌名、歌手或关键词" autocomplete="off" />
        <button class="command-button primary" type="submit" :disabled="searching || !keyword.trim()">
          <span aria-hidden="true">⌕</span>
          {{ searching ? '搜索中' : '搜索' }}
        </button>
      </form>
      <p class="search-retention">{{ searchRetentionText }}</p>

      <div v-if="songs.length" class="table-wrap search-results">
        <table>
          <thead>
            <tr>
              <th>歌曲</th>
              <th>来源</th>
              <th>时长</th>
              <th class="action-column">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(song, index) in songs" :key="`${song.source}:${song.id || song.mid || song.hash}:${index}`">
              <td>
                <div class="song-cell">
                  <img v-if="song.cover" :src="song.cover" alt="" class="cover" />
                  <div v-else class="cover cover-fallback" aria-hidden="true">♫</div>
                  <div>
                    <strong>{{ song.title }}</strong>
                    <span>{{ song.artist }}<template v-if="song.album"> · {{ song.album }}</template></span>
                  </div>
                </div>
              </td>
              <td><span class="source-badge" :class="song.source">{{ sourceLabel(song.source) }}</span></td>
              <td>{{ formatDuration(song.duration) }}</td>
              <td class="action-column">
                <button
                  class="icon-button add"
                  title="加入队列"
                  :aria-label="`将 ${song.title} 加入队列`"
                  :disabled="busy.has(`add:${index}`)"
                  @click="addSong(index)"
                >+</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else-if="searched && !searching" class="empty-state">没有找到匹配歌曲</div>
    </section>

    <section class="section queue-section">
      <div class="section-heading compact">
        <div>
          <span class="eyebrow">播放队列</span>
          <h2>等待中</h2>
        </div>
        <div class="queue-heading-actions">
          <span class="count">{{ state.queue.length }} 首</span>
          <button
            v-if="state.queue.length"
            class="command-button danger subtle"
            :disabled="busy.has('clear')"
            @click="clearQueue"
          >
            <span aria-hidden="true">✕</span>
            清空
          </button>
        </div>
      </div>

      <div v-if="state.queue.length" class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="position-column">#</th>
              <th>歌曲</th>
              <th>点歌人</th>
              <th>入口来源</th>
              <th>加入时间</th>
              <th class="queue-actions-column">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, index) in state.queue" :key="item.id">
              <td class="position-column">{{ index + 1 }}</td>
              <td>
                <div class="song-cell">
                  <img v-if="item.song.cover" :src="item.song.cover" alt="" class="cover" />
                  <div v-else class="cover cover-fallback" aria-hidden="true">♫</div>
                  <div>
                    <strong>{{ item.song.title }}</strong>
                    <span>{{ item.song.artist }} · {{ sourceLabel(item.song.source) }}</span>
                  </div>
                </div>
              </td>
              <td>{{ item.requester.name }}</td>
              <td><span class="origin-badge">{{ originLabel(item.requester.origin) }}</span></td>
              <td>{{ formatTime(item.createdAt) }}</td>
              <td class="queue-actions-column">
                <div class="row-actions">
                  <button class="icon-button" title="置顶" aria-label="置顶" :disabled="index === 0" @click="move(item.id, 'top')">⤒</button>
                  <button class="icon-button" title="上移" aria-label="上移" :disabled="index === 0" @click="move(item.id, 'up')">↑</button>
                  <button class="icon-button" title="下移" aria-label="下移" :disabled="index === state.queue.length - 1" @click="move(item.id, 'down')">↓</button>
                  <button class="icon-button danger" title="删除" aria-label="删除" @click="remove(item.id)">✕</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="empty-state">暂无等待歌曲</div>
    </section>
    </template>
      </main>
    </el-scrollbar>
  </k-layout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { send, store } from '@koishijs/client'
import PageDisabled from './components/page-disabled.vue'
import { fallbackDanmuState, identityLabel, stateLabels, type ConsoleFeatures, type DanmuReconnectResult, type DanmuRuntimeState, type DanmuStateTransition } from './types'

type MusicSource = 'netease' | 'tencent' | 'kugou'
type RequestOrigin = 'bilibili' | 'bot-group' | 'bot-private' | 'webui'
type MoveAction = 'top' | 'up' | 'down'
type PlaybackPhase = 'idle' | 'loading' | 'playing' | 'paused' | 'finished' | 'error'

interface Song {
  id?: string
  mid?: string
  hash?: string
  hqHash?: string
  sqHash?: string
  title: string
  artist: string
  album?: string
  duration: number
  cover?: string
  source: MusicSource
  quality?: string
}

interface QueueItem {
  id: string
  song: Song
  requester: { uid: string; name: string; origin: RequestOrigin }
  createdAt: number
}

interface QueueState {
  current: QueueItem | null
  lastFinished: LastFinishedTrack | null
  queue: QueueItem[]
  history: QueueItem[]
  phase: PlaybackPhase
  playing: boolean
  paused: boolean
  position: number
  provider: string
  fontUrl: string
  searchExpireMinutes: number
  playerReady: boolean
  backendError: string | null
  playback: PlaybackRuntime
  danmu: DanmuRuntimeState
  danmuHistory: DanmuStateTransition[]
  features: ConsoleFeatures
}

interface LastFinishedTrack {
  item: QueueItem
  reason: 'ended' | 'skipped' | 'error'
  position: number
  finishedAt: number
}

interface PlaybackRuntime {
  kind: 'browser' | 'vlc'
  status: 'starting' | 'ready' | 'restarting' | 'error' | 'stopped'
  ready: boolean
  detail: string
  error: string | null
  volume: number
  executable?: string
  version?: string
  audioDevice?: string
}

interface AudioDevice { id: string; name: string; active: boolean }

interface SearchResponse { searchId: string; songs: Song[] }

const rpc = send as (type: string, ...args: any[]) => Promise<any>
const fallbackState: QueueState = {
  current: null,
  lastFinished: null,
  queue: [],
  history: [],
  phase: 'idle',
  playing: false,
  paused: false,
  position: 0,
  provider: '',
  fontUrl: '',
  searchExpireMinutes: 30,
  playerReady: false,
  backendError: null,
  playback: { kind: 'browser', status: 'stopped', ready: false, detail: '正在连接播放器', error: null, volume: 100 },
  danmu: fallbackDanmuState,
  danmuHistory: [],
  features: { musicManagementPage: true, danmuStateMachinePage: false },
}
const state = computed(() => (store['bili-live-music'] as QueueState | undefined) || fallbackState)
const musicPageEnabled = computed(() => state.value.features?.musicManagementPage ?? true)
const searchExpireMinutes = computed(() => state.value.searchExpireMinutes ?? 30)
const searchRetentionText = computed(() => searchExpireMinutes.value <= 0
  ? '搜索结果在本次运行期间永不过期；插件重启或热重载后需要重新搜索'
  : `搜索结果保留 ${searchExpireMinutes.value} 分钟，超过后需要重新搜索`)
const danmu = computed(() => state.value.danmu || fallbackDanmuState)
const displayedItem = computed(() => state.value.current || state.value.lastFinished?.item || null)
const displayedPosition = computed(() => state.value.current ? state.value.position : state.value.lastFinished?.position || 0)
const playbackButtonLabel = computed(() => state.value.phase === 'loading' ? '正在加载' : !state.value.current ? '开始播放' : state.value.paused ? '继续播放' : '暂停')
const keyword = ref('')
const songs = ref<Song[]>([])
const searchId = ref('')
const searching = ref(false)
const searched = ref(false)
const notice = ref('')
const noticeType = ref<'success' | 'error'>('success')
const vlcDevices = ref<AudioDevice[]>([])
const volumeDraft = ref(100)
const busy = reactive(new Set<string>())
const now = ref(Date.now())
const clock = window.setInterval(() => { now.value = Date.now() }, 500)
onBeforeUnmount(() => window.clearInterval(clock))
const danmuReconnecting = computed(() => busy.has('danmu-reconnect') || danmu.value.state === 'starting' || danmu.value.state === 'reconnecting')
const danmuRetryText = computed(() => danmu.value.nextRetryAt
  ? `${Math.max(0, Math.ceil((danmu.value.nextRetryAt - now.value) / 1_000))} 秒后`
  : '—')
let noticeTimer: number | undefined
let loadedFontUrl = ''
let volumeTimer: number | undefined

watch(() => state.value.playback.volume, (volume) => {
  if (Number.isFinite(volume)) volumeDraft.value = Math.max(0, Math.min(100, Math.round(volume)))
}, { immediate: true })

watch(() => state.value.fontUrl, async (url) => {
  if (!url || url === loadedFontUrl || typeof FontFace === 'undefined') return
  try {
    const font = new FontFace('BiliLiveMusicLXGW', `url(${JSON.stringify(url)})`)
    await font.load()
    document.fonts.add(font)
    loadedFontUrl = url
  } catch {}
}, { immediate: true })

const sourceLabels: Record<MusicSource, string> = {
  netease: '网易云',
  tencent: 'QQ 音乐',
  kugou: '酷狗',
}

const originLabels: Record<RequestOrigin, string> = {
  bilibili: 'B站弹幕',
  'bot-group': 'Bot群聊',
  'bot-private': 'Bot私聊',
  webui: 'WebUI',
}

function sourceLabel(source: MusicSource) {
  return sourceLabels[source] || source
}

function originLabel(origin: RequestOrigin) {
  return originLabels[origin] || origin
}

function playbackStatusLabel(status: PlaybackRuntime['status']) {
  return ({ starting: '启动中', ready: '已就绪', restarting: '重启中', error: '故障', stopped: '已停止' })[status]
}

function finishTitle(reason: LastFinishedTrack['reason']) {
  return ({ ended: '已播放结束', skipped: '已跳过', error: '播放失败' })[reason]
}

function formatDuration(duration: number) {
  if (!duration) return '--:--'
  const total = Math.round(duration / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function formatPosition(duration: number) {
  const total = Math.max(0, Math.round((duration || 0) / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function progressPercent(position: number, duration: number) {
  if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return 0
  return Math.round(Math.max(0, Math.min(100, position / duration * 100)) * 10) / 10
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function formatDateTime(timestamp: number) {
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
}

function showNotice(message: string, type: 'success' | 'error' = 'success') {
  notice.value = message
  noticeType.value = type
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => { notice.value = '' }, 4000)
}

function onVolumeInput(event: Event) {
  volumeDraft.value = Number((event.target as HTMLInputElement).value)
  window.clearTimeout(volumeTimer)
  volumeTimer = window.setTimeout(() => void applyVolume(), 120)
}

function onVolumeChange() {
  window.clearTimeout(volumeTimer)
  void applyVolume()
}

async function applyVolume() {
  try {
    volumeDraft.value = await rpc('bili-live-music/set-volume', { volume: volumeDraft.value })
  } catch (error) {
    showNotice(`音量调整失败：${messageOf(error)}`, 'error')
  }
}

async function reconnectDanmu() {
  if (danmuReconnecting.value) return
  busy.add('danmu-reconnect')
  try {
    const result = await rpc('bili-live-music/danmu-reconnect') as DanmuReconnectResult
    if (result.ok) {
      showNotice(`弹幕重连成功，耗时 ${(result.elapsed / 1_000).toFixed(1)} 秒`)
    } else if (result.state.nextRetryAt) {
      showNotice(`弹幕重连失败，将在 ${Math.max(0, Math.ceil((result.state.nextRetryAt - Date.now()) / 1_000))} 秒后重试`, 'error')
    } else {
      showNotice(result.state.lastError || '当前配置无法重连', 'error')
    }
  } catch (error) {
    showNotice(`弹幕重连失败：${messageOf(error)}`, 'error')
  } finally {
    busy.delete('danmu-reconnect')
  }
}

async function searchSongs() {
  const value = keyword.value.trim()
  if (!value || searching.value) return
  searching.value = true
  searched.value = true
  try {
    const result = await rpc('bili-live-music/search', { keyword: value }) as SearchResponse
    searchId.value = result.searchId
    songs.value = result.songs
    if (!result.songs.length) showNotice('没有找到匹配歌曲', 'error')
  } catch (error) {
    songs.value = []
    showNotice(`搜索失败：${messageOf(error)}`, 'error')
  } finally {
    searching.value = false
  }
}

async function addSong(index: number) {
  const key = `add:${index}`
  busy.add(key)
  try {
    const result = await rpc('bili-live-music/add', { searchId: searchId.value, index })
    showNotice(result.startedPlaying ? '歌曲已开始播放' : `已加入队列第 ${result.queuePosition} 位`)
  } catch (error) {
    showNotice(`加入失败：${messageOf(error)}`, 'error')
  } finally {
    busy.delete(key)
  }
}

async function move(id: string, action: MoveAction) {
  try {
    await rpc('bili-live-music/move', { id, action })
  } catch (error) {
    showNotice(`调整失败：${messageOf(error)}`, 'error')
  }
}

async function remove(id: string) {
  try {
    await rpc('bili-live-music/remove', { id })
    showNotice('已从队列删除')
  } catch (error) {
    showNotice(`删除失败：${messageOf(error)}`, 'error')
  }
}

async function skipCurrent() {
  if (!window.confirm('跳过当前歌曲并播放下一首？')) return
  busy.add('skip')
  try {
    await rpc('bili-live-music/skip')
    showNotice('已跳过当前歌曲')
  } catch (error) {
    showNotice(`跳过失败：${messageOf(error)}`, 'error')
  } finally {
    busy.delete('skip')
  }
}

async function previousTrack() {
  busy.add('previous')
  try {
    const changed = await rpc('bili-live-music/previous')
    showNotice(changed ? '已切换到上一首' : '没有可播放的历史歌曲', changed ? 'success' : 'error')
  } catch (error) {
    showNotice(`上一首失败：${messageOf(error)}`, 'error')
  } finally {
    busy.delete('previous')
  }
}

async function togglePlayback() {
  busy.add('toggle')
  try {
    const action = !state.value.current
      ? 'bili-live-music/start'
      : state.value.paused
        ? 'bili-live-music/resume'
        : 'bili-live-music/pause'
    const changed = await rpc(action)
    if (!changed) {
      const message = !state.value.playerReady
        ? state.value.playback.detail
        : '当前播放状态无法执行此操作'
      showNotice(message, 'error')
    }
  } catch (error) {
    showNotice(`播放控制失败：${messageOf(error)}`, 'error')
  } finally {
    busy.delete('toggle')
  }
}

async function clearQueue() {
  if (!window.confirm('清空所有等待歌曲？当前播放不会受影响。')) return
  busy.add('clear')
  try {
    await rpc('bili-live-music/clear')
    showNotice('等待队列已清空')
  } catch (error) {
    showNotice(`清空失败：${messageOf(error)}`, 'error')
  } finally {
    busy.delete('clear')
  }
}

async function detectVlc() {
  busy.add('vlc-detect')
  try {
    const result = await rpc('bili-live-music/vlc-detect')
    showNotice(result.message, result.ok ? 'success' : 'error')
  } catch (error) {
    showNotice(`检测失败：${messageOf(error)}`, 'error')
  } finally {
    busy.delete('vlc-detect')
  }
}

async function queryVlcDevices() {
  busy.add('vlc-devices')
  try {
    vlcDevices.value = await rpc('bili-live-music/vlc-devices')
    showNotice(`查询到 ${vlcDevices.value.length} 个音频设备`)
  } catch (error) {
    showNotice(`设备查询失败：${messageOf(error)}`, 'error')
  } finally {
    busy.delete('vlc-devices')
  }
}

async function restartVlc() {
  if (!window.confirm('重启插件专属 VLC 进程？当前歌曲会从头播放。')) return
  busy.add('vlc-restart')
  try {
    const ready = await rpc('bili-live-music/vlc-restart')
    showNotice(ready ? 'VLC 已重启' : 'VLC 重启失败，请检查路径、端口和日志', ready ? 'success' : 'error')
  } catch (error) {
    showNotice(`VLC 重启失败：${messageOf(error)}`, 'error')
  } finally {
    busy.delete('vlc-restart')
  }
}

async function copyDeviceId(id: string) {
  try {
    await navigator.clipboard.writeText(id)
    showNotice('设备 ID 已复制')
  } catch {
    showNotice('浏览器不允许访问剪贴板', 'error')
  }
}

function messageOf(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.replace(/^Error:\s*/, '').split(/\r?\n/, 1)[0]
  return /unauthorized/i.test(normalized) ? '权限不足，需要 3 级权限' : normalized
}
</script>

<style scoped>
.music-page {
  --surface: var(--k-card-bg, #ffffff);
  --line: var(--k-color-divider, #dfe3e8);
  --text: var(--fg1, #20242a);
  --muted: var(--fg2, #68717d);
  --accent: #e84d87;
  --accent-strong: #c92f6b;
  --success: #16835b;
  --danger: #c43b46;
  box-sizing: border-box;
  width: 100%;
  min-height: 100%;
  color: var(--text);
  background: var(--k-main-bg, #f5f6f8);
  letter-spacing: 0;
  font-family: 'BiliLiveMusicLXGW', system-ui, sans-serif;
}

.music-scrollbar {
  width: 100%;
  height: 100%;
}

.page-header,
.section {
  padding: 24px clamp(18px, 4vw, 48px);
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
}
.page-header-actions { display: flex; align-items: center; gap: 16px; }
.nav-button { display: inline-flex; height: 34px; padding: 0 11px; align-items: center; border: 1px solid var(--line); border-radius: 6px; color: var(--text); background: var(--surface); cursor: pointer; font: inherit; text-decoration: none; }
.nav-button:hover { border-color: var(--accent); color: var(--accent-strong); }

h1, h2, p { margin: 0; }
h1 { font-size: 24px; line-height: 1.25; }
h2 { margin-top: 4px; font-size: 20px; line-height: 1.3; }
.provider, .song-cell span, .track-details span { color: var(--muted); }
.provider { margin-top: 6px; font-size: 13px; }

.status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 82px;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
}

.status-dot { width: 8px; height: 8px; border-radius: 50%; background: #8a929d; }
.status.playing .status-dot { background: var(--success); box-shadow: 0 0 0 4px rgba(22, 131, 91, .12); }
.status.loading .status-dot { background: var(--accent); animation: status-pulse 1s ease-in-out infinite; }
.status.paused .status-dot { background: #d18a16; box-shadow: 0 0 0 4px rgba(209, 138, 22, .12); }
.status.disconnected .status-dot { background: var(--danger); box-shadow: 0 0 0 4px rgba(193, 62, 62, .12); }
@keyframes status-pulse { 50% { opacity: .35; transform: scale(.75); } }

.notice {
  position: fixed;
  z-index: 20;
  top: 18px;
  left: 50%;
  transform: translateX(-50%);
  max-width: min(520px, calc(100vw - 32px));
  padding: 10px 16px;
  border-radius: 6px;
  color: #fff;
  box-shadow: 0 8px 24px rgba(0, 0, 0, .18);
}
.notice.success { background: var(--success); }
.notice.error { background: var(--danger); }

.section { background: var(--surface); border-bottom: 1px solid var(--line); }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
.section-heading.compact { margin-bottom: 18px; }
.eyebrow { color: var(--accent-strong); font-size: 12px; font-weight: 700; }
.count { color: var(--muted); font-size: 13px; white-space: nowrap; }

.backend-detail { margin-top: 6px; color: var(--muted); font-size: 13px; }
.danmu-title { display: flex; align-items: center; gap: 9px; }
.danmu-dot { width: 9px; height: 9px; border-radius: 50%; background: #8a929d; }
.danmu-dot.connected { background: var(--success); box-shadow: 0 0 0 4px rgba(22, 131, 91, .12); }
.danmu-dot.starting, .danmu-dot.reconnecting { background: #d18a16; animation: status-pulse 1s ease-in-out infinite; }
.danmu-dot.waiting { background: #d18a16; }
.danmu-meta { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 18px 0 0; }
.danmu-meta dt { color: var(--muted); font-size: 12px; }
.danmu-meta dd { margin: 4px 0 0; overflow-wrap: anywhere; font-size: 13px; }
.backend-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.backend-error { margin-top: 14px; padding: 10px 12px; border-left: 3px solid var(--danger); color: var(--danger); background: rgba(196, 59, 70, .08); }
.volume-control { display: grid; width: min(100%, 520px); grid-template-columns: auto minmax(140px, 1fr) 48px; align-items: center; gap: 12px; margin-top: 18px; }
.volume-control label { font-size: 13px; font-weight: 700; }
.volume-control input { width: 100%; accent-color: var(--accent-strong); cursor: pointer; }
.volume-control output { color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; text-align: right; }
.backend-meta { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 18px 0 0; }
.backend-meta div { min-width: 0; }
.backend-meta dt { color: var(--muted); font-size: 12px; }
.backend-meta dd { margin: 4px 0 0; overflow-wrap: anywhere; font-size: 13px; }
.device-list { display: grid; gap: 8px; margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--line); }
.device-row { display: grid; grid-template-columns: minmax(120px, 1fr) minmax(160px, 2fr) 32px; align-items: center; gap: 10px; }
.device-row code { min-width: 0; overflow: hidden; color: var(--muted); text-overflow: ellipsis; white-space: nowrap; }

.current-track-frame { position: relative; max-width: 830px; margin-top: 20px; overflow: hidden; border-radius: 6px; }
.current-track { display: flex; align-items: center; gap: 18px; min-height: 92px; }
.current-cover-wrap { position: relative; width: 92px; height: 92px; flex: 0 0 auto; overflow: hidden; border-radius: 4px; }
.loading-mask { position: absolute; z-index: 1; inset: 0; display: grid; place-content: center; justify-items: center; gap: 7px; color: #fff; background: rgba(24, 27, 33, .58); font-size: 11px; font-weight: 700; animation: loading-reveal .2s ease .3s both; }
.loading-spinner { width: 24px; height: 24px; box-sizing: border-box; border: 3px solid rgba(255, 255, 255, .3); border-top-color: #ff8eb4; border-radius: 50%; animation: loading-spin .8s linear infinite; }
@keyframes loading-spin { to { transform: rotate(360deg); } }
@keyframes loading-reveal { from { opacity: 0; } to { opacity: 1; } }
.track-details { display: grid; flex: 1; gap: 5px; min-width: 0; max-width: 720px; }
.track-details strong { font-size: 17px; }
.track-progress-row { display: grid; grid-template-columns: minmax(120px, 1fr) auto; align-items: center; gap: 10px; margin: 2px 0; }
.track-progress { width: 100%; height: 6px; overflow: hidden; border-radius: 3px; background: var(--line); }
.track-progress > span { display: block; width: 0; height: 100%; border-radius: inherit; background: var(--accent-strong); transition: width .25s linear; }
.track-time { white-space: nowrap; font-variant-numeric: tabular-nums; }
.finished-mask { position: absolute; z-index: 2; inset: 0; display: grid; place-content: center; gap: 4px; color: #fff; background: rgba(24, 27, 33, .62); text-align: center; }
.finished-mask strong { font-size: 18px; }
.finished-mask span { color: rgba(255, 255, 255, .82); font-size: 13px; }
.finished-mask.ended strong { color: #f7b2ca; }
.finished-mask.skipped strong { color: #f5ce7a; }
.finished-mask.error { background: rgba(91, 20, 28, .68); }
.finished-mask.error strong { color: #ffd7dc; }

.cover { width: 42px; height: 42px; flex: 0 0 auto; object-fit: cover; border-radius: 4px; background: #eceff2; }
.cover.large { width: 92px; height: 92px; }
.cover-fallback { display: grid; place-items: center; color: #818a96; font-size: 22px; }

.search-bar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; max-width: 780px; }
.search-bar input {
  min-width: 0;
  height: 40px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--text);
  background: var(--bg1, #fff);
  outline: none;
}
.search-bar input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(232, 77, 135, .12); }
.search-retention { margin-top: 8px; color: var(--muted); font-size: 12px; }

button { font: inherit; letter-spacing: 0; }
.command-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 38px;
  padding: 0 14px;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--text);
  background: var(--surface);
  cursor: pointer;
}
.command-button.primary { color: #fff; border-color: var(--accent-strong); background: var(--accent-strong); }
.command-button.danger { color: var(--danger); border-color: rgba(196, 59, 70, .35); }
.command-button.subtle { height: 34px; }
.command-button:disabled, .icon-button:disabled { cursor: not-allowed; opacity: .42; }

.table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 6px; }
.search-results { margin-top: 18px; }
table { width: 100%; border-collapse: collapse; table-layout: auto; }
th, td { padding: 11px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: middle; white-space: nowrap; }
th { color: var(--muted); background: var(--bg1, rgba(127, 137, 149, .07)); font-size: 12px; font-weight: 700; }
td { font-size: 13px; }
tbody tr:last-child td { border-bottom: 0; }
.song-cell { display: flex; align-items: center; gap: 10px; min-width: 250px; }
.song-cell > div:last-child { display: grid; gap: 4px; min-width: 0; }
.song-cell strong, .song-cell span { max-width: 360px; overflow: hidden; text-overflow: ellipsis; }

.source-badge, .origin-badge {
  display: inline-block;
  padding: 3px 7px;
  border-radius: 4px;
  color: #3d4651;
  background: #edf0f3;
  font-size: 12px;
}
.source-badge.netease { color: #b4232d; background: #fdebed; }
.source-badge.tencent { color: #156846; background: #e6f5ee; }
.source-badge.kugou { color: #305c9b; background: #eaf1fb; }

.action-column { width: 66px; text-align: right; }
.queue-actions-column { width: 168px; text-align: right; }
.position-column { width: 42px; text-align: center; }
.row-actions { display: flex; justify-content: flex-end; gap: 5px; }
.playback-controls { display: flex; gap: 7px; }
.icon-button {
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 5px;
  color: var(--text);
  background: var(--surface);
  cursor: pointer;
}
.icon-button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent-strong); }
.icon-button.primary-control { color: #fff; border-color: var(--accent-strong); background: var(--accent-strong); }
.icon-button.add { color: #fff; border-color: var(--success); background: var(--success); font-size: 20px; }
.icon-button.danger { color: var(--danger); }
.queue-heading-actions { display: flex; align-items: center; gap: 12px; }
.empty-state { padding: 28px 0 8px; color: var(--muted); text-align: center; }

@media (max-width: 720px) {
  .page-header, .section { padding: 18px 14px; }
  .page-header { align-items: flex-start; }
  .page-header-actions { align-items: flex-end; flex-direction: column-reverse; }
  h1 { font-size: 21px; }
  h2 { font-size: 18px; }
  .section-heading { align-items: flex-start; }
  .backend-section .section-heading { display: grid; }
  .backend-actions { justify-content: flex-start; }
  .backend-meta { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .danmu-meta { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .device-row { grid-template-columns: minmax(0, 1fr) 32px; }
  .device-row code { grid-column: 1 / -1; grid-row: 2; }
  .current-track { align-items: flex-start; }
  .cover.large { width: 72px; height: 72px; }
  .current-cover-wrap { width: 72px; height: 72px; }
  .volume-control { grid-template-columns: auto minmax(100px, 1fr) 44px; }
  .search-bar { grid-template-columns: 1fr; }
  .command-button.primary { width: 100%; }
  .table-wrap { margin-left: -14px; margin-right: -14px; border-left: 0; border-right: 0; border-radius: 0; }
  .song-cell { min-width: 210px; }
  .queue-actions-column { min-width: 168px; }
}
</style>
