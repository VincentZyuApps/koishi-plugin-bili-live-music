import { readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import type { Context } from 'koishi'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import websocket from '@fastify/websocket'
import type { Config } from '../config'
import { resolveOverlayTemplatePath } from '../assets'
import { BrowserPlayerAdapter, type BrowserSocket } from '../player/browser'
import { QueueManager } from '../queue/manager'

export interface ObsServer {
  close(): Promise<void>
  overlayUrl(mode?: 'player' | 'display'): string
}

export async function startObsServer(
  ctx: Context,
  config: Config,
  player: BrowserPlayerAdapter,
  queue: QueueManager,
): Promise<ObsServer> {
  validateConfig(config)
  const logger = ctx.logger('bili-live-music')
  const urls = createOverlayUrls(config)
  const app = Fastify({ logger: false })
  await app.register(websocket)

  app.get(config.overlayPath, async (request, reply) => {
    if (!hasValidToken(request, config.obsAccessToken)) {
      return reply.code(401).type('text/plain; charset=utf-8').send('Unauthorized: invalid OBS access token')
    }
    const mode = getQuery(request, 'mode') === 'display' ? 'display' : 'player'
    return reply.type('text/html; charset=utf-8').send(renderOverlay(ctx, config, mode))
  })

  app.get(config.wsPath, { websocket: true }, (socket, request) => {
    if (!hasValidToken(request, config.obsAccessToken)) {
      socket.close(1008, 'invalid OBS access token')
      return
    }

    const mode = getQuery(request, 'mode') === 'display' ? 'display' : 'player'
    const browserSocket = socket as BrowserSocket
    player.addSocket(browserSocket, mode)

    socket.addEventListener('message', (event) => {
      let message: any
      try {
        message = JSON.parse(event.data.toString())
      } catch {
        return
      }
      if (message.type === 'claim') {
        player.claim(browserSocket)
        return
      }
      if (message.type === 'ready') {
        player.broadcast(queue.getState())
        return
      }
      if (!player.isPrimary(browserSocket)) return
      if (message.type === 'ended') void queue.handleEnded()
      if (message.type === 'error') {
        logger.warn(`浏览器源播放失败: ${message.message || 'unknown error'}`)
        queue.handlePlayerError()
      }
    })
  })

  try {
    await app.listen({ host: config.obsServerHost, port: config.obsServerPort })
  } catch (error) {
    await closeQuietly(app)
    throw new Error(
      `OBS 独立服务无法监听 ${config.obsServerHost}:${config.obsServerPort}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  logger.info(`OBS 独立服务已启动: ${config.obsServerHost}:${config.obsServerPort}`)
  logger.info(`OBS 主播放器地址: ${urls.player}`)
  if (config.obsAccessToken === 'test12345') {
    logger.warn('OBS 服务仍在使用默认访问令牌 test12345，正式使用时请修改 obsAccessToken')
  }

  return {
    close: () => app.close(),
    overlayUrl: (mode = 'player') => urls[mode],
  }
}

export function createOverlayUrls(config: Config): Record<'player' | 'display', string> {
  const base = new URL(`http://${formatPublicHost(config.obsPublicHost)}:${config.obsServerPort}${config.overlayPath}`)
  if (config.obsAccessToken) base.searchParams.set('token', config.obsAccessToken)

  const player = new URL(base)
  player.searchParams.set('mode', 'player')
  const display = new URL(base)
  display.searchParams.set('mode', 'display')
  return { player: player.toString(), display: display.toString() }
}

function renderOverlay(ctx: Context, config: Config, mode: 'player' | 'display'): string {
  const templatePath = resolveOverlayTemplatePath(ctx, config.overlayTemplatePath)
  const template = readFileSync(templatePath, 'utf8')
  const wsUrl = new URL(config.wsPath, 'http://localhost')
  if (config.obsAccessToken) wsUrl.searchParams.set('token', config.obsAccessToken)
  wsUrl.searchParams.set('mode', mode)
  return template.replace('__WS_PATH__', JSON.stringify(`${wsUrl.pathname}${wsUrl.search}`))
}

function hasValidToken(request: FastifyRequest, expected: string): boolean {
  return !expected || getQuery(request, 'token') === expected
}

function getQuery(request: FastifyRequest, key: string): string {
  const query = request.query as Record<string, unknown>
  const value = query?.[key]
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
}

function validateConfig(config: Config): void {
  if (!config.obsServerHost.trim()) throw new Error('obsServerHost 不能为空')
  if (!Number.isInteger(config.obsServerPort) || config.obsServerPort < 1 || config.obsServerPort > 65535) {
    throw new Error(`obsServerPort 非法: ${config.obsServerPort}`)
  }
  if (!config.obsPublicHost.trim()) throw new Error('obsPublicHost 不能为空')
  for (const [name, value] of [['overlayPath', config.overlayPath], ['wsPath', config.wsPath]]) {
    if (!value.startsWith('/') || value.includes('?') || value.includes('#')) {
      throw new Error(`${name} 必须是以 / 开头且不含查询参数的路径`)
    }
  }
  if (config.overlayPath === config.wsPath) throw new Error('overlayPath 和 wsPath 不能相同')
}

function formatPublicHost(host: string): string {
  const value = host.trim()
  if (value.includes('://') || value.includes('/') || value.includes('?') || value.includes('#')) {
    throw new Error('obsPublicHost 只能填写 IP 或域名，不能包含协议、端口或路径')
  }
  const unwrapped = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value
  if (isIP(unwrapped) === 6) return `[${unwrapped}]`
  if (value.includes(':')) throw new Error('obsPublicHost 不能包含端口')
  return value
}

async function closeQuietly(app: FastifyInstance): Promise<void> {
  try {
    await app.close()
  } catch {}
}
