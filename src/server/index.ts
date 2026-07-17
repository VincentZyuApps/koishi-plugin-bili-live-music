import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import type { Context } from 'koishi'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import websocket from '@fastify/websocket'
import type { Config } from '../config'
import { resolveOverlayTemplatePath } from '../assets'
import { OverlayHub } from '../overlay/hub'
import type { OverlayClientMessage, OverlaySocket } from '../overlay/protocol'
import { FONT_ROUTE } from '../font'

export type OverlayMode = 'player' | 'display'
export type OverlayLayout = 'mini' | 'standard' | 'sidebar'

export interface ObsServer {
  close(): Promise<void>
  overlayUrl(mode?: OverlayMode, layout?: OverlayLayout): string
  fontUrl(): string
}

export async function startObsServer(
  ctx: Context,
  config: Config,
  hub: OverlayHub,
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
    const mode = parseMode(getQuery(request, 'mode'))
    const layout = parseLayout(getQuery(request, 'layout'))
    return reply.type('text/html; charset=utf-8').send(renderOverlay(ctx, config, mode, layout))
  })

  app.get(FONT_ROUTE, async (_request, reply) => {
    if (!existsSync(config.fontPath)) return reply.code(404).send('Font unavailable')
    return reply
      .header('Access-Control-Allow-Origin', '*')
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .type('font/ttf')
      .send(createReadStream(config.fontPath))
  })

  app.get(config.wsPath, { websocket: true }, (socket, request) => {
    if (!hasValidToken(request, config.obsAccessToken)) {
      socket.close(1008, 'invalid OBS access token')
      return
    }

    const mode = parseMode(getQuery(request, 'mode'))
    const overlaySocket = socket as OverlaySocket
    const role = hub.addSocket(overlaySocket, mode)
    logger.info(`🎧 OBS 页面已连接: mode=${mode}，role=${role}`)
    socket.addEventListener('close', () => {
      logger.info(`🔌 OBS 页面已断开: mode=${mode}`)
    })

    socket.addEventListener('message', (event) => {
      let message: OverlayClientMessage
      try {
        message = JSON.parse(event.data.toString()) as OverlayClientMessage
      } catch {
        return
      }
      const accepted = hub.receive(overlaySocket, message)
      if (message.type === 'claim') logger.info(`🎧 OBS 页面请求接管主播放器: ${accepted ? '成功' : '失败'}`)
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
    overlayUrl: (mode = 'player', layout = 'standard') => createOverlayUrl(config, mode, layout),
    fontUrl: () => createFontUrl(config),
  }
}

export function createOverlayUrls(config: Config): Record<'player' | 'display', string> {
  return {
    player: createOverlayUrl(config, 'player', 'standard'),
    display: createOverlayUrl(config, 'display', 'standard'),
  }
}

export function createOverlayUrl(config: Config, mode: OverlayMode, layout: OverlayLayout): string {
  const url = new URL(`http://${formatPublicHost(config.obsPublicHost)}:${config.obsServerPort}${config.overlayPath}`)
  if (config.obsAccessToken) url.searchParams.set('token', config.obsAccessToken)
  url.searchParams.set('mode', mode)
  url.searchParams.set('layout', layout)
  return url.toString()
}

export function createFontUrl(config: Config): string {
  return new URL(`http://${formatPublicHost(config.obsPublicHost)}:${config.obsServerPort}${FONT_ROUTE}`).toString()
}

function renderOverlay(ctx: Context, config: Config, mode: OverlayMode, layout: OverlayLayout): string {
  const templatePath = resolveOverlayTemplatePath(ctx, config.overlayTemplatePath)
  const template = readFileSync(templatePath, 'utf8')
  const wsUrl = new URL(config.wsPath, 'http://localhost')
  if (config.obsAccessToken) wsUrl.searchParams.set('token', config.obsAccessToken)
  wsUrl.searchParams.set('mode', mode)
  return template
    .replace('__WS_PATH__', JSON.stringify(`${wsUrl.pathname}${wsUrl.search}`))
    .replace('__FONT_URL__', JSON.stringify(createFontUrl(config)))
    .replace('__LAYOUT__', JSON.stringify(layout))
}

function parseMode(value: string): OverlayMode {
  return value === 'display' ? 'display' : 'player'
}

function parseLayout(value: string): OverlayLayout {
  return value === 'mini' || value === 'sidebar' ? value : 'standard'
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
