import assert from 'node:assert/strict'
import { normalizeConfig, type Config } from '../src/config'
import type { QueueItem, Song } from '../src/music/types'
import type { PlaybackBackend, PlaybackEvent, PlaybackRuntimeState } from '../src/player/types'
import { QueueManager } from '../src/queue/manager'
import { OverlayHub } from '../src/overlay/hub'
import { BrowserPlaybackBackend } from '../src/player/browser/backend'
import type { OverlaySocket } from '../src/overlay/protocol'
import { acquireObsServerLease } from '../src/server/lease'
import { LuoyueMusicProvider } from '../src/music/luoyue'
import { NeteaseMusicProvider } from '../src/music/netease'
import { parseAudioDevices, parseRcNumber, parseRcState, volumePercentToVlc } from '../src/player/vlc/protocol'

class TestPlayer implements PlaybackBackend {
  readonly kind = 'browser' as const
  ready = true
  confirmImmediately = true
  volume = 100
  actions: string[] = []
  listeners = new Set<(event: PlaybackEvent) => void>()

  async start() {}
  isReady() { return this.ready }
  async play(item: QueueItem) {
    this.actions.push(`play:${item.song.title}`)
    this.emit({ type: 'loading', itemId: item.id })
    if (this.confirmImmediately) this.emit({ type: 'playing', itemId: item.id })
  }
  async pause() { this.actions.push('pause') }
  async resume(item: QueueItem) {
    this.actions.push(`resume:${item.song.title}`)
    this.emit({ type: 'playing', itemId: item.id })
  }
  async stop() { this.actions.push('stop') }
  async setVolume(volume: number) { this.volume = volume; return volume }
  subscribe(listener: (event: PlaybackEvent) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  getRuntimeState(): PlaybackRuntimeState { return { kind: 'browser', status: this.ready ? 'ready' : 'stopped', ready: this.ready, detail: 'test', error: null, volume: this.volume } }
  async detect() { return { ok: this.ready, message: 'test', state: this.getRuntimeState() } }
  async restart() { return this.ready }
  async listAudioDevices() { return [] }
  async dispose() { this.listeners.clear() }
  emit(event: PlaybackEvent) { for (const listener of this.listeners) listener(event) }
}

class TestSocket implements OverlaySocket {
  messages: any[] = []
  private closeListeners: Array<() => void> = []

