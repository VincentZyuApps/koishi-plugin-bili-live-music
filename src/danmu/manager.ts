import type { Context } from 'koishi'
import type { AxiosInstance } from 'axios'
import type { Config } from '../config'
import { BilibiliDanmuConnection } from './client'
import type {
  DanmuConnectionAdapter,
  DanmuConnectionState,
  DanmuIdentityMode,
  DanmuMessage,
  DanmuReconnectResult,
  DanmuRuntimeState,
  DanmuStateSnapshot,
  DanmuStateTransition,
} from './types'

export const DANMU_CONNECT_TIMEOUT_MS = 10_000
export const DANMU_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000] as const
const DANMU_HISTORY_LIMIT = 25

interface AttemptContext {
  generation: number
  settled: boolean
  resolve(state: DanmuRuntimeState): void
}

export interface DanmuManagerOptions {
  connection?: DanmuConnectionAdapter
  connectTimeoutMs?: number
  retryDelaysMs?: readonly number[]
}

export class BilibiliDanmuManager {
  private connection: DanmuConnectionAdapter
  private connectTimeoutMs: number
  private retryDelaysMs: readonly number[]
  private runtime: DanmuRuntimeState
  private history: DanmuStateTransition[] = []
  private listeners = new Set<(snapshot: DanmuStateSnapshot) => void>()
  private transitionId = 0
  private retryTimer?: NodeJS.Timeout
  private connectTimer?: NodeJS.Timeout
  private currentAttempt?: AttemptContext
  private currentAttemptPromise?: Promise<DanmuRuntimeState>
  private disposed = false

  constructor(
    private ctx: Context,
    private config: Config,
    http: AxiosInstance,
    onDanmu: (message: DanmuMessage) => void | Promise<void>,
    options: DanmuManagerOptions = {},
  ) {
    this.connection = options.connection ?? new BilibiliDanmuConnection(ctx, config, http, onDanmu)
    this.connectTimeoutMs = options.connectTimeoutMs ?? DANMU_CONNECT_TIMEOUT_MS
    this.retryDelaysMs = options.retryDelaysMs?.length ? options.retryDelaysMs : DANMU_RETRY_DELAYS_MS
    this.runtime = {
      state: 'stopped',
      roomId: config.roomId,
      identity: 'unknown',
      attempt: 0,
      failureCount: 0,
      generation: 0,
      connectedAt: null,
      lastTransitionAt: Date.now(),
      nextRetryAt: null,
      lastError: null,
    }
  }

  start(): Promise<DanmuRuntimeState> {
    const unavailable = this.validateConfiguration()
    if (unavailable) {
      const state = unavailable.state
      this.transition(state, unavailable.reason, { lastError: state === 'stopped' ? unavailable.reason : null })
      return Promise.resolve(this.getState())
    }
    return this.beginAttempt('starting', '插件启动，开始连接弹幕服务器')
  }

  async reconnect(): Promise<DanmuReconnectResult> {
    const startedAt = Date.now()
    const unavailable = this.validateConfiguration()
    if (unavailable) {
      this.transition(unavailable.state, unavailable.reason, { lastError: unavailable.state === 'stopped' ? unavailable.reason : null })
      return { ok: false, elapsed: Date.now() - startedAt, state: this.getState() }
    }
    const state = this.currentAttemptPromise
      ? await this.currentAttemptPromise
      : await this.beginAttempt('reconnecting', '管理员手动重连')
    return { ok: state.state === 'connected', elapsed: Date.now() - startedAt, state }
  }

  getState(): DanmuRuntimeState {
    return { ...this.runtime }
  }

  getSnapshot(): DanmuStateSnapshot {
    return { runtime: this.getState(), history: this.history.map(item => ({ ...item })) }
  }

