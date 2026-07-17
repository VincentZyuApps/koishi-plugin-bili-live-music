import type { Config } from '../config'
import type { PlaybackBackend, PlaybackEvent } from '../player/types'
import type { LastFinishedTrack, LiveUser, PlaybackFinishReason, PlaybackPhase, PlayerState, QueueItem, Song } from '../music/types'

export interface QueueAddOptions {
  bypassUserLimits?: boolean
}

export type QueueMoveAction = 'top' | 'up' | 'down'

export class QueueManager {
  private queue: QueueItem[] = []
  private history: QueueItem[] = []
  private current: QueueItem | null = null
  private lastFinished: LastFinishedTrack | null = null
  private lastRequestAt = new Map<string, number>()
  private phase: PlaybackPhase = 'idle'
  private playing = false
  private paused = false
  private position = 0
  private backendError: string | null = null
  private listeners = new Set<(state: PlayerState) => void>()
  private releasePlayer: () => void

  constructor(private config: Config, private player: PlaybackBackend) {
    this.releasePlayer = player.subscribe(event => this.handlePlaybackEvent(event))
  }

  getState(): PlayerState {
    return {
      current: this.current,
      lastFinished: this.lastFinished,
      queue: [...this.queue],
      history: [...this.history],
      phase: this.phase,
      playing: this.playing,
      paused: this.paused,
      position: this.position,
      backendError: this.backendError,
    }
  }

  isPlayerReady(): boolean {
    return this.player.isReady()
  }

  add(song: Song, requester: LiveUser, keyword: string, options: QueueAddOptions = {}): QueueItem {
    const now = Date.now()
    if (this.queue.length >= this.config.maxQueueSize) {
      throw new Error('队列已满')
    }
    if (!options.bypassUserLimits) {
      const requesterKey = this.getRequesterKey(requester)
      const last = this.lastRequestAt.get(requesterKey) ?? 0
      const cooldownMs = this.config.cooldown * 1_000
      if (now - last < cooldownMs) {
        const remaining = Math.ceil((cooldownMs - (now - last)) / 1_000)
        throw new Error(`点歌过快，请 ${remaining} 秒后再试`)
      }
      const userQueued = this.queue.filter(item => this.getRequesterKey(item.requester) === requesterKey).length
      if (this.current && this.getRequesterKey(this.current.requester) === requesterKey) {
        if (userQueued + 1 >= this.config.perUserLimit) throw new Error('该用户排队歌曲已达上限')
      } else if (userQueued >= this.config.perUserLimit) {
        throw new Error('该用户排队歌曲已达上限')
      }
    }
    if (song.duration && song.duration > this.config.maxDuration) {
      throw new Error('歌曲时长超过限制')
    }

    const item: QueueItem = {
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      song,
      requester,
      keyword,
      createdAt: now,
    }
    this.queue.push(item)
    if (!options.bypassUserLimits) this.lastRequestAt.set(this.getRequesterKey(requester), now)
    void this.playNextIfIdle()
    this.broadcast()
    return item
  }

  remove(id: string): boolean {
    const index = this.queue.findIndex(item => item.id === id)
    if (index < 0) return false
    this.queue.splice(index, 1)
    this.broadcast()
    return true
  }

  move(id: string, action: QueueMoveAction): boolean {
    const index = this.queue.findIndex(item => item.id === id)
    if (index < 0) return false
    const target = action === 'top'
      ? 0
      : action === 'up'
        ? Math.max(0, index - 1)
        : Math.min(this.queue.length - 1, index + 1)
    if (target === index) return true
    const [item] = this.queue.splice(index, 1)
    this.queue.splice(target, 0, item)
    this.broadcast()
    return true
  }

  async removeOrSkip(id: string): Promise<boolean> {
    if (this.current?.id === id) {
      await this.skip()
      return true
    }
    return this.remove(id)
  }

  async skip(): Promise<void> {
    await this.player.stop()
    this.finishCurrent('skipped')
    await this.playNextIfIdle()
  }

  async previous(): Promise<boolean> {
    const previous = this.history.pop()
    if (!previous) return false
    await this.player.stop()
    if (this.current) this.queue.unshift(this.current)
    this.current = previous
    this.lastFinished = null
    this.position = 0
    this.paused = false
    this.playing = false
    this.phase = this.player.isReady() ? 'loading' : 'idle'
    this.broadcast()
    if (this.player.isReady()) await this.player.play(previous)
    return true
  }

  async pause(): Promise<boolean> {
    if (!this.current || !this.playing) return false
    await this.player.pause()
    this.playing = false
    this.paused = true
    this.phase = 'paused'
    this.broadcast()
    return true
  }

