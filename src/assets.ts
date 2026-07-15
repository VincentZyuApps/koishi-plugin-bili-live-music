import { existsSync, readFileSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { Context } from 'koishi'

const PLUGIN_ASSET_DIR = 'bili-live-music'
const OVERLAY_TEMPLATE_PARTS = ['template', 'overlay.html'] as const

export function getRuntimeAssetsDir(baseDir: string): string {
  return path.join(baseDir, 'data', 'assets', PLUGIN_ASSET_DIR)
}

export function getRuntimeAssetPath(baseDir: string, relativeParts: readonly string[]): string {
  return path.join(getRuntimeAssetsDir(baseDir), ...relativeParts)
}

export function getDefaultAssetDisplayPath(relativeParts: readonly string[]): string {
  return getRuntimeAssetPath(process.cwd(), relativeParts)
}

export function getDefaultOverlayTemplateDisplayPath(): string {
  return getDefaultAssetDisplayPath(OVERLAY_TEMPLATE_PARTS)
}

export function getRuntimeOverlayTemplatePath(baseDir: string): string {
  return getRuntimeAssetPath(baseDir, OVERLAY_TEMPLATE_PARTS)
}

function getBundledAssetPath(relativeParts: readonly string[]): string {
  return path.resolve(__dirname, '../assets', ...relativeParts)
}

function isDefaultOverlayTemplatePath(ctx: Context, value: string): boolean {
  const normalized = path.resolve(value)
  return normalized === path.resolve(getDefaultOverlayTemplateDisplayPath())
    || normalized === path.resolve(getRuntimeOverlayTemplatePath(ctx.baseDir))
    || normalized === path.resolve(getBundledAssetPath(OVERLAY_TEMPLATE_PARTS))
}

export async function ensureSharedAssets(ctx: Context, configuredTemplatePath = ''): Promise<void> {
  const sourcePath = getBundledAssetPath(OVERLAY_TEMPLATE_PARTS)
  const targetPath = getRuntimeOverlayTemplatePath(ctx.baseDir)

  await mkdir(path.dirname(targetPath), { recursive: true })
  if (existsSync(targetPath)) {
    const usesDefaultTemplate = !configuredTemplatePath.trim() || isDefaultOverlayTemplatePath(ctx, configuredTemplatePath)
    const existing = readFileSync(targetPath, 'utf8')
    if (!usesDefaultTemplate || existing.includes('data-overlay-version="2"')) return
  }

  await copyFile(sourcePath, targetPath)
  ctx.logger('bili-live-music').info(`📦 已更新 OBS 模板: ${targetPath}`)
}

export function resolveOverlayTemplatePath(ctx: Context, configuredPath: string): string {
  const configured = configuredPath?.trim()
  if (!configured || isDefaultOverlayTemplatePath(ctx, configured)) {
    return getRuntimeOverlayTemplatePath(ctx.baseDir)
  }
  return path.isAbsolute(configured) ? configured : path.resolve(ctx.baseDir, configured)
}