  onStateChange(listener: (snapshot: DanmuStateSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  stop(): void {
    if (this.disposed) return
    this.clearTimers()
    this.runtime.generation++
    this.connection.stop()
    this.transition('stopped', '弹幕监听已停止', { nextRetryAt: null })
    this.resolveCurrentAttempt()
  }

  dispose(): void {
    if (this.disposed) return
    this.clearTimers()
    this.runtime.generation++
    this.connection.dispose()
    this.transition('stopped', '插件已卸载，弹幕监听停止', { nextRetryAt: null })
    this.resolveCurrentAttempt()
    this.disposed = true
    this.listeners.clear()
  }

  private validateConfiguration(): { state: 'disabled' | 'stopped'; reason: string } | null {
    if (!this.config.enabled) return { state: 'disabled', reason: '配置已关闭 B 站弹幕监听' }
    if (!this.config.roomId.trim()) return { state: 'stopped', reason: '未配置 B 站直播间号' }
    const roomId = Number.parseInt(this.config.roomId, 10)
    if (!Number.isFinite(roomId) || roomId <= 0) return { state: 'stopped', reason: `直播间号非法: ${this.config.roomId}` }
    if (!this.ctx.node?.import && this.connection instanceof BilibiliDanmuConnection) {
      return { state: 'stopped', reason: '未检测到 w-node 服务' }
    }
    return null
  }

  private beginAttempt(state: 'starting' | 'reconnecting', reason: string): Promise<DanmuRuntimeState> {
    if (this.disposed) return Promise.resolve(this.getState())
    if (this.currentAttemptPromise) return this.currentAttemptPromise
    this.clearRetryTimer()
    const generation = this.runtime.generation + 1
    this.runtime.generation = generation
    this.connection.stop()
    this.transition(state, reason, {
      attempt: this.runtime.attempt + 1,
      connectedAt: null,
      nextRetryAt: null,
      lastError: null,
      generation,
    })

    const promise = new Promise<DanmuRuntimeState>((resolve) => {
      const attempt: AttemptContext = { generation, settled: false, resolve }
      this.currentAttempt = attempt
      this.connectTimer = setTimeout(() => {
        this.failAttempt(generation, `连接等待超过 ${this.connectTimeoutMs / 1_000} 秒`)
      }, this.connectTimeoutMs)
      void this.connection.connect({
        onOpen: () => {
          if (!this.isCurrent(generation)) return
          this.ctx.logger('bili-live-music').info(`B 站直播间 ${this.runtime.roomId} 弹幕连接已打开`)
        },
        onConnected: () => this.completeAttempt(generation),
        onClose: () => this.handleClose(generation),
        onError: error => this.handleConnectionError(generation, error),
      }).then(identity => this.updateIdentity(generation, identity)).catch(error => {
        this.failAttempt(generation, messageOf(error))
      })
    })
    const tracked = promise.finally(() => {
      if (this.currentAttempt?.generation === generation) this.currentAttempt = undefined
      if (this.currentAttemptPromise === tracked) this.currentAttemptPromise = undefined
    })
    this.currentAttemptPromise = tracked
    return this.currentAttemptPromise
  }

  private completeAttempt(generation: number): void {
    const attempt = this.currentAttempt
    if (!attempt || attempt.generation !== generation || attempt.settled || !this.isCurrent(generation)) return
    attempt.settled = true
    this.clearConnectTimer()
    this.transition('connected', '弹幕认证成功，已开始监听', {
      failureCount: 0,
      connectedAt: Date.now(),
      nextRetryAt: null,
      lastError: null,
    })
    this.ctx.logger('bili-live-music').info(`B 站直播间 ${this.runtime.roomId} 弹幕认证成功，已开始监听`)
    attempt.resolve(this.getState())
  }

  private failAttempt(generation: number, error: string): void {
    const attempt = this.currentAttempt
    if (!attempt || attempt.generation !== generation || attempt.settled || !this.isCurrent(generation)) return
    attempt.settled = true
    this.clearConnectTimer()
    this.connection.stop()
    this.enterWaiting(error)
    attempt.resolve(this.getState())
  }

  private handleClose(generation: number): void {
    if (!this.isCurrent(generation)) return
    if (this.currentAttempt && !this.currentAttempt.settled) {
      this.failAttempt(generation, '弹幕连接在认证完成前关闭')
      return
    }
    if (this.runtime.state !== 'connected') return
    this.enterWaiting('已认证的弹幕连接关闭')
    this.connection.stop()
  }

  private handleConnectionError(generation: number, error: unknown): void {
    if (!this.isCurrent(generation)) return
    const message = messageOf(error)
    this.runtime = { ...this.runtime, lastError: message }
    this.publish()
    this.ctx.logger('bili-live-music').warn(`B 站弹幕监听错误: ${message}`)
  }

  private updateIdentity(generation: number, identity: DanmuIdentityMode): void {
    if (!this.isCurrent(generation)) return
    const previous = this.runtime.identity
    this.runtime = { ...this.runtime, identity }
    this.publish()
    if (previous === 'unknown') {
      this.ctx.logger('bili-live-music').info(
        identity === 'anonymous' ? 'B 站匿名身份已就绪' : 'B 站登录身份已就绪',
      )
    }
  }

  private enterWaiting(error: string): void {
    this.clearRetryTimer()
    const failureCount = this.runtime.failureCount + 1
    const delay = getDanmuRetryDelay(failureCount, this.retryDelaysMs)
    const nextRetryAt = Date.now() + delay
    this.transition('waiting', `${error}，${delay / 1_000} 秒后自动重试`, {
      failureCount,
      connectedAt: null,
      nextRetryAt,
      lastError: error,
    })
    this.ctx.logger('bili-live-music').warn(
      `B 站直播间 ${this.runtime.roomId} 弹幕连接失败: ${error}，${delay / 1_000} 秒后自动重试`,
    )
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      void this.beginAttempt('reconnecting', `自动重连 #${failureCount}`)
    }, delay)
  }

  private transition(to: DanmuConnectionState, reason: string, patch: Partial<DanmuRuntimeState> = {}): void {
    const from = this.runtime.state
    const at = Date.now()
    this.runtime = { ...this.runtime, ...patch, state: to, lastTransitionAt: at }
    this.history.push({ id: ++this.transitionId, from, to, at, reason })
    if (this.history.length > DANMU_HISTORY_LIMIT) this.history.splice(0, this.history.length - DANMU_HISTORY_LIMIT)
    this.publish()
  }

  private publish(): void {
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) listener(snapshot)
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && generation === this.runtime.generation
  }

  private resolveCurrentAttempt(): void {
    const attempt = this.currentAttempt
    if (!attempt || attempt.settled) return
    attempt.settled = true
    attempt.resolve(this.getState())
  }

  private clearTimers(): void {
    this.clearRetryTimer()
    this.clearConnectTimer()
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = undefined
  }

  private clearConnectTimer(): void {
    if (this.connectTimer) clearTimeout(this.connectTimer)
    this.connectTimer = undefined
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function getDanmuRetryDelay(failureCount: number, delays: readonly number[] = DANMU_RETRY_DELAYS_MS): number {
  if (!delays.length) return 0
  return delays[Math.min(Math.max(0, failureCount - 1), delays.length - 1)]
}