  async start(): Promise<boolean> {
    if (this.current) {
      if (this.paused) return this.resume()
      if (this.playing) return true
      if (!this.player.isReady()) return false
      this.backendError = null
      this.playing = false
      this.phase = 'loading'
      this.position = 0
      this.broadcast()
      await this.player.play(this.current)
      return true
    }
    if (!this.player.isReady() || !this.queue.length) return false
    await this.playNextIfIdle()
    return Boolean(this.current)
  }

  async resume(): Promise<boolean> {
    if (!this.current || !this.paused || !this.player.isReady()) return false
    this.playing = false
    this.paused = false
    this.phase = 'loading'
    this.backendError = null
    this.broadcast()
    await this.player.resume(this.current)
    return true
  }

  clear(): void {
    this.queue = []
    this.broadcast()
  }

  async handleEnded(): Promise<void> {
    this.finishCurrent('ended')
    await this.playNextIfIdle()
  }

  async handlePlayerAvailability(available: boolean): Promise<void> {
    if (!available) {
      if (this.playing) this.playing = false
      if (this.current && !this.paused) this.phase = 'idle'
      this.broadcast()
      return
    }
    this.backendError = null
    if (this.current) {
      if (this.paused) {
        this.broadcast()
        return
      }
      this.playing = false
      this.phase = 'loading'
      this.position = 0
      this.broadcast()
      await this.player.play(this.current)
      return
    }
    await this.playNextIfIdle()
  }

  handlePlayerError(itemId?: string): void {
    if (itemId && this.current?.id !== itemId) return
    this.finishCurrent('error')
    void this.playNextIfIdle()
  }

  handleBackendError(message: string): void {
    this.backendError = message
    this.playing = false
    this.phase = 'error'
    this.broadcast()
  }

  handleProgress(itemId: string, position: number): void {
    if (this.current?.id !== itemId || !Number.isFinite(position)) return
    this.position = Math.max(0, Math.min(position, this.current.song.duration || position))
    this.broadcast()
  }

  onStateChange(listener: (state: PlayerState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  dispose(): void {
    this.releasePlayer()
    this.listeners.clear()
  }

  private async playNextIfIdle(): Promise<void> {
    if (this.playing || this.current || this.paused) return
    if (!this.player.isReady()) {
      this.broadcast()
      return
    }
    const next = this.queue.shift()
    if (!next) {
      this.broadcast()
      return
    }
    this.current = next
    this.lastFinished = null
    this.backendError = null
    this.playing = false
    this.paused = false
    this.phase = 'loading'
    this.position = 0
    this.broadcast()
    try {
      await this.player.play(next)
    } catch (error) {
      this.handlePlayerError(next.id)
    }
  }

  private broadcast(): void {
    const state = this.getState()
    for (const listener of this.listeners) listener(state)
  }

  private finishCurrent(reason: PlaybackFinishReason): void {
    if (this.current) {
      const finishedPosition = reason === 'ended'
        ? this.current.song.duration || this.position
        : this.position
      this.lastFinished = {
        item: this.current,
        reason,
        position: finishedPosition,
        finishedAt: Date.now(),
      }
      this.history.push(this.current)
      if (this.history.length > this.config.historyLimit) {
        this.history.splice(0, this.history.length - this.config.historyLimit)
      }
    }
    this.current = null
    this.playing = false
    this.paused = false
    this.phase = reason === 'error' ? 'error' : 'finished'
    this.position = 0
  }

  private handlePlaybackEvent(event: PlaybackEvent): void {
    if (event.type === 'available') {
      void this.handlePlayerAvailability(event.available)
      return
    }
    if (event.type === 'progress') {
      this.handleProgress(event.itemId, event.position)
      return
    }
    if (event.type === 'loading') {
      if (this.current?.id !== event.itemId) return
      this.phase = 'loading'
      this.playing = false
      this.paused = false
      this.broadcast()
      return
    }
    if (event.type === 'playing') {
      if (this.current?.id !== event.itemId) return
      this.phase = 'playing'
      this.playing = true
      this.paused = false
      this.backendError = null
      this.broadcast()
      return
    }
    if (event.type === 'paused') {
      if (this.current?.id !== event.itemId) return
      this.phase = 'paused'
      this.playing = false
      this.paused = true
      this.broadcast()
      return
    }
    if (event.type === 'ended') {
      if (!event.itemId || this.current?.id === event.itemId) void this.handleEnded()
      return
    }
    if (event.type === 'error') {
      if (event.scope === 'backend') this.handleBackendError(event.message)
      else this.handlePlayerError(event.itemId)
    }
  }

  private getRequesterKey(requester: LiveUser): string {
    if (requester.origin === 'bilibili' && (!requester.uid || requester.uid === '0')) {
      return `bilibili:name:${requester.name.trim().toLocaleLowerCase()}`
    }
    return `${requester.origin}:${requester.uid}`
  }
}
