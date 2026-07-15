import path from 'node:path'
import { Context } from 'koishi'
import { ensureSharedAssets, resolveOverlayTemplatePath } from './assets'
import { Config as PluginConfig } from './config'
import type { Config } from './config'
import { BilibiliDanmuClient } from './danmu/client'
import { parseSongRequest } from './danmu/parser'
import { createMusicProvider } from './music/provider'
import { createHttpClient } from './http'
import { BrowserPlayerAdapter } from './player/browser'
import { QueueManager } from './queue/manager'
import { SongRequestService } from './request/service'
import { registerConsoleApi } from './console/api'
import { startObsServer } from './server'

export const name = 'bili-live-music'
export const inject = ['node']

export { PluginConfig as Config }

export async function apply(ctx: Context, config: Config) {
  const logger = ctx.logger('bili-live-music')
  await ensureSharedAssets(ctx, config.overlayTemplatePath).catch((error) => {
    logger.warn(`OBS 模板资源初始化失败: ${error instanceof Error ? error.message : String(error)}`)
  })
  config.overlayTemplatePath = resolveOverlayTemplatePath(ctx, config.overlayTemplatePath)
  const http = createHttpClient()
  const provider = createMusicProvider(ctx, config, http)
  const player = new BrowserPlayerAdapter()
  const queue = new QueueManager(config, player)
  const requests = new SongRequestService(provider, queue)
  const releaseAvailability = player.onAvailabilityChange((available) => {
    void queue.handlePlayerAvailability(available)
  })
  const obsServer = await startObsServer(ctx, config, player, queue)

  registerConsoleApi(ctx, queue, requests, config, {
    dev: path.resolve(__dirname, '../client/index.ts'),
    prod: path.resolve(__dirname, '../dist'),
  })

  const danmu = new BilibiliDanmuClient(ctx, config, http, async (message) => {
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

  void danmu.start().catch((error) => {
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
    const state = queue.getState()
    const current = state.current
      ? `正在播放：${state.current.song.title} - ${state.current.song.artist}`
      : '当前没有播放中的歌曲'
    return `${current}\n队列剩余：${state.queue.length} 首\nOBS 主播放器：${player.isReady() ? '已连接' : '未连接'}`
  })
  ctx.command('bili-live-music.skip', '跳过当前歌曲', { authority: 3 }).action(async () => {
    await queue.skip()
    return '已跳过当前歌曲'
  })
  ctx.command('bili-live-music.clear', '清空点歌队列', { authority: 3 }).action(() => {
    queue.clear()
    return '已清空点歌队列'
  })
  ctx.command('bili-live-music.overlay', '查看 OBS 浏览器源路径', { authority: 3 }).action(() => {
    return [
      `OBS 主播放器：${obsServer.overlayUrl('player')}`,
      `OBS 展示端：${obsServer.overlayUrl('display')}`,
    ].join('\n')
  })

  ctx.on('dispose', async () => {
    danmu.stop()
    releaseAvailability()
    player.dispose()
    await obsServer.close()
  })
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
