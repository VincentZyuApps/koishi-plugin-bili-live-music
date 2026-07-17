import type { Context } from 'koishi'
import type { Config } from '../../config'
import type { QueueItem } from '../../music/types'
import type { AudioDeviceInfo, PlaybackBackend, PlaybackDiagnostic, PlaybackEvent, PlaybackRuntimeState } from '../types'
import { VlcProcessHost, probeVlcVersion } from './process'
import { VlcRcClient } from './rc-client'
import { assertSafeRcValue, parseAudioDevices, parseRcNumber, parseRcState, volumePercentToVlc } from './protocol'

export class VlcPlaybackBackend implements PlaybackBackend {
  readonly kind = 'vlc' as const
  private listeners = new Set<(event: PlaybackEvent) => void>()
  private process?: VlcProcessHost
  private rc?: VlcRcClient
  private releaseExit?: () => void
  private runtime: PlaybackRuntimeState
  private currentVolume: number
  private current?: QueueItem
  private progressTimer?: NodeJS.Timeout
  private startedAt = 0
  private observedPlaying = false
  private paused = false
  private expectedExit = false
  private restartAttempts = 0
  private restartResetTimer?: NodeJS.Timeout
  private lifecycle: Promise<unknown> = Promise.resolve()
  private disposed = false

  constructor(private ctx: Context, private config: Config) {
    this.currentVolume = clampVolume(config.playbackVolume)
    this.runtime = this.createRuntime('stopped', false, 'VLC 尚未启动')
  }

  async start(): Promise<void> {
    await this.withLifecycle(async () => {
      if (this.disposed || this.isReady()) return
      try {
        await this.startManaged('starting')
      } catch (error) {
        this.failBackend(`VLC 启动失败: ${messageOf(error)}`)
      }
    })
  }

  isReady(): boolean {
    return this.runtime.ready && Boolean(this.rc?.isConnected() && this.process?.isRunning())
  }

  async play(item: QueueItem): Promise<void> {
    if (!this.isReady() || !this.rc) throw new Error(this.runtime.error || 'VLC 后端未就绪')
    const url = assertSafeRcValue(item.song.url || '', '歌曲播放地址')
    this.current = item
    this.startedAt = Date.now()
    this.observedPlaying = false
    this.paused = false
    this.emit({ type: 'loading', itemId: item.id })
    try {
      await this.rc.execute('stop')
      await this.rc.execute('clear')
      const response = await this.rc.execute(`add ${url}`, 5_000)
      if (/error|failed|cannot open|无法/i.test(response)) throw new Error(response.trim())
      this.startProgressPolling()
    } catch (error) {
      this.current = undefined
      this.stopProgressPolling()
      const message = `VLC 无法加载歌曲: ${messageOf(error)}`
      this.emit({ type: 'error', scope: 'track', itemId: item.id, message })
      throw new Error(message)
    }
  }

  async pause(): Promise<void> {
    if (!this.current || this.paused || !this.rc) return
    await this.rc.execute('pause')
    this.paused = true
    this.emit({ type: 'paused', itemId: this.current.id })
  }

  async resume(item: QueueItem): Promise<void> {
    if (!this.rc) throw new Error('VLC RC 尚未连接')
    this.current = item
    if (!this.paused) return this.play(item)
    this.startedAt = Date.now()
    this.observedPlaying = false
    this.emit({ type: 'loading', itemId: item.id })
    await this.rc.execute('pause')
    this.paused = false
  }

  async stop(): Promise<void> {
    this.stopProgressPolling()
    this.current = undefined
    this.paused = false
    if (this.rc?.isConnected()) await this.rc.execute('stop').catch(() => undefined)
  }

  async setVolume(volume: number): Promise<number> {
    this.currentVolume = clampVolume(volume)
    if (this.rc?.isConnected()) await this.rc.execute(`volume ${volumePercentToVlc(this.currentVolume)}`)
    this.runtime = { ...this.runtime, volume: this.currentVolume }
    this.emitRuntime()
    return this.currentVolume
  }

