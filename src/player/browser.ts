import type { PlayerState, QueueItem } from '../music/types'
import type { PlayerAdapter } from './types'

type Message = Record<string, unknown>
export interface BrowserSocket {
  send(data: string): void
  close(): void
  addEventListener(type: 'close', listener: () => void): void
}

export class BrowserPlayerAdapter implements PlayerAdapter {
  private sockets = new Set<BrowserSocket>()
  private primary?: BrowserSocket
  private state: PlayerState = { current: null, queue: [], playing: false }
  private availabilityListeners = new Set<(available: boolean) => void>()

  addSocket(socket: BrowserSocket, mode: 'player' | 'display'): void {
    this.sockets.add(socket)
    this.send(socket, { type: 'state', state: this.state })
    this.send(socket, { type: 'role', role: 'display' })
    socket.addEventListener('close', () => {
      this.sockets.delete(socket)
      if (this.primary !== socket) return
      this.primary = undefined
      this.emitAvailability(false)
    })
    if (mode === 'player') this.claim(socket)
  }

  claim(socket: BrowserSocket): boolean {
    if (!this.sockets.has(socket)) return false
    if (this.primary === socket) {
      this.send(socket, { type: 'role', role: 'player' })
      return true
    }

    const hadPrimary = Boolean(this.primary)
    if (this.primary) {
      this.send(this.primary, { type: 'stop' })
      this.send(this.primary, { type: 'role', role: 'display' })
    }
    this.primary = socket
    this.send(socket, { type: 'role', role: 'player' })
    this.send(socket, { type: 'state', state: this.state })
    if (hadPrimary && this.state.playing && this.state.current) {
      this.send(socket, { type: 'play', item: this.state.current })
    }
    if (!hadPrimary) this.emitAvailability(true)
    return true
  }

  isPrimary(socket: BrowserSocket): boolean {
    return this.primary === socket
  }

  isReady(): boolean {
    return Boolean(this.primary)
  }

  async play(item: QueueItem): Promise<void> {
    if (this.primary) this.send(this.primary, { type: 'play', item })
  }

  async stop(): Promise<void> {
    if (this.primary) this.send(this.primary, { type: 'stop' })
  }

  broadcast(state: PlayerState): void {
    this.state = state
    this.broadcastMessage({ type: 'state', state })
  }

  onAvailabilityChange(listener: (available: boolean) => void): () => void {
    this.availabilityListeners.add(listener)
    return () => this.availabilityListeners.delete(listener)
  }

  dispose(): void {
    for (const socket of this.sockets) socket.close()
    this.sockets.clear()
    this.primary = undefined
    this.availabilityListeners.clear()
  }

  private broadcastMessage(message: Message): void {
    for (const socket of this.sockets) this.send(socket, message)
  }

  private send(socket: BrowserSocket, message: Message): void {
    try {
      socket.send(JSON.stringify(message))
    } catch {
      this.sockets.delete(socket)
    }
  }

  private emitAvailability(available: boolean): void {
    for (const listener of this.availabilityListeners) listener(available)
  }
}