  send(data: string) { this.messages.push(JSON.parse(data)) }
  close() { for (const listener of this.closeListeners) listener() }
  addEventListener(_type: 'close', listener: () => void) { this.closeListeners.push(listener) }
}

const config = {
  maxQueueSize: 30,
  perUserLimit: 30,
  cooldown: 0,
  maxDuration: 600_000,
  historyLimit: 2,
} as Config

async function main() {
  assert.equal(normalizeConfig({}).webuiSearchExpireMinutes, 30)
  assert.equal(normalizeConfig({ webuiSearchExpireMinutes: 0 }).webuiSearchExpireMinutes, 0)
  assert.equal(normalizeConfig({ webuiSearchExpireMinutes: -1 }).webuiSearchExpireMinutes, -1)

  const requester = { uid: 'tester', name: 'Tester', origin: 'webui' as const }
  const song = (title: string): Song => ({ title, artist: 'Artist', duration: 180_000, url: `https://example.com/${title}.mp3`, source: 'netease' })
  const player = new TestPlayer()
  const queue = new QueueManager(config, player)

  queue.add(song('A'), requester, 'A', { bypassUserLimits: true })
  queue.add(song('B'), requester, 'B', { bypassUserLimits: true })
  assert.equal(queue.getState().current?.song.title, 'A')
  assert.deepEqual(queue.getState().queue.map(item => item.song.title), ['B'])

  assert.equal(await queue.pause(), true)
  assert.equal(queue.getState().paused, true)
  assert.equal(queue.getState().playing, false)
  assert.equal(await queue.resume(), true)
  assert.equal(queue.getState().playing, true)

  await queue.skip()
  assert.equal(queue.getState().current?.song.title, 'B')
  assert.deepEqual(queue.getState().history.map(item => item.song.title), ['A'])

  assert.equal(await queue.previous(), true)
  assert.equal(queue.getState().current?.song.title, 'A')
  assert.deepEqual(queue.getState().queue.map(item => item.song.title), ['B'])

  await queue.skip()
  await queue.skip()
  queue.add(song('C'), requester, 'C', { bypassUserLimits: true })
  await queue.skip()
  assert.deepEqual(queue.getState().history.map(item => item.song.title), ['B', 'C'])

  const finishPlayer = new TestPlayer()
  const finishQueue = new QueueManager(config, finishPlayer)
  const natural = finishQueue.add(song('Natural End'), requester, 'Natural End', { bypassUserLimits: true })
  finishQueue.handleProgress(natural.id, 90_000)
  await finishQueue.handleEnded()
  assert.equal(finishQueue.getState().current, null)
  assert.equal(finishQueue.getState().lastFinished?.reason, 'ended')
  assert.equal(finishQueue.getState().lastFinished?.position, 180_000)
  assert.equal(await finishQueue.previous(), true)
  assert.equal(finishQueue.getState().current?.song.title, 'Natural End')
  assert.equal(finishQueue.getState().lastFinished, null)
  finishQueue.handleProgress(natural.id, 45_000)
  await finishQueue.skip()
  assert.equal(finishQueue.getState().lastFinished?.reason, 'skipped')
  assert.equal(finishQueue.getState().lastFinished?.position, 45_000)
  const failed = finishQueue.add(song('Failed'), requester, 'Failed', { bypassUserLimits: true })
  finishQueue.handleProgress(failed.id, 12_000)
  finishPlayer.emit({ type: 'error', scope: 'track', itemId: failed.id, message: 'decode failed' })
  assert.equal(finishQueue.getState().lastFinished?.reason, 'error')
  assert.equal(finishQueue.getState().lastFinished?.position, 12_000)

  const loadingPlayer = new TestPlayer()
  loadingPlayer.confirmImmediately = false
  const loadingQueue = new QueueManager(config, loadingPlayer)
  const loadingItem = loadingQueue.add(song('Slow Start'), requester, 'Slow Start', { bypassUserLimits: true })
  assert.equal(loadingQueue.getState().phase, 'loading')
  assert.equal(loadingQueue.getState().playing, false)
  loadingPlayer.emit({ type: 'playing', itemId: loadingItem.id })
  assert.equal(loadingQueue.getState().phase, 'playing')
  assert.equal(loadingQueue.getState().playing, true)

  const waitingPlayer = new TestPlayer()
  waitingPlayer.ready = false
  const waitingQueue = new QueueManager(config, waitingPlayer)
  waitingQueue.add(song('Waiting'), requester, 'Waiting', { bypassUserLimits: true })
  assert.equal(waitingQueue.getState().current, null)
  assert.equal(waitingQueue.getState().queue.length, 1)
  assert.equal(await waitingQueue.start(), false)
  waitingPlayer.ready = true
  assert.equal(await waitingQueue.start(), true)
  assert.equal(waitingQueue.getState().current?.song.title, 'Waiting')
  assert.deepEqual(waitingPlayer.actions, ['play:Waiting'])

  waitingPlayer.emit({ type: 'error', scope: 'backend', message: 'RC disconnected' })
  assert.equal(waitingQueue.getState().current?.song.title, 'Waiting')
  assert.equal(waitingQueue.getState().backendError, 'RC disconnected')
  assert.equal(waitingQueue.getState().playing, false)
  waitingPlayer.emit({ type: 'available', available: true })
  await Promise.resolve()
  assert.equal(waitingQueue.getState().backendError, null)

  const hub = new OverlayHub('browser')
  const browser = new BrowserPlaybackBackend(hub, { ...config, playbackVolume: 100, playbackLoadTimeout: 25 } as Config)
  const availability: boolean[] = []
  browser.subscribe(event => {
    if (event.type === 'available') availability.push(event.available)
  })
  const persistentPlayer = new TestSocket()
  const previewPlayer = new TestSocket()
  const display = new TestSocket()
  hub.addSocket(persistentPlayer, 'player')
  hub.addSocket(display, 'display')
  const switchingItem: QueueItem = {
    id: 'switching-loading-track',
    song: song('Switching Loading Track'),
    requester,
    keyword: 'switch',
    createdAt: Date.now(),
  }
  hub.publish({
    current: switchingItem,
    lastFinished: null,
    queue: [],
    history: [],
    phase: 'loading',
    playing: false,
    paused: false,
    position: 0,
    backendError: null,
  })
  hub.addSocket(previewPlayer, 'player')
  assert.equal(previewPlayer.messages.some(message => message.type === 'play' && message.item.id === switchingItem.id), true)
  previewPlayer.close()
  assert.equal([...persistentPlayer.messages].reverse().find(message => message.type === 'role')?.role, 'player')
  assert.equal(persistentPlayer.messages.some(message => message.type === 'play' && message.item.id === switchingItem.id), true)
  persistentPlayer.close()
  assert.equal(display.messages.some(message => message.role === 'player'), false)
  assert.equal(availability.at(-1), false)

  const volumeHub = new OverlayHub('browser', 80)
  const volumeSocket = new TestSocket()
  volumeHub.addSocket(volumeSocket, 'player')
  const volumeBrowser = new BrowserPlaybackBackend(volumeHub, { ...config, playbackVolume: 80, playbackLoadTimeout: 0.01 } as Config)
  assert.equal(await volumeBrowser.setVolume(140), 100)
  assert.equal(volumeBrowser.getRuntimeState().volume, 100)
  assert.equal(volumeSocket.messages.some(message => message.type === 'volume' && message.volume === 100), true)
  const timeoutEvents: PlaybackEvent[] = []
  volumeBrowser.subscribe(event => timeoutEvents.push(event))
  await volumeBrowser.play({
    id: 'slow-browser-track',
    song: song('Slow Browser Track'),
    requester,
    keyword: 'slow',
    createdAt: Date.now(),
  })
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(timeoutEvents.some(event => event.type === 'loading'), true)
  assert.equal(timeoutEvents.some(event => event.type === 'error' && event.scope === 'track'), true)
  await volumeBrowser.dispose()

  const vlcHub = new OverlayHub('vlc')
  const vlcDisplay = new TestSocket()
  const controls: string[] = []
  vlcHub.onControl(control => controls.push(control))
  vlcHub.addSocket(vlcDisplay, 'display')
  vlcHub.receive(vlcDisplay, { type: 'pause' })
  assert.equal(vlcDisplay.messages.some(message => message.role === 'vlc'), true)
  assert.deepEqual(controls, ['pause'])

  assert.equal(parseRcNumber('> get_time\r\n42\r\n> '), 42)
  assert.equal(parseRcState('( state playing )'), 'playing')
  assert.equal(volumePercentToVlc(100), 256)
  assert.equal(volumePercentToVlc(200), 256)
  assert.deepEqual(parseAudioDevices('| mmdevice - Windows default *\r\n> ', 'mmdevice'), [
    { id: 'mmdevice', name: 'Windows default', active: true },
  ])

  const detailCover = 'https://p1.music.126.net/rGRfS1wSBcQcrN2F7bY4tw==/109951168067420441.jpg?param=300y300'
  const neteaseRequests: string[] = []
  const neteaseProvider = new NeteaseMusicProvider({
    searchLimit: 3,
    neteaseDirectApi: 'api.qijieya.cn',
  } as Config, {
    async get(url: string) {
      neteaseRequests.push(url)
      if (url.includes('/api/song/detail/')) {
        return {
          data: {
            code: 200,
            songs: [{
              id: 1999253939,
              album: { picUrl: detailCover.replace('?param=300y300', '') },
            }],
          },
        }
      }
      return {
        data: {
          code: 200,
          result: {
            songs: [{
              id: 1999253939,
              name: 'ハナタバ',
              duration: 150085,
              artists: [{ name: 'MIMI' }, { name: '可不' }],
              album: { name: 'ハナタバ', picId: 109951168067420441 },
            }],
          },
        },
      }
    },
  } as any)
  const neteaseSongs = await neteaseProvider.search('mimi', 1)
  assert.equal(neteaseSongs[0].cover, detailCover)
  assert.equal(neteaseRequests.length, 2)

  const cooldownPlayer = new TestPlayer()
  cooldownPlayer.ready = false
  const cooldownQueue = new QueueManager({ ...config, cooldown: 25 } as Config, cooldownPlayer)
  cooldownQueue.add(song('Anonymous A'), { uid: '0', name: 'Alice', origin: 'bilibili' }, 'A')
  cooldownQueue.add(song('Anonymous B'), { uid: '0', name: 'Bob', origin: 'bilibili' }, 'B')
  assert.throws(
    () => cooldownQueue.add(song('Anonymous A2'), { uid: '0', name: 'Alice', origin: 'bilibili' }, 'A2'),
    /请 25 秒后再试/,
  )

  const releaseFirstLease = await acquireObsServerLease('127.0.0.1', 60716)
  let secondLeaseAcquired = false
  const secondLeaseTask = acquireObsServerLease('127.0.0.1', 60716).then((release) => {
    secondLeaseAcquired = true
    return release
  })
  await Promise.resolve()
  assert.equal(secondLeaseAcquired, false)
  releaseFirstLease()
  const releaseSecondLease = await secondLeaseTask
  assert.equal(secondLeaseAcquired, true)
  releaseSecondLease()

  const requestUrls: string[] = []
  const logger = Object.assign(
    () => ({ info() {}, warn() {} }),
    { info() {}, warn() {} },
  )
  const http = {
    async get(url: string) {
      requestUrls.push(url)
      if (url.includes('word=')) {
        return {
          data: {
            code: 200,
            data: [{
              hash: 'BASE_HASH',
              hq_hash: 'HQ_HASH',
              sq_hash: 'SQ_HASH',
              song: 'Kugou Song',
              singer: 'Kugou Artist',
              album_id: 'ALBUM',
              album_audio_id: 'AUDIO',
              interval: '3分59秒',
            }],
          },
        }
      }
      return {
        data: {
          code: 200,
          data: { url: 'https://example.com/correct.mp3' },
        },
      }
    },
  }
  const luoyueConfig = {
    apiBaseUrl: 'http://example.test',
    enabledSources: ['kugou'],
    webuiSearchLimit: 20,
    searchLimit: 3,
    kugouQuality: '320',
    verboseConsoleLog: false,
  } as Config
  const provider = new LuoyueMusicProvider({ logger } as any, luoyueConfig, http as any)
  const candidates = await provider.search('kugou', 1)
  assert.equal(candidates[0].hqHash, 'HQ_HASH')
  await provider.resolve(candidates[0])
  const detailUrl = new URL(requestUrls.at(-1)!)
  assert.equal(detailUrl.searchParams.get('hash'), 'HQ_HASH')
  assert.equal(detailUrl.searchParams.has('album_audio_id'), false)

  const fallbackUrls: string[] = []
  const fallbackHttp = {
    async get(url: string) {
      fallbackUrls.push(url)
      const hash = new URL(url).searchParams.get('hash')
      return {
        data: {
          code: 200,
          data: hash === 'HQ_HASH'
            ? { quality: '320' }
            : { url: 'https://example.com/fallback.mp3' },
        },
      }
    },
  }
  const fallbackProvider = new LuoyueMusicProvider({ logger } as any, luoyueConfig, fallbackHttp as any)
  const fallbackSong = await fallbackProvider.resolve(candidates[0])
  assert.equal(fallbackSong?.url, 'https://example.com/fallback.mp3')
  assert.equal(fallbackUrls.length, 2)
  assert.equal(new URL(fallbackUrls[0]).searchParams.get('hash'), 'HQ_HASH')
  assert.equal(new URL(fallbackUrls[1]).searchParams.get('hash'), 'BASE_HASH')
  assert.equal(new URL(fallbackUrls[1]).searchParams.has('album_audio_id'), false)

  console.log('queue-manager controls: ok')
}

void main()
