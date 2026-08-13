import type { LiveUser } from '../music/types'

export type DanmuConnectionState =
  | 'disabled'
  | 'starting'
  | 'connected'
  | 'waiting'
  | 'reconnecting'
  | 'stopped'

export type DanmuIdentityMode = 'unknown' | 'anonymous' | 'authenticated'

export interface DanmuMessage {
  content: string
  user: LiveUser
}

export interface DanmuRuntimeState {
  state: DanmuConnectionState
  roomId: string
  identity: DanmuIdentityMode
  attempt: number
  failureCount: number
  generation: number
  connectedAt: number | null
  lastTransitionAt: number
  nextRetryAt: number | null
  lastError: string | null
}

export interface DanmuStateTransition {
  id: number
  from: DanmuConnectionState
  to: DanmuConnectionState
  at: number
  reason: string
}

export interface DanmuStateSnapshot {
  runtime: DanmuRuntimeState
  history: DanmuStateTransition[]
}

export interface DanmuReconnectResult {
  ok: boolean
  elapsed: number
  state: DanmuRuntimeState
}

export interface DanmuConnectionCallbacks {
  onOpen(): void
  onConnected(): void
  onClose(): void
  onError(error: unknown): void
}

export interface DanmuConnectionAdapter {
  connect(callbacks: DanmuConnectionCallbacks): Promise<DanmuIdentityMode>
  stop(): void
  dispose(): void
}