  subscribe(listener: (event: PlaybackEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getRuntimeState(): PlaybackRuntimeState {
    return { ...this.runtime }
  }

  async detect(): Promise<PlaybackDiagnostic> {
    try {
      const version = await probeVlcVersion(this.config.vlcExecutablePath, this.config.vlcStartupTimeout)
      const support = describeVersionSupport(version)
      const state = { ...this.runtime, executable: this.config.vlcExecutablePath, version }
      return { ok: support.supported, message: `检测到 VLC ${version}，${support.message}`, state }
    } catch (error) {
      return { ok: false, message: `VLC 检测失败: ${messageOf(error)}`, state: this.getRuntimeState() }
    }
  }

  async restart(): Promise<boolean> {
    await this.withLifecycle(async () => {
      this.restartAttempts = 0
      if (this.restartResetTimer) clearTimeout(this.restartResetTimer)
      await this.shutdownManaged()
      if (this.disposed) return
      try {
        await this.startManaged('restarting')
      } catch (error) {
        this.failBackend(`VLC 重启失败: ${messageOf(error)}`)
      }
    })
    return this.isReady()
  }

  async listAudioDevices(): Promise<AudioDeviceInfo[]> {
    if (!this.rc?.isConnected()) throw new Error('VLC RC 尚未连接，请先启动或重启 VLC')
    const output = await this.rc.execute('adev', 3_000)
    const devices = parseAudioDevices(output, this.config.vlcAudioDevice)
    if (!devices.length) throw new Error('VLC 未返回音频设备；请先播放一首歌曲后重试')
    return devices
  }

  async dispose(): Promise<void> {
    this.disposed = true
    if (this.restartResetTimer) clearTimeout(this.restartResetTimer)
    await this.withLifecycle(() => this.shutdownManaged())
    this.listeners.clear()
    this.runtime = this.createRuntime('stopped', false, 'VLC 已停止')
  }

  private async startManaged(status: 'starting' | 'restarting'): Promise<void> {
    this.runtime = this.createRuntime(status, false, status === 'starting' ? '正在启动 VLC' : '正在重启 VLC')
    this.emitRuntime()
    const process = new VlcProcessHost({
      executable: this.config.vlcExecutablePath,
      rcPort: this.config.vlcRcPort,
      showWindow: this.config.vlcShowWindow,
    })
    this.process = process
    this.releaseExit = process.onExit((code, signal) => {
      if (!this.expectedExit && !this.disposed) void this.handleUnexpectedExit(code, signal)
    })
    process.start()
    const rc = new VlcRcClient('127.0.0.1', this.config.vlcRcPort)
    this.rc = rc
    await connectWithRetry(rc, process, this.config.vlcStartupTimeout)
    const diagnostic = await this.detect()
    await rc.execute(`volume ${volumePercentToVlc(this.currentVolume)}`)
    if (this.config.vlcAudioDevice.trim()) {
      await rc.execute(`adev ${assertSafeRcValue(this.config.vlcAudioDevice, 'vlcAudioDevice')}`)
    }
    this.runtime = {
      ...this.createRuntime('ready', true, diagnostic.message),
      version: diagnostic.state.version,
      audioDevice: this.config.vlcAudioDevice || '系统默认',
    }
    if (status === 'starting') this.restartAttempts = 0
    this.emitRuntime()
    this.emit({ type: 'available', available: true })
    this.ctx.logger('bili-live-music').info(`VLC 播放后端已就绪: ${diagnostic.message}`)
  }

  private async shutdownManaged(): Promise<void> {
    this.stopProgressPolling()
    this.expectedExit = true
    const rc = this.rc
    this.rc = undefined
    if (rc?.isConnected()) await rc.execute('quit', 1_000).catch(() => undefined)
    rc?.close()
    await this.process?.stop()
    this.releaseExit?.()
    this.releaseExit = undefined
    this.process = undefined
    this.expectedExit = false
  }

  private async handleUnexpectedExit(code: number | null, signal: NodeJS.Signals | null): Promise<void> {
    this.stopProgressPolling()
    this.rc?.close()
    this.rc = undefined
    this.emit({ type: 'available', available: false })
    const detail = `VLC 进程异常退出（code=${code ?? 'unknown'}, signal=${signal ?? 'none'}）`
    if (this.config.vlcAutoRestart && this.restartAttempts < this.config.vlcRestartLimit) {
      this.restartAttempts++
      this.runtime = this.createRuntime('restarting', false, `${detail}，正在自动重启 ${this.restartAttempts}/${this.config.vlcRestartLimit}`)
      this.emitRuntime()
      await this.withLifecycle(async () => {
        await this.shutdownManaged()
        try {
          await this.startManaged('restarting')
          this.restartResetTimer = setTimeout(() => { this.restartAttempts = 0 }, 30_000)
        } catch (error) {
          this.failBackend(`${detail}，自动重启失败: ${messageOf(error)}`)
        }
      })
      return
    }
    this.failBackend(detail)
  }

  private startProgressPolling(): void {
    this.stopProgressPolling()
    this.progressTimer = setInterval(() => void this.pollProgress(), 1_000)
  }

  private stopProgressPolling(): void {
    if (this.progressTimer) clearInterval(this.progressTimer)
    this.progressTimer = undefined
  }

  private async pollProgress(): Promise<void> {
    const item = this.current
    const rc = this.rc
    if (!item || !rc?.isConnected() || this.paused) return
    try {
      const [timeOutput, statusOutput] = await Promise.all([rc.execute('get_time'), rc.execute('status')])
      if (this.current?.id !== item.id) return
      const seconds = parseRcNumber(timeOutput)
      const state = parseRcState(statusOutput)
      if (state === 'playing' && !this.observedPlaying) {
        this.observedPlaying = true
        this.emit({ type: 'playing', itemId: item.id })
      }
      if (seconds !== null) this.emit({ type: 'progress', itemId: item.id, position: Math.max(0, seconds * 1_000) })
      if (state === 'stopped' && this.observedPlaying && Date.now() - this.startedAt > 1_500) {
        this.current = undefined
        this.stopProgressPolling()
        this.emit({ type: 'ended', itemId: item.id })
      } else if (!this.observedPlaying && Date.now() - this.startedAt > this.config.playbackLoadTimeout * 1_000) {
        this.current = undefined
        this.stopProgressPolling()
        this.emit({ type: 'error', scope: 'track', itemId: item.id, message: `VLC 在 ${this.config.playbackLoadTimeout} 秒内未进入播放状态` })
      }
    } catch (error) {
      if (!this.process?.isRunning()) return
      this.emit({ type: 'error', scope: 'backend', message: `VLC RC 状态查询失败: ${messageOf(error)}` })
    }
  }

  private failBackend(message: string): void {
    this.runtime = this.createRuntime('error', false, message, message)
    this.emitRuntime()
    this.emit({ type: 'available', available: false })
    this.emit({ type: 'error', scope: 'backend', message })
    this.ctx.logger('bili-live-music').warn(message)
  }

  private createRuntime(status: PlaybackRuntimeState['status'], ready: boolean, detail: string, error: string | null = null): PlaybackRuntimeState {
    return { kind: this.kind, status, ready, detail, error, volume: this.currentVolume, executable: this.config.vlcExecutablePath, audioDevice: this.config.vlcAudioDevice || '系统默认' }
  }

  private emitRuntime(): void {
    this.emit({ type: 'runtime', state: this.getRuntimeState() })
  }

  private emit(event: PlaybackEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  private async withLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.lifecycle.then(operation, operation)
    this.lifecycle = task.then(() => undefined, () => undefined)
    return task
  }
}

async function connectWithRetry(rc: VlcRcClient, process: VlcProcessHost, timeout: number): Promise<void> {
  const deadline = Date.now() + timeout
  let lastError: unknown
  while (Date.now() < deadline) {
    if (!process.isRunning()) throw new Error('VLC 进程在 RC 连接建立前退出')
    try {
      await rc.connect(Math.min(1_000, Math.max(100, deadline - Date.now())))
      await rc.execute('status', 1_000)
      return
    } catch (error) {
      lastError = error
      rc.close()
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }
  throw new Error(`无法连接 VLC RC: ${messageOf(lastError)}`)
}

function describeVersionSupport(version: string): { supported: boolean; message: string } {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) return { supported: false, message: '版本格式未知' }
  const [major, minor, patch] = match.slice(1).map(Number)
  if (major === 3 && minor === 0 && patch >= 18 && patch <= 23) return { supported: true, message: '属于正式支持范围 3.0.18–3.0.23' }
  if (major === 3) return { supported: true, message: '属于 VLC 3 尽力支持范围' }
  if (major >= 4) return { supported: true, message: '属于 VLC 4 实验支持范围' }
  return { supported: false, message: '低于最低支持版本 VLC 3.0.0' }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function clampVolume(value: number): number {
  return Math.round(Math.max(0, Math.min(100, Number.isFinite(value) ? value : 100)))
}
