import type { Context } from 'koishi'
import type { AxiosInstance } from 'axios'
import type { Config } from '../config'
import type { LiveUser } from '../music/types'
import { prepareDanmuIdentity } from './identity'

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

export interface DanmuMessage {
  content: string
  user: LiveUser
}

export class BilibiliDanmuClient {
  private listener?: { close(): void }
  private stopping = false

  constructor(
    private ctx: Context,
    private config: Config,
    private http: AxiosInstance,
    private onDanmu: (message: DanmuMessage) => void | Promise<void>,
  ) {}

  async start(): Promise<void> {
    const logger = this.ctx.logger('bili-live-music')
    this.stopping = false
    if (!this.config.enabled) return
    if (!this.config.roomId) {
      logger.warn('未配置 B 站直播间号，跳过弹幕监听')
      return
    }
    if (!this.ctx.node?.import) {
      logger.warn('未检测到 w-node 服务，无法加载 blive-message-listener')
      return
    }

    const roomId = Number.parseInt(this.config.roomId, 10)
    if (!Number.isFinite(roomId) || roomId <= 0) {
      logger.warn(`直播间号非法: ${this.config.roomId}`)
      return
    }

    const blive = await this.ctx.node.import<BliveMessageListener>('blive-message-listener', {
      version: this.config.listenerVersion,
      allowInstall: true,
    })
    if (!blive?.startListen) {
      logger.warn('blive-message-listener 未提供 startListen')
      return
    }

    const identity = await prepareDanmuIdentity(this.http, this.config.cookie, this.config.uid, logger)
    logger.info(
      identity.anonymous
        ? `B 站匿名身份已就绪${identity.generatedBuvid ? '，已自动初始化 buvid3' : ''}`
        : `B 站登录身份已就绪，uid=${identity.uid}`,
    )

    let authenticated = false
    let preAuthCloseCount = 0

    const handler = {
      onOpen: () => logger.info(`B 站直播间 ${roomId} 弹幕连接已打开`),
      onStartListen: () => {
        authenticated = true
        preAuthCloseCount = 0
        logger.info(`B 站直播间 ${roomId} 弹幕认证成功，已开始监听`)
      },
      onClose: () => {
        if (this.stopping) return
        if (authenticated) {
          authenticated = false
          logger.warn(`B 站直播间 ${roomId} 弹幕连接已关闭，等待自动重连`)
          return
        }
        preAuthCloseCount++
        logger.warn(`B 站直播间 ${roomId} 在认证完成前断开（${preAuthCloseCount}/3）`)
        if (preAuthCloseCount < 3) return
        logger.error(`B 站直播间 ${roomId} 连续 3 次认证失败，已停止重连；请检查 Cookie、UID 或 B 站风控状态`)
        this.listener?.close()
        this.listener = undefined
      },
      onError: (error: unknown) => logger.warn(`B 站弹幕监听错误: ${error instanceof Error ? error.message : String(error)}`),
      onIncomeDanmu: ({ body }: any) => {
        const content = body?.content
        const user = body?.user
        if (!content || !user) return
        void this.onDanmu({
          content,
          user: {
            uid: String(user.uid ?? ''),
            name: String(user.uname ?? user.name ?? user.uid ?? 'unknown'),
            origin: 'bilibili',
          },
        })
      },
    }

    this.listener = blive.startListen(roomId, handler, {
      ws: { headers: identity.headers, uid: identity.uid },
    })
    logger.info(`B 站直播间 ${roomId} 弹幕监听已启动，listener=${this.config.listenerVersion}`)
  }

  stop(): void {
    this.stopping = true
    this.listener?.close()
    this.listener = undefined
  }
}
