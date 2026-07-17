import assert from 'node:assert/strict'
import type { Config } from '../src/config'
import type { PlayerState, QueueItem, Song } from '../src/music/types'
import type { PlayerAdapter } from '../src/player/types'
import { QueueManager } from '../src/queue/manager'
import { BrowserPlayerAdapter, type BrowserSocket } from '../src/player/browser'
import { acquireObsServerLease } from '../src/server/lease'
import { LuoyueMusicProvider } from '../src/music/luoyue'

class TestPlayer implements PlayerAdapter {
  ready = true
  state?: PlayerState
  actions: string[] = []

  isReady() { return this.ready }
  async play(item: QueueItem) { this.actions.push(`play:${item.song.title}`) }
  async pause() { this.actions.push('pause') }
  async resume(item: QueueItem) { this.actions.push(`resume:${item.song.title}`) }
  async stop() { this.actions.push('stop') }
  broadcast(state: PlayerState) { this.state = state }
  onAvailabilityChange() { return () => {} }
  dispose() {}
}

class TestSocket implements BrowserSocket {
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

  const browser = new BrowserPlayerAdapter()
  const availability: boolean[] = []
  browser.onAvailabilityChange(value => availability.push(value))
  const persistentPlayer = new TestSocket()
  const previewPlayer = new TestSocket()
  const display = new TestSocket()
  browser.addSocket(persistentPlayer, 'player')
  browser.addSocket(display, 'display')
  browser.addSocket(previewPlayer, 'player')
  previewPlayer.close()
  assert.equal(persistentPlayer.messages.at(-2)?.role || persistentPlayer.messages.at(-1)?.role, 'player')
  persistentPlayer.close()
  assert.equal(display.messages.some(message => message.role === 'player'), false)
  assert.equal(availability.at(-1), false)

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
