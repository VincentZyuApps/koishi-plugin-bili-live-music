import path from 'node:path'
import { Context } from 'koishi'
import { ensureSharedAssets, resolveOverlayTemplatePath } from './assets'
import { Config as PluginConfig, normalizeConfig } from './config'
import type { Config } from './config'
import { BilibiliDanmuManager } from './danmu/manager'
import type { DanmuReconnectResult, DanmuRuntimeState } from './danmu/types'
import { parseSongRequest } from './danmu/parser'
import { createMusicProvider } from './music/provider'
import { createHttpClient } from './http'
import { OverlayHub } from './overlay/hub'
import { createPlaybackManager } from './player/factory'
import type { PlaybackManager } from './player/manager'
import { QueueManager } from './queue/manager'
import { SongRequestService } from './request/service'
import { registerConsoleApi } from './console/api'
import { startObsServer } from './server'
import { acquireObsServerLease } from './server/lease'
import { ensureFont, resolveFontPath } from './font'

export const name = 'bili-live-music'
export const inject = ['node']

export { PluginConfig as Config }

export async function apply(ctx: Context, inputConfig: Config) {
  const config = normalizeConfig(inputConfig)
  const logger = ctx.logger('bili-live-music')
  let disposed = false
  let player: PlaybackManager | undefined
  let hub: OverlayHub | undefined
  let queue: QueueManager | undefined
  let releaseState: (() => void) | undefined
  let releaseControls: (() => void) | undefined
  let releaseObsServerLease: (() => void) | undefined
  let obsServer: Awaited<ReturnType<typeof startObsServer>> | undefined
  let obsServerStarting = false
  let danmu: BilibiliDanmuManager | undefined

  // Bind external Fastify/listener cleanup before the first await because HMR
  // can dispose this plugin context while asynchronous startup is still running,
  // This prevents an orphaned Fastify listener from retaining the OBS port.
  ctx.on('dispose', async () => {
    disposed = true
    danmu?.dispose()
    releaseState?.()
    releaseControls?.()
    queue?.dispose()
    queue = undefined
    await player?.dispose()
    player = undefined
    hub?.dispose()
    hub = undefined
    const server = obsServer
    obsServer = undefined
    if (!server && obsServerStarting) return
    try {
      await server?.close()
    } finally {
      releaseObsServerLease?.()
      releaseObsServerLease = undefined
    }
  })

  await ensureSharedAssets(ctx, config.overlayTemplatePath).catch((error) => {
    logger.warn(`OBS 模板资源初始化失败: ${error instanceof Error ? error.message : String(error)}`)
  })
  if (disposed) return
  config.overlayTemplatePath = resolveOverlayTemplatePath(ctx, config.overlayTemplatePath)
  const http = createHttpClient()
  config.fontPath = resolveFontPath(ctx, config.fontPath)
  await ensureFont(ctx, http, config.fontPath)
  if (disposed) return
  const provider = createMusicProvider(ctx, config, http)
  const activeHub = new OverlayHub(config.playbackBackend, config.playbackVolume)
  hub = activeHub
  const activePlayer = createPlaybackManager(ctx, config, activeHub)
  player = activePlayer
  const activeQueue = new QueueManager(config, activePlayer)
  queue = activeQueue
  const requests = new SongRequestService(provider, activeQueue)
  const activeDanmu = new BilibiliDanmuManager(ctx, config, http, async (message) => {
    const request = parseSongRequest(message.content, message.user, config.commandPrefix)
    if (!request) return

    logger.info(`收到点歌: ${request.user.name}(${request.user.uid}) -> ${request.keyword}`)
    try {
      const result = await requests.requestByKeyword(request.keyword, request.user)
      logger.info(`已加入队列: ${result.item.song.title} - ${result.item.song.artist}`)
    } catch (error) {
      logger.warn(`点歌失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
  danmu = activeDanmu
  releaseState = activeQueue.onStateChange(state => activeHub.publish(state))
  releaseControls = activeHub.onControl(control => {
    if (control === 'previous') void activeQueue.previous()
    if (control === 'next') void activeQueue.skip()
    if (control === 'pause') void activeQueue.pause()
    if (control === 'resume') void activeQueue.resume()
  })
  const releaseLease = await acquireObsServerLease(config.obsServerHost, config.obsServerPort)
  if (disposed) {
    releaseLease()
    return
  }
  releaseObsServerLease = releaseLease
  let startedObsServer: Awaited<ReturnType<typeof startObsServer>>
  obsServerStarting = true
  try {
    startedObsServer = await startObsServer(ctx, config, activeHub)
  } catch (error) {
    obsServerStarting = false
    releaseObsServerLease()
    releaseObsServerLease = undefined
    throw error
  }
  obsServerStarting = false
  if (disposed) {
    try {
      await startedObsServer.close()
    } finally {
      releaseObsServerLease()
      releaseObsServerLease = undefined
    }
    return
  }
  obsServer = startedObsServer

  await activePlayer.start()
  if (disposed) return

  registerConsoleApi(ctx, activeQueue, activePlayer, activeDanmu, requests, config, startedObsServer.fontUrl(), {
    dev: path.resolve(__dirname, '../client/index.ts'),
    prod: path.resolve(__dirname, '../dist'),
  })

  void activeDanmu.start().catch((error) => {
    logger.warn(`B 站弹幕监听启动失败: ${error instanceof Error ? error.message : String(error)}`)
  })

  ctx.command('bili-live-music', 'B 站直播点歌')
  if (config.botRequestContexts.length) {
    ctx.command('bili-live-music.request <keyword:text>', '向直播点歌队列添加歌曲', { authority: 0 })
      .action(async ({ session }, keyword) => {
        if (!keyword?.trim()) return '💡 请输入歌名，例如：bili-live-music.request 晴天'
        const context = session.isDirect ? 'private' : 'group'
        if (!config.botRequestContexts.includes(context)) {
          return session.isDirect
            ? '⛔ 当前未启用私聊点歌'
            : '⛔ 当前未启用群聊点歌'
        }

        const requester = {
          uid: `bot:${session.platform}:${session.userId}`,
          name: session.author?.nickname || session.author?.username || session.username || session.userId,
          origin: session.isDirect ? 'bot-private' as const : 'bot-group' as const,
        }
        try {
          const result = await requests.requestByKeyword(keyword.trim(), requester)
          return formatSubmission(result)
        } catch (error) {
          return `❌ 点歌失败：${error instanceof Error ? error.message : String(error)}`
        }
      })
  }
  ctx.command('bili-live-music.status', '查看点歌队列状态').action(() => {
    const state = activeQueue.getState()
    const current = state.current
      ? `正在播放：${state.current.song.title} - ${state.current.song.artist}`
      : '当前没有播放中的歌曲'
    const backend = activePlayer.kind === 'vlc' ? 'VLC' : 'OBS 浏览器'
    return `${current}\n队列剩余：${state.queue.length} 首\n${backend} 播放器：${activePlayer.isReady() ? '已就绪' : '未就绪'}`
  })
  ctx.command('bili-live-music.danmu.status', '查看 B 站弹幕监听状态', { authority: 3 }).action(() => {
    return formatDanmuStatus(activeDanmu.getState())
  })
  ctx.command('bili-live-music.danmu.reconnect', '重新连接 B 站弹幕监听', { authority: 3 }).action(async () => {
    return formatDanmuReconnect(await activeDanmu.reconnect())
  })
  ctx.command('bili-live-music.skip', '跳过当前歌曲', { authority: 3 }).action(async () => {
    await activeQueue.skip()
    return '已跳过当前歌曲'
  })
  ctx.command('bili-live-music.clear', '清空点歌队列', { authority: 3 }).action(() => {
    activeQueue.clear()
    return '已清空点歌队列'
  })
  ctx.command('bili-live-music.overlay', '查看 OBS 浏览器源路径', { authority: 3 }).action(() => {
    const message = [
      `🎧 OBS 主播放器（标准）\n${startedObsServer.overlayUrl('player', 'standard')}`,
      `🪶 OBS 展示端（迷你）\n${startedObsServer.overlayUrl('display', 'mini')}`,
      `🖼️ OBS 展示端（标准）\n${startedObsServer.overlayUrl('display', 'standard')}`,
      `📋 OBS 展示端（侧栏）\n${startedObsServer.overlayUrl('display', 'sidebar')}`,
    ].join('\n\n')
    logger.info(`OBS 浏览器源地址：\n${message}`)
    if (config.overlayCommandConsoleOnly) return '🖥️ 请前往 Koishi Console 查看 OBS 浏览器源地址。'
    return message
  })
}

function formatDanmuStatus(state: DanmuRuntimeState): string {
  const lines = [
    '📡 B 站弹幕监听状态',
    `房间号：${state.roomId || '未配置'}`,
    `状态：${state.state}`,
    `身份：${formatDanmuIdentity(state.identity)}`,
    `连接尝试：${state.attempt} 次`,
    `连续失败：${state.failureCount} 次`,
  ]
  if (state.connectedAt) lines.push(`连接时间：${new Date(state.connectedAt).toLocaleString('zh-CN')}`)
  if (state.nextRetryAt) lines.push(`下次重试：${Math.max(0, Math.ceil((state.nextRetryAt - Date.now()) / 1_000))} 秒后`)
  if (state.lastError) lines.push(`最后错误：${state.lastError}`)
  return lines.join('\n')
}

function formatDanmuReconnect(result: DanmuReconnectResult): string {
  const state = result.state
  const title = result.ok ? '✅ B 站弹幕重连成功' : state.state === 'waiting' ? '⚠️ B 站弹幕重连失败' : '⛔ B 站弹幕无法重连'
  const lines = [
    title,
    `房间号：${state.roomId || '未配置'}`,
    `状态：${state.state}`,
    `耗时：${(result.elapsed / 1_000).toFixed(1)} 秒`,
  ]
  if (state.failureCount) lines.push(`连续失败：${state.failureCount} 次`)
  if (state.nextRetryAt) lines.push(`下次重试：${Math.max(0, Math.ceil((state.nextRetryAt - Date.now()) / 1_000))} 秒后`)
  if (state.lastError) lines.push(`最后错误：${state.lastError}`)
  return lines.join('\n')
}

function formatDanmuIdentity(identity: DanmuRuntimeState['identity']): string {
  return identity === 'authenticated' ? '登录身份' : identity === 'anonymous' ? '匿名身份' : '尚未确定'
}

function formatSubmission(result: Awaited<ReturnType<SongRequestService['requestByKeyword']>>): string {
  const sourceLabels = { netease: '网易云音乐', tencent: 'QQ 音乐', kugou: '酷狗音乐' }
  const position = result.startedPlaying
    ? '▶️ 播放状态：已开始播放'
    : `📍 当前排队位置：${result.queuePosition}\n⏳ 前方还有：${result.aheadCount} 首`
  return [
    `🎵 已加入点歌队列：${result.item.song.title} - ${result.item.song.artist}`,
    `🎧 音乐来源：${sourceLabels[result.item.song.source]}`,
    position,
    `👤 点歌人：${result.item.requester.name}`,
  ].join('\n')
}
