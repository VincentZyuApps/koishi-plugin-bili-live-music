import type { PlayerState, QueueItem } from '../music/types'
import type { PlaybackBackendKind } from '../player/types'
import type {
  OverlayClientMessage,
  OverlayControl,
  OverlayMediaEvent,
  OverlayMode,
  OverlayRole,
  OverlayServerMessage,
  OverlaySocket,
} from './protocol'

const EMPTY_STATE: PlayerState = {
  current: null,
  lastFinished: null,
  queue: [],
  history: [],
  phase: 'idle',
  playing: false,
  paused: false,
  position: 0,
  backendError: null,
}

export class OverlayHub {
  private sockets = new Set<OverlaySocket>()
  private modes = new Map<OverlaySocket, OverlayMode>()
  private primary?: OverlaySocket
  private state: PlayerState = EMPTY_STATE
  private availabilityListeners = new Set<(available: boolean) => void>()
  private controlListeners = new Set<(control: OverlayControl) => void>()
  private mediaListeners = new Set<(event: OverlayMediaEvent) => void>()
  private volume: number

  constructor(private backend: PlaybackBackendKind, initialVolume = 100) {
    this.volume = clampVolume(initialVolume)
  }

  addSocket(socket: OverlaySocket, mode: OverlayMode): OverlayRole {
    this.sockets.add(socket)
    this.modes.set(socket, mode)
    this.send(socket, { type: 'state', state: this.state })
    this.send(socket, { type: 'volume', volume: this.volume })
    this.sendRole(socket, this.backend === 'vlc' ? 'vlc' : 'display')
    socket.addEventListener('close', () => this.removeSocket(socket))
    if (this.backend === 'browser' && mode === 'player') this.claim(socket)
    return this.getRole(socket)
  }

  receive(socket: OverlaySocket, message: OverlayClientMessage): boolean {
    if (!this.sockets.has(socket)) return false
    if (message.type === 'claim') return this.claim(socket)
    if (message.type === 'ready') {
      this.send(socket, { type: 'state', state: this.state })
      this.sendRole(socket, this.getRole(socket))
      return true
    }
    if (message.type === 'previous' || message.type === 'next' || message.type === 'pause' || message.type === 'resume') {
      if (this.backend === 'browser' && this.primary !== socket) return false
      for (const listener of this.controlListeners) listener(message.type)
      return true
    }
    if (this.backend !== 'browser' || this.primary !== socket) return false
    if (message.type === 'ended') this.emitMedia({ type: 'ended' })
    if (message.type === 'loading') this.emitMedia({ type: 'loading', itemId: String(message.itemId || '') })
    if (message.type === 'playing') this.emitMedia({ type: 'playing', itemId: String(message.itemId || '') })
    if (message.type === 'progress') {
      this.emitMedia({ type: 'progress', itemId: String(message.itemId || ''), position: Number(message.position) })
    }
    if (message.type === 'error') this.emitMedia({ type: 'error', message: String(message.message || 'unknown error') })
    return true
  }

  claim(socket: OverlaySocket, resumeCurrent = false): boolean {
    if (this.backend !== 'browser' || !this.sockets.has(socket)) return false
    if (this.primary === socket) {
      this.sendRole(socket, 'player')
      return true
    }
    const hadPrimary = Boolean(this.primary) || resumeCurrent
    if (this.primary) {
      this.send(this.primary, { type: 'stop' })
      this.sendRole(this.primary, 'display')
    }
    this.primary = socket
    this.sendRole(socket, 'player')
    this.send(socket, { type: 'state', state: this.state })
    this.send(socket, { type: 'volume', volume: this.volume })
    if (hadPrimary && this.state.current && !this.state.paused && (this.state.phase === 'loading' || this.state.phase === 'playing')) {
      this.send(socket, { type: 'play', item: this.state.current })
    }
    if (!hadPrimary) this.emitAvailability(true)
    return true
  }

  setBackend(backend: PlaybackBackendKind): void {
    if (this.backend === backend) return
    const wasReady = Boolean(this.primary)
    if (this.primary) this.send(this.primary, { type: 'stop' })
    this.primary = undefined
    this.backend = backend
    for (const socket of this.sockets) this.sendRole(socket, backend === 'vlc' ? 'vlc' : 'display')
    if (wasReady) this.emitAvailability(false)
    if (backend === 'browser') {
      const candidate = [...this.sockets].reverse().find(socket => this.modes.get(socket) === 'player')
      if (candidate) this.claim(candidate)
    }
  }

  getBackend(): PlaybackBackendKind {
    return this.backend
  }

  getRole(socket: OverlaySocket): OverlayRole {
    if (this.backend === 'vlc') return 'vlc'
    return this.primary === socket ? 'player' : 'display'
  }

  isPrimary(socket: OverlaySocket): boolean {
    return this.backend === 'browser' && this.primary === socket
  }

  hasPrimary(): boolean {
    return this.backend === 'browser' && Boolean(this.primary)
  }

  play(item: QueueItem): void {
    if (this.primary) this.send(this.primary, { type: 'play', item })
  }

  pause(): void {
    if (this.primary) this.send(this.primary, { type: 'pause' })
  }

  resume(item: QueueItem): void {
    if (this.primary) this.send(this.primary, { type: 'resume', item })
  }

  stop(): void {
    if (this.primary) this.send(this.primary, { type: 'stop' })
  }

  setVolume(volume: number): number {
    this.volume = clampVolume(volume)
    for (const socket of this.sockets) this.send(socket, { type: 'volume', volume: this.volume })
    return this.volume
  }

  publish(state: PlayerState): void {
    this.state = state
    for (const socket of this.sockets) this.send(socket, { type: 'state', state })
  }

  onAvailabilityChange(listener: (available: boolean) => void): () => void {
    this.availabilityListeners.add(listener)
    return () => this.availabilityListeners.delete(listener)
  }

  onControl(listener: (control: OverlayControl) => void): () => void {
    this.controlListeners.add(listener)
    return () => this.controlListeners.delete(listener)
  }

  onMedia(listener: (event: OverlayMediaEvent) => void): () => void {
    this.mediaListeners.add(listener)
    return () => this.mediaListeners.delete(listener)
  }

  dispose(): void {
    for (const socket of this.sockets) socket.close()
    this.sockets.clear()
    this.modes.clear()
    this.primary = undefined
    this.availabilityListeners.clear()
    this.controlListeners.clear()
    this.mediaListeners.clear()
  }

  private removeSocket(socket: OverlaySocket): void {
    this.sockets.delete(socket)
    this.modes.delete(socket)
    if (this.primary !== socket) return
    this.primary = undefined
    const fallback = [...this.sockets].reverse().find(candidate => this.modes.get(candidate) === 'player')
    if (fallback) this.claim(fallback, true)
    else this.emitAvailability(false)
  }

  private sendRole(socket: OverlaySocket, role: OverlayRole): void {
    this.send(socket, { type: 'role', role, backend: this.backend })
  }

  private send(socket: OverlaySocket, message: OverlayServerMessage): void {
    try {
      socket.send(JSON.stringify(message))
    } catch {
      this.removeSocket(socket)
    }
  }

  private emitAvailability(available: boolean): void {
    for (const listener of this.availabilityListeners) listener(available)
  }

  private emitMedia(event: OverlayMediaEvent): void {
    for (const listener of this.mediaListeners) listener(event)
  }
}

function clampVolume(value: number): number {
  return Math.round(Math.max(0, Math.min(100, Number.isFinite(value) ? value : 100)))
}
