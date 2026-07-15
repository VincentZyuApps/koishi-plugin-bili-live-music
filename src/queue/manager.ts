import type { Config } from '../config'
import type { PlayerAdapter } from '../player/types'
import type { LiveUser, PlayerState, QueueItem, Song } from '../music/types'

export interface QueueAddOptions {
  bypassUserLimits?: boolean
}

export type QueueMoveAction = 'top' | 'up' | 'down'

export class QueueManager {
  private queue: QueueItem[] = []
  private current: QueueItem | null = null
  private lastRequestAt = new Map<string, number>()
  private playing = false
  private listeners = new Set<(state: PlayerState) => void>()

  constructor(private config: Config, private player: PlayerAdapter) {}

  getState(): PlayerState {
    return {
      current: this.current,
      queue: [...this.queue],
      playing: this.playing,
    }
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
    this.current = null
    this.playing = false
    await this.playNextIfIdle()
  }

  clear(): void {
    this.queue = []
    this.broadcast()
  }

  async handleEnded(): Promise<void> {
    this.current = null
    this.playing = false
    await this.playNextIfIdle()
  }

  async handlePlayerAvailability(available: boolean): Promise<void> {
    if (!available) {
      if (!this.playing) return
      this.playing = false
      this.broadcast()
      return
    }
    if (this.current) {
      this.playing = true
      this.broadcast()
      await this.player.play(this.current)
      return
    }
    await this.playNextIfIdle()
  }

  handlePlayerError(): void {
    this.current = null
    this.playing = false
    void this.playNextIfIdle()
  }

  onStateChange(listener: (state: PlayerState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async playNextIfIdle(): Promise<void> {
    if (this.playing || this.current) return
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
    this.broadcast()
    await this.player.play(next)
  }

  private broadcast(): void {
    const state = this.getState()
    this.player.broadcast(state)
    for (const listener of this.listeners) listener(state)
  }
}
