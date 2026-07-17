import { randomUUID } from 'node:crypto'
import type { Context } from 'koishi'
import { DataService } from '@koishijs/plugin-console'
import type { Config } from '../config'
import type { PlayerState, QueueSubmission, Song } from '../music/types'
import type { QueueMoveAction } from '../queue/manager'
import { QueueManager } from '../queue/manager'
import { SongRequestService } from '../request/service'
import { logInfo } from '../utils/logger'

const SEARCH_TTL_MS = 5 * 60_000

export interface QueueConsoleState extends PlayerState {
  provider: string
  fontUrl: string
  playerReady: boolean
}

export interface SearchResponse {
  searchId: string
  songs: Song[]
}

declare module '@koishijs/plugin-console' {
  namespace Console {
    interface Services {
      'bili-live-music': QueueConsoleState
    }
  }

  interface Events {
    'bili-live-music/state'(): Promise<QueueConsoleState>
    'bili-live-music/search'(params: { keyword: string }): Promise<SearchResponse>
    'bili-live-music/add'(params: { searchId: string; index: number }): Promise<QueueSubmission>
    'bili-live-music/remove'(params: { id: string }): Promise<boolean>
    'bili-live-music/move'(params: { id: string; action: QueueMoveAction }): Promise<boolean>
    'bili-live-music/previous'(): Promise<boolean>
    'bili-live-music/start'(): Promise<boolean>
    'bili-live-music/pause'(): Promise<boolean>
    'bili-live-music/resume'(): Promise<boolean>
    'bili-live-music/skip'(): Promise<boolean>
    'bili-live-music/clear'(): Promise<boolean>
  }
}

class QueueStateService extends DataService<QueueConsoleState> {
  private searches = new Map<string, { expiresAt: number; songs: Song[] }>()

