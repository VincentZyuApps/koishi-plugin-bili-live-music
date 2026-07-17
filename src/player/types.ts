import type { QueueItem } from '../music/types'

export type PlaybackBackendKind = 'browser' | 'vlc'
export type PlaybackRuntimeStatus = 'starting' | 'ready' | 'restarting' | 'error' | 'stopped'

export interface PlaybackRuntimeState {
  kind: PlaybackBackendKind
  status: PlaybackRuntimeStatus
  ready: boolean
  detail: string
  error: string | null
  volume: number
  executable?: string
  version?: string
  audioDevice?: string
}

export interface AudioDeviceInfo {
  id: string
  name: string
  active: boolean
}

export type PlaybackEvent =
  | { type: 'available'; available: boolean }
  | { type: 'loading'; itemId: string }
  | { type: 'playing'; itemId: string }
  | { type: 'paused'; itemId: string }
  | { type: 'progress'; itemId: string; position: number }
  | { type: 'ended'; itemId: string }
  | { type: 'error'; scope: 'track' | 'backend'; itemId?: string; message: string }
  | { type: 'runtime'; state: PlaybackRuntimeState }

export interface PlaybackDiagnostic {
  ok: boolean
  message: string
  state: PlaybackRuntimeState
}

export interface PlaybackBackend {
  readonly kind: PlaybackBackendKind
  start(): Promise<void>
  isReady(): boolean
  play(item: QueueItem): Promise<void>
  pause(): Promise<void>
  resume(item: QueueItem): Promise<void>
  stop(): Promise<void>
  setVolume(volume: number): Promise<number>
  subscribe(listener: (event: PlaybackEvent) => void): () => void
  getRuntimeState(): PlaybackRuntimeState
  detect(): Promise<PlaybackDiagnostic>
  restart(): Promise<boolean>
  listAudioDevices(): Promise<AudioDeviceInfo[]>
  dispose(): Promise<void>
}
