import type { QueueItem } from '../music/types'
import type {
  AudioDeviceInfo,
  PlaybackBackend,
  PlaybackDiagnostic,
  PlaybackEvent,
  PlaybackRuntimeState,
} from './types'

export class PlaybackManager implements PlaybackBackend {
  readonly kind

  constructor(private backend: PlaybackBackend) {
    this.kind = backend.kind
  }

  start(): Promise<void> { return this.backend.start() }
  isReady(): boolean { return this.backend.isReady() }
  play(item: QueueItem): Promise<void> { return this.backend.play(item) }
  pause(): Promise<void> { return this.backend.pause() }
  resume(item: QueueItem): Promise<void> { return this.backend.resume(item) }
  stop(): Promise<void> { return this.backend.stop() }
  setVolume(volume: number): Promise<number> { return this.backend.setVolume(volume) }
  subscribe(listener: (event: PlaybackEvent) => void): () => void { return this.backend.subscribe(listener) }
  getRuntimeState(): PlaybackRuntimeState { return this.backend.getRuntimeState() }
  detect(): Promise<PlaybackDiagnostic> { return this.backend.detect() }
  restart(): Promise<boolean> { return this.backend.restart() }
  listAudioDevices(): Promise<AudioDeviceInfo[]> { return this.backend.listAudioDevices() }
  dispose(): Promise<void> { return this.backend.dispose() }
}