  constructor(
    ctx: Context,
    private deps: {
      queue: QueueManager
      requests: SongRequestService
      config: Config
      fontUrl: string
      entry: { dev: string; prod: string }
    },
  ) {
    super(ctx, 'bili-live-music', { immediate: true })
    const { queue, requests, config, entry } = deps
    ctx.console.addEntry(entry)

    const releaseState = queue.onStateChange(() => void this.refresh())
    ctx.console.addListener('bili-live-music/state', async () => this.get(), { authority: 0 })
    ctx.console.addListener('bili-live-music/search', async ({ keyword }) => {
      const normalized = keyword?.trim()
      if (!normalized) throw new Error('搜索关键词不能为空')
      pruneSearches(this.searches)
      const startedAt = Date.now()
      logInfo(
        ctx,
        config,
        `🔍 WebUI 开始搜索：${normalized}`,
        `🔎 [WebUI:搜索参数] keyword=${JSON.stringify(normalized)}, limit=${config.webuiSearchLimit}, provider=${requests.describeProvider()}`,
      )
      const songs = await requests.search(normalized, config.webuiSearchLimit)
      const searchId = randomUUID()
      this.searches.set(searchId, { expiresAt: Date.now() + SEARCH_TTL_MS, songs })
      logInfo(
        ctx,
        config,
        `✅ WebUI 搜索完成：${normalized}，共 ${songs.length} 条结果，耗时 ${Date.now() - startedAt}ms`,
        `🔎 [WebUI:搜索结果] searchId=${shortId(searchId)}, candidates=${songs.map(formatCandidate).join(' | ') || 'none'}`,
      )
      return { searchId, songs }
    }, { authority: 0 })
    ctx.console.addListener('bili-live-music/add', async ({ searchId, index }) => {
      const search = this.searches.get(searchId)
      if (!search || search.expiresAt < Date.now()) {
        this.searches.delete(searchId)
        throw new Error('搜索结果已过期，请重新搜索')
      }
      const candidate = search.songs[index]
      if (!candidate) throw new Error('搜索结果序号无效')
      const startedAt = Date.now()
      logInfo(
        ctx,
        config,
        `➕ WebUI 尝试加入：${candidate.title} - ${candidate.artist}`,
        `🔎 [WebUI:加入参数] searchId=${shortId(searchId)}, index=${index}, candidate=${formatCandidate(candidate)}`,
      )
      try {
        const result = await requests.requestCandidate(candidate, {
          uid: 'webui',
          name: 'WebUI 管理员',
          origin: 'webui',
        }, { bypassUserLimits: true })
        logInfo(
          ctx,
          config,
          `✅ WebUI 已加入队列：${candidate.title} - ${candidate.artist}`,
          `🔎 [WebUI:加入结果] searchId=${shortId(searchId)}, index=${index}, elapsed=${Date.now() - startedAt}ms, queueItem=${result.item.id}`,
        )
        return result
      } catch (error) {
        logInfo(
          ctx,
          config,
          `[WARN] WebUI 加入失败：${candidate.title} - ${candidate.artist}，${errorMessage(error)}`,
          `🔎 [WebUI:加入失败详情] searchId=${shortId(searchId)}, index=${index}, candidate=${formatCandidate(candidate)}, elapsed=${Date.now() - startedAt}ms`,
        )
        throw error
      }
    }, { authority: 0 })
    ctx.console.addListener('bili-live-music/remove', async ({ id }) => {
      return queue.removeOrSkip(id)
    }, { authority: 0 })
    ctx.console.addListener('bili-live-music/move', async ({ id, action }) => {
      if (!['top', 'up', 'down'].includes(action)) throw new Error('队列移动操作无效')
      return queue.move(id, action)
    }, { authority: 0 })
    ctx.console.addListener('bili-live-music/previous', async () => queue.previous(), { authority: 0 })
    ctx.console.addListener('bili-live-music/start', async () => queue.start(), { authority: 0 })
    ctx.console.addListener('bili-live-music/pause', async () => queue.pause(), { authority: 0 })
    ctx.console.addListener('bili-live-music/resume', async () => queue.resume(), { authority: 0 })
    ctx.console.addListener('bili-live-music/skip', async () => {
      await queue.skip()
      return true
    }, { authority: 0 })
    ctx.console.addListener('bili-live-music/clear', async () => {
      queue.clear()
      return true
    }, { authority: 0 })

    ctx.on('dispose', () => {
      releaseState()
      this.searches.clear()
    })
  }

  async get(): Promise<QueueConsoleState> {
    return {
      ...this.deps.queue.getState(),
      provider: this.deps.requests.describeProvider(),
      fontUrl: this.deps.fontUrl,
      playerReady: this.deps.queue.isPlayerReady(),
    }
  }
}

export function registerConsoleApi(
  ctx: Context,
  queue: QueueManager,
  requests: SongRequestService,
  config: Config,
  fontUrl: string,
  entry: { dev: string; prod: string },
) {
  ctx.plugin(QueueStateService, { queue, requests, config, fontUrl, entry })
}

function pruneSearches(searches: Map<string, { expiresAt: number }>): void {
  const now = Date.now()
  for (const [id, search] of searches) {
    if (search.expiresAt < now) searches.delete(id)
  }
}

function shortId(value: string): string {
  return value.slice(0, 8)
}

function formatCandidate(song: Song): string {
  const identifiers = [
    song.id && `id=${song.id}`,
    song.mid && `mid=${song.mid}`,
    song.hash && `hash=${song.hash}`,
    song.hqHash && `hqHash=${song.hqHash}`,
    song.sqHash && `sqHash=${song.sqHash}`,
    song.albumId && `albumId=${song.albumId}`,
    song.albumAudioId && `albumAudioId=${song.albumAudioId}`,
  ].filter(Boolean).join(',') || 'no-id'
  return `${song.source}:${JSON.stringify(song.title)}-${JSON.stringify(song.artist)}(${identifiers},url=${song.url ? 'yes' : 'no'})`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
