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
      <div class="status" :class="state.playing ? 'playing' : state.paused ? 'paused' : !state.playerReady ? 'disconnected' : 'idle'">
        <span class="status-dot"></span>
        {{ state.playing ? '播放中' : state.paused ? '已暂停' : !state.playerReady ? '播放器未连接' : '空闲' }}
      </div>
    </header>

    <p v-if="notice" class="notice" :class="noticeType">{{ notice }}</p>

    <section class="section current-section">
      <div class="section-heading">
        <div>
          <span class="eyebrow">当前播放</span>
          <h2>{{ state.current ? state.current.song.title : '暂无播放' }}</h2>
        </div>
        <div v-if="state.current || state.queue.length" class="playback-controls">
          <button class="icon-button" title="上一首" aria-label="上一首" :disabled="!state.history.length || busy.has('previous')" @click="previousTrack">⏮</button>
          <button class="icon-button primary-control" :title="playbackButtonLabel" :aria-label="playbackButtonLabel" :disabled="busy.has('toggle')" @click="togglePlayback">{{ !state.current || state.paused ? '▶' : '⏸' }}</button>
          <button class="icon-button danger" title="下一首" aria-label="下一首" :disabled="!state.current || busy.has('skip')" @click="skipCurrent">⏭</button>
        </div>
      </div>

      <div v-if="state.current" class="current-track">
        <img v-if="state.current.song.cover" :src="state.current.song.cover" alt="" class="cover large" />
        <div v-else class="cover large cover-fallback" aria-hidden="true">♫</div>
        <div class="track-details">
          <strong>{{ state.current.song.artist }}</strong>
          <span>{{ sourceLabel(state.current.song.source) }}<template v-if="state.current.song.album"> · {{ state.current.song.album }}</template></span>
          <span>{{ formatDuration(state.current.song.duration) }} · {{ state.current.song.quality || '自动音质' }}</span>
          <span>{{ formatPosition(state.position) }} / {{ formatPosition(state.current.song.duration) }}</span>
          <span>点歌人：{{ state.current.requester.name }} · {{ originLabel(state.current.requester.origin) }}</span>
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
      </main>
    </el-scrollbar>
  </k-layout>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { send, store } from '@koishijs/client'

type MusicSource = 'netease' | 'tencent' | 'kugou'
type RequestOrigin = 'bilibili' | 'bot-group' | 'bot-private' | 'webui'
type MoveAction = 'top' | 'up' | 'down'

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
  queue: QueueItem[]
  history: QueueItem[]
  playing: boolean
  paused: boolean
  position: number
  provider: string
  fontUrl: string
  playerReady: boolean
}

interface SearchResponse { searchId: string; songs: Song[] }

const rpc = send as (type: string, ...args: any[]) => Promise<any>
const fallbackState: QueueState = { current: null, queue: [], history: [], playing: false, paused: false, position: 0, provider: '', fontUrl: '', playerReady: false }
const state = computed(() => (store['bili-live-music'] as QueueState | undefined) || fallbackState)
const playbackButtonLabel = computed(() => !state.value.current ? '开始播放' : state.value.paused ? '继续播放' : '暂停')
const keyword = ref('')
const songs = ref<Song[]>([])
const searchId = ref('')
const searching = ref(false)
const searched = ref(false)
const notice = ref('')
const noticeType = ref<'success' | 'error'>('success')
const busy = reactive(new Set<string>())
let noticeTimer: number | undefined
let loadedFontUrl = ''

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

function formatDuration(duration: number) {
  if (!duration) return '--:--'
  const total = Math.round(duration / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function formatPosition(duration: number) {
  const total = Math.max(0, Math.round((duration || 0) / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function showNotice(message: string, type: 'success' | 'error' = 'success') {
  notice.value = message
  noticeType.value = type
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => { notice.value = '' }, 4000)
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
        ? 'OBS 主播放器未连接，请先打开 mode=player 页面'
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

function messageOf(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error:\s*/, '').split(/\r?\n/, 1)[0]
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
.status.paused .status-dot { background: #d18a16; box-shadow: 0 0 0 4px rgba(209, 138, 22, .12); }
.status.disconnected .status-dot { background: var(--danger); box-shadow: 0 0 0 4px rgba(193, 62, 62, .12); }

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

.current-track { display: flex; align-items: center; gap: 18px; margin-top: 20px; }
.track-details { display: grid; gap: 5px; min-width: 0; }
.track-details strong { font-size: 17px; }

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
  h1 { font-size: 21px; }
  h2 { font-size: 18px; }
  .section-heading { align-items: flex-start; }
  .current-track { align-items: flex-start; }
  .cover.large { width: 72px; height: 72px; }
  .search-bar { grid-template-columns: 1fr; }
  .command-button.primary { width: 100%; }
  .table-wrap { margin-left: -14px; margin-right: -14px; border-left: 0; border-right: 0; border-radius: 0; }
  .song-cell { min-width: 210px; }
  .queue-actions-column { min-width: 168px; }
}
</style>
