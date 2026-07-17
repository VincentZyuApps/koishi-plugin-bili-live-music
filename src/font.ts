import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AxiosInstance } from 'axios'
import type { Context } from 'koishi'
import { getDefaultAssetDisplayPath, getRuntimeAssetPath } from './assets'

export const FONT_FILE_NAME = 'LXGWWenKaiMono-Regular.ttf'
export const FONT_ROUTE = '/bili-live-music/assets/lxgw-wenkai.ttf'

const FONT_SIZE = 24_755_236
const FONT_SHA256 = 'ee9faa6479c5b2434f9bceca8e2e7b643f699f4f3d067aac9609261e07c6be61'
const FONT_PARTS = ['fonts', FONT_FILE_NAME] as const
const FONT_SOURCES = [
  {
    name: 'Gitee',
    url: `https://gitee.com/vincent-zyu/koishi-plugin-awa-quote-image/releases/download/fonts/${FONT_FILE_NAME}`,
  },
  {
    name: 'GitHub',
    url: `https://github.com/VincentZyuApps/koishi-plugin-awa-quote-image/releases/download/fonts/${FONT_FILE_NAME}`,
  },
] as const

export function getDefaultFontDisplayPath(): string {
  return getDefaultAssetDisplayPath(FONT_PARTS)
}

export function getRuntimeFontPath(baseDir: string): string {
  return getRuntimeAssetPath(baseDir, FONT_PARTS)
}

export function resolveFontPath(ctx: Context, configuredPath: string): string {
  const configured = configuredPath?.trim()
  const displayPath = path.resolve(getDefaultFontDisplayPath())
  const runtimePath = path.resolve(getRuntimeFontPath(ctx.baseDir))
  if (!configured || path.resolve(configured) === displayPath || path.basename(configured) === FONT_FILE_NAME) {
    return runtimePath
  }
  return path.isAbsolute(configured) ? configured : path.resolve(ctx.baseDir, configured)
}

export async function ensureFont(ctx: Context, http: AxiosInstance, fontPath: string): Promise<boolean> {
  const logger = ctx.logger('bili-live-music')
  if (await verifyFont(fontPath)) {
    logger.info(`字体文件已存在且校验通过: ${fontPath}`)
    return true
  }

  await mkdir(path.dirname(fontPath), { recursive: true })
  if (existsSync(fontPath)) logger.warn(`字体文件校验失败，将重新下载: ${fontPath}`)

  let lastError: unknown
  for (const source of FONT_SOURCES) {
    try {
      logger.info(`正在从 ${source.name} 下载字体: ${FONT_FILE_NAME}`)
      const response = await http.get<ArrayBuffer>(source.url, {
        responseType: 'arraybuffer',
        timeout: 60_000,
      })
      const buffer = Buffer.from(response.data)
      if (!verifyBuffer(buffer)) throw new Error('字体文件大小或 SHA-256 校验失败')
      await writeFile(fontPath, buffer)
      if (!await verifyFont(fontPath)) throw new Error('字体写入后校验失败')
      logger.info(`字体下载完成并校验通过: ${fontPath}`)
      return true
    } catch (error) {
      lastError = error
      logger.warn(`${source.name} 字体下载失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  logger.warn(`霞鹜文楷不可用，将回退到系统字体: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
  return false
}

async function verifyFont(filePath: string): Promise<boolean> {
  if (!existsSync(filePath)) return false
  try {
    return verifyBuffer(await readFile(filePath))
  } catch {
    return false
  }
}

function verifyBuffer(buffer: Buffer): boolean {
  if (buffer.length !== FONT_SIZE) return false
  return createHash('sha256').update(buffer).digest('hex') === FONT_SHA256
}
