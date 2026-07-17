import type { PlayerState, QueueItem } from '../music/types'
import type { PlaybackBackendKind } from '../player/types'

export type OverlayMode = 'player' | 'display'
export type OverlayRole = 'player' | 'display' | 'vlc'
export type OverlayControl = 'previous' | 'next' | 'pause' | 'resume'

export type OverlayServerMessage =
  | { type: 'state'; state: PlayerState }
  | { type: 'role'; role: OverlayRole; backend: PlaybackBackendKind }
  | { type: 'volume'; volume: number }
  | { type: 'play'; item: QueueItem }
  | { type: 'pause' }
  | { type: 'resume'; item: QueueItem }
  | { type: 'stop' }

export type OverlayClientMessage =
  | { type: 'ready' }
  | { type: 'claim' }
  | { type: OverlayControl }
  | { type: 'ended' }
  | { type: 'loading'; itemId?: string }
  | { type: 'playing'; itemId?: string }
  | { type: 'progress'; itemId?: string; position?: number }
  | { type: 'error'; message?: string }

export interface OverlaySocket {
  send(data: string): void
  close(): void
  addEventListener(type: 'close', listener: () => void): void
}

export interface OverlayMediaEvent {
  type: 'loading' | 'playing' | 'ended' | 'progress' | 'error'
  itemId?: string
  position?: number
  message?: string
}
