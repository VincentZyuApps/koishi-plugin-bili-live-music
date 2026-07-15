import { randomUUID } from 'node:crypto'
import type { Context } from 'koishi'
import { DataService } from '@koishijs/plugin-console'
import type { Config } from '../config'
import type { PlayerState, QueueSubmission, Song } from '../music/types'
import type { QueueMoveAction } from '../queue/manager'
import { QueueManager } from '../queue/manager'
import { SongRequestService } from '../request/service'

const SEARCH_TTL_MS = 5 * 60_000

export interface QueueConsoleState extends PlayerState {
  provider: string
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
    'bili-live-music/skip'(): Promise<boolean>
    'bili-live-music/clear'(): Promise<boolean>
  }
}

class QueueStateService extends DataService<QueueConsoleState> {
  constructor(
    ctx: Context,
    private queue: QueueManager,
    private requests: SongRequestService,
  ) {
    super(ctx, 'bili-live-music', { immediate: true })
  }

  async get(): Promise<QueueConsoleState> {
    return { ...this.queue.getState(), provider: this.requests.describeProvider() }
  }
}

export function registerConsoleApi(
  ctx: Context,
  queue: QueueManager,
  requests: SongRequestService,
  config: Config,
  entry: { dev: string; prod: string },
) {
  ctx.inject(['console'], (ctx) => {
    ctx.console.addEntry(entry)

    const dataService = new QueueStateService(ctx, queue, requests)
    const releaseState = queue.onStateChange(() => void dataService.refresh())
    const searches = new Map<string, { expiresAt: number; songs: Song[] }>()

    ctx.console.addListener('bili-live-music/state', async () => dataService.get(), { authority: 0 })
    ctx.console.addListener('bili-live-music/search', async ({ keyword }) => {
      const normalized = keyword?.trim()
      if (!normalized) throw new Error('搜索关键词不能为空')
      pruneSearches(searches)
      const songs = await requests.search(normalized, config.webuiSearchLimit)
      const searchId = randomUUID()
      searches.set(searchId, { expiresAt: Date.now() + SEARCH_TTL_MS, songs })
      return { searchId, songs }
    }, { authority: 0 })
    ctx.console.addListener('bili-live-music/add', async ({ searchId, index }) => {
      const search = searches.get(searchId)
      if (!search || search.expiresAt < Date.now()) {
        searches.delete(searchId)
        throw new Error('搜索结果已过期，请重新搜索')
      }
      const candidate = search.songs[index]
      if (!candidate) throw new Error('搜索结果序号无效')
      return requests.requestCandidate(candidate, {
        uid: 'webui',
        name: 'WebUI 管理员',
        origin: 'webui',
      }, { bypassUserLimits: true })
    }, { authority: 0 })
    ctx.console.addListener('bili-live-music/remove', async ({ id }) => {
      return queue.removeOrSkip(id)
    }, { authority: 0 })
    ctx.console.addListener('bili-live-music/move', async ({ id, action }) => {
      if (!['top', 'up', 'down'].includes(action)) throw new Error('队列移动操作无效')
      return queue.move(id, action)
    }, { authority: 0 })
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
      searches.clear()
    })
  })
}

function pruneSearches(searches: Map<string, { expiresAt: number }>): void {
  const now = Date.now()
  for (const [id, search] of searches) {
    if (search.expiresAt < now) searches.delete(id)
  }
}
