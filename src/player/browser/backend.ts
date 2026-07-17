import type { Config } from '../../config'
import type { QueueItem } from '../../music/types'
import { OverlayHub } from '../../overlay/hub'
import type {
  AudioDeviceInfo,
  PlaybackBackend,
  PlaybackDiagnostic,
  PlaybackEvent,
  PlaybackRuntimeState,
} from '../types'

export class BrowserPlaybackBackend implements PlaybackBackend {
  readonly kind = 'browser' as const
  private listeners = new Set<(event: PlaybackEvent) => void>()
  private releaseAvailability: () => void
  private releaseMedia: () => void
  private current?: QueueItem
  private loadTimer?: NodeJS.Timeout
  private volume: number

  constructor(private hub: OverlayHub, private config: Config) {
    this.volume = clampVolume(config.playbackVolume)
    this.releaseAvailability = hub.onAvailabilityChange(available => {
      this.emit({ type: 'available', available })
      this.emit({ type: 'runtime', state: this.getRuntimeState() })
    })
    this.releaseMedia = hub.onMedia(event => {
      const itemId = event.itemId || this.current?.id || ''
      if (event.type === 'loading' && this.current?.id === itemId) this.beginLoading(this.current)
      if (event.type === 'playing' && this.current?.id === itemId) {
        this.clearLoadTimer()
        this.emit({ type: 'playing', itemId })
      }
      if (event.type === 'ended') {
        this.clearLoadTimer()
        this.current = undefined
        this.emit({ type: 'ended', itemId })
      }
      if (event.type === 'progress' && Number.isFinite(event.position)) {
        this.emit({ type: 'progress', itemId, position: Math.max(0, Number(event.position)) })
      }
      if (event.type === 'error') {
        this.failTrack(itemId, event.message || '浏览器源播放失败')
      }
    })
  }

  async start(): Promise<void> {
    this.hub.setBackend('browser')
    this.emit({ type: 'available', available: this.isReady() })
    this.emit({ type: 'runtime', state: this.getRuntimeState() })
  }

  isReady(): boolean {
    return this.hub.hasPrimary()
  }

  async play(item: QueueItem): Promise<void> {
    this.current = item
    this.beginLoading(item)
    this.hub.play(item)
  }

  async pause(): Promise<void> {
    this.hub.pause()
    if (this.current) this.emit({ type: 'paused', itemId: this.current.id })
  }

  async resume(item: QueueItem): Promise<void> {
    this.current = item
    this.beginLoading(item)
    this.hub.resume(item)
  }

  async stop(): Promise<void> {
    this.clearLoadTimer()
    this.hub.stop()
    this.current = undefined
  }

  async setVolume(volume: number): Promise<number> {
    this.volume = this.hub.setVolume(volume)
    this.emit({ type: 'runtime', state: this.getRuntimeState() })
    return this.volume
  }

  subscribe(listener: (event: PlaybackEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getRuntimeState(): PlaybackRuntimeState {
    const ready = this.isReady()
    return {
      kind: this.kind,
      status: ready ? 'ready' : 'stopped',
      ready,
      detail: ready ? 'OBS 主播放器已连接' : '等待 mode=player 页面连接',
      error: null,
      volume: this.volume,
    }
  }

  async detect(): Promise<PlaybackDiagnostic> {
    const state = this.getRuntimeState()
    return { ok: state.ready, message: state.detail, state }
  }

  async restart(): Promise<boolean> {
    return this.isReady()
  }

  async listAudioDevices(): Promise<AudioDeviceInfo[]> {
    return []
  }

  async dispose(): Promise<void> {
    this.clearLoadTimer()
    this.releaseAvailability()
    this.releaseMedia()
    this.listeners.clear()
    this.current = undefined
  }

  private emit(event: PlaybackEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  private beginLoading(item: QueueItem): void {
    this.emit({ type: 'loading', itemId: item.id })
    if (this.loadTimer) return
    this.loadTimer = setTimeout(() => {
      if (this.current?.id !== item.id) return
      this.hub.stop()
      this.failTrack(item.id, `浏览器源在 ${this.config.playbackLoadTimeout} 秒内未开始播放`)
    }, this.config.playbackLoadTimeout * 1_000)
  }

  private failTrack(itemId: string, message: string): void {
    if (this.current?.id !== itemId) return
    this.clearLoadTimer()
    this.current = undefined
    this.emit({ type: 'error', scope: 'track', itemId, message })
  }

  private clearLoadTimer(): void {
    if (this.loadTimer) clearTimeout(this.loadTimer)
    this.loadTimer = undefined
  }
}

function clampVolume(value: number): number {
  return Math.round(Math.max(0, Math.min(100, Number.isFinite(value) ? value : 100)))
}
