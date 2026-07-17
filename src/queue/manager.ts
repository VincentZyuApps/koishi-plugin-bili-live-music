import type { Config } from '../config'
import type { PlayerAdapter } from '../player/types'
import type { LiveUser, PlayerState, QueueItem, Song } from '../music/types'

export interface QueueAddOptions {
  bypassUserLimits?: boolean
}

export type QueueMoveAction = 'top' | 'up' | 'down'

export class QueueManager {
  private queue: QueueItem[] = []
  private history: QueueItem[] = []
  private current: QueueItem | null = null
  private lastRequestAt = new Map<string, number>()
  private playing = false
  private paused = false
  private position = 0
  private listeners = new Set<(state: PlayerState) => void>()

  constructor(private config: Config, private player: PlayerAdapter) {}

  getState(): PlayerState {
    return {
      current: this.current,
      queue: [...this.queue],
      history: [...this.history],
      playing: this.playing,
      paused: this.paused,
      position: this.position,
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
      const last = this.lastRequestAt.get(requester.uid) ?? 0
      if (now - last < this.config.cooldown) {
        throw new Error(`点歌过快，请稍后再试`)
      }
      const userQueued = this.queue.filter(item => item.requester.uid === requester.uid).length
      if (this.current?.requester.uid === requester.uid && this.playing) {
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
    if (!options.bypassUserLimits) this.lastRequestAt.set(requester.uid, now)
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
    this.finishCurrent()
    await this.playNextIfIdle()
  }

  async previous(): Promise<boolean> {
    const previous = this.history.pop()
    if (!previous) return false
    await this.player.stop()
    if (this.current) this.queue.unshift(this.current)
    this.current = previous
    this.position = 0
    this.paused = false
    this.playing = this.player.isReady()
    this.broadcast()
    if (this.playing) await this.player.play(previous)
    return true
  }

  async pause(): Promise<boolean> {
    if (!this.current || !this.playing) return false
    await this.player.pause()
    this.playing = false
    this.paused = true
    this.broadcast()
    return true
  }

  async start(): Promise<boolean> {
    if (this.current) {
      if (this.paused) return this.resume()
      return this.playing
    }
    if (!this.player.isReady() || !this.queue.length) return false
    await this.playNextIfIdle()
    return Boolean(this.current && this.playing)
  }

  async resume(): Promise<boolean> {
    if (!this.current || !this.paused || !this.player.isReady()) return false
    this.playing = true
    this.paused = false
    this.broadcast()
    await this.player.resume(this.current)
    return true
  }

  clear(): void {
    this.queue = []
    this.broadcast()
  }

  async handleEnded(): Promise<void> {
    this.finishCurrent()
    await this.playNextIfIdle()
  }

  async handlePlayerAvailability(available: boolean): Promise<void> {
    if (!available) {
      if (this.playing) this.playing = false
      this.broadcast()
      return
    }
    if (this.current) {
      if (this.paused) {
        this.broadcast()
        return
      }
      this.playing = true
      this.position = 0
      this.broadcast()
      await this.player.play(this.current)
      return
    }
    await this.playNextIfIdle()
  }

  handlePlayerError(): void {
    this.finishCurrent()
    void this.playNextIfIdle()
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
    this.playing = true
    this.paused = false
    this.position = 0
    this.broadcast()
    await this.player.play(next)
  }

  private broadcast(): void {
    const state = this.getState()
    this.player.broadcast(state)
    for (const listener of this.listeners) listener(state)
  }

  private finishCurrent(): void {
    if (this.current) {
      this.history.push(this.current)
      if (this.history.length > this.config.historyLimit) {
        this.history.splice(0, this.history.length - this.config.historyLimit)
      }
    }
    this.current = null
    this.playing = false
    this.paused = false
    this.position = 0
  }
}
