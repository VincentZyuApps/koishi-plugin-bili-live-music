import type { Context } from 'koishi'
import type { AxiosInstance } from 'axios'
import type { Config } from '../config'
import { prepareDanmuIdentity } from './identity'
import type { DanmuConnectionAdapter, DanmuConnectionCallbacks, DanmuIdentityMode, DanmuMessage } from './types'

declare module 'koishi' {
  interface Context {
    node?: {
      import<T>(packageName: string, options?: {
        allowInstall?: boolean
        useRequire?: boolean
        version?: string
      }): Promise<T>
    }
  }
}

interface BliveMessageListener {
  startListen(roomId: number, handler: Record<string, unknown>, options?: Record<string, unknown>): {
    close(): void
  }
}

const DANMU_DEDUPE_WINDOW = 3_000

export class DanmuDeduplicator {
  private recent = new Map<string, number>()

  constructor(private windowMs = DANMU_DEDUPE_WINDOW) {}

  accept(key: string, now = Date.now()): boolean {
    const lastSeen = this.recent.get(key)
    if (lastSeen !== undefined && now - lastSeen < this.windowMs) return false
    this.recent.set(key, now)
    for (const [storedKey, timestamp] of this.recent) {
      if (now - timestamp >= this.windowMs) this.recent.delete(storedKey)
    }
    return true
  }

  clear(): void {
    this.recent.clear()
  }
}

export class BilibiliDanmuConnection implements DanmuConnectionAdapter {
  private listener?: { close(): void }
  private blive?: BliveMessageListener
  private identity?: Awaited<ReturnType<typeof prepareDanmuIdentity>>
  private operation = 0
  private deduplicator = new DanmuDeduplicator()

  constructor(
    private ctx: Context,
    private config: Config,
    private http: AxiosInstance,
    private onDanmu: (message: DanmuMessage) => void | Promise<void>,
  ) {}

  async connect(callbacks: DanmuConnectionCallbacks): Promise<DanmuIdentityMode> {
    this.stop()
    const operation = this.operation
    const roomId = Number.parseInt(this.config.roomId, 10)
    const blive = this.blive ?? await this.loadListener()
    this.assertCurrent(operation)
    this.blive = blive
    const identity = this.identity ?? await prepareDanmuIdentity(
      this.http,
      this.config.cookie,
      this.config.uid,
      this.ctx.logger('bili-live-music'),
    )
    this.assertCurrent(operation)
    this.identity = identity

    const handler = {
      onOpen: () => callbacks.onOpen(),
      onStartListen: () => callbacks.onConnected(),
      onClose: () => callbacks.onClose(),
      onError: (error: unknown) => callbacks.onError(error),
      onIncomeDanmu: ({ body }: any) => this.handleDanmu(body),
    }
    this.listener = blive.startListen(roomId, handler, {
      ws: { headers: identity.headers, uid: identity.uid },
    })
    return identity.anonymous ? 'anonymous' : 'authenticated'
  }

  stop(): void {
    this.operation++
    const listener = this.listener
    this.listener = undefined
    listener?.close()
  }

  dispose(): void {
    this.stop()
    this.deduplicator.clear()
    this.blive = undefined
    this.identity = undefined
  }

  private async loadListener(): Promise<BliveMessageListener> {
    if (!this.ctx.node?.import) throw new Error('未检测到 w-node 服务')
    const blive = await this.ctx.node.import<BliveMessageListener>('blive-message-listener', {
      version: this.config.listenerVersion,
      allowInstall: true,
    })
    if (!blive?.startListen) throw new Error('blive-message-listener 未提供 startListen')
    return blive
  }

  private assertCurrent(operation: number): void {
    if (operation !== this.operation) throw new Error('弹幕连接已取消')
  }

  private handleDanmu(body: any): void {
    const content = body?.content
    const user = body?.user
    if (!content || !user) return
    const messageId = body.idStr ?? body.id ?? body.dmid ?? body.dm_id
    const dedupeKey = messageId
      ? `id:${messageId}`
      : `content:${String(user.uid ?? '')}:${String(user.uname ?? user.name ?? '')}:${content}`
    if (!this.deduplicator.accept(dedupeKey)) return
    void this.onDanmu({
      content,
      user: {
        uid: String(user.uid ?? ''),
        name: String(user.uname ?? user.name ?? user.uid ?? 'unknown'),
        origin: 'bilibili',
      },
    })
  }
}
