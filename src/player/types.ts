import type { PlayerState, QueueItem } from '../music/types'

export interface PlayerAdapter {
  isReady(): boolean
  play(item: QueueItem): Promise<void>
  pause(): Promise<void>
  resume(item: QueueItem): Promise<void>
  stop(): Promise<void>
  broadcast(state: PlayerState): void
  onAvailabilityChange(listener: (available: boolean) => void): () => void
  dispose(): void
}
