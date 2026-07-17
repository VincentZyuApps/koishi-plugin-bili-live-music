import type { MusicProvider } from '../music/provider'
import type { LiveUser, QueueSubmission, Song } from '../music/types'
import { QueueManager } from '../queue/manager'

export interface RequestOptions {
  bypassUserLimits?: boolean
}

export class SongRequestService {
  constructor(
    private provider: MusicProvider,
    private queue: QueueManager,
  ) {}

  describeProvider(): string {
    return this.provider.describe()
  }

  search(keyword: string, limit: number): Promise<Song[]> {
    return this.provider.search(keyword, limit)
  }

  async requestByKeyword(
    keyword: string,
    requester: LiveUser,
    options: RequestOptions = {},
  ): Promise<QueueSubmission> {
    const song = await this.provider.query(keyword)
    if (!song?.url) throw new Error(`未找到可播放歌曲: ${keyword}`)
    return this.enqueue(song, requester, keyword, options)
  }

  async requestCandidate(
    candidate: Song,
    requester: LiveUser,
    options: RequestOptions = {},
  ): Promise<QueueSubmission> {
    let song: Song | null
    try {
      song = candidate.url ? candidate : await this.provider.resolve(candidate)
    } catch (error) {
      throw new Error(
        `所选版本暂时无法播放：${candidate.title} - ${candidate.artist}；请尝试其他搜索结果或切换音乐 API。${error instanceof Error ? ` 原因：${error.message}` : ''}`,
      )
    }
    if (!song?.url) {
      throw new Error(`所选版本暂时没有可播放直链：${candidate.title} - ${candidate.artist}；请尝试其他搜索结果或切换音乐 API。`)
    }
    return this.enqueue(song, requester, candidate.title, options)
  }

  private enqueue(
    song: Song,
    requester: LiveUser,
    keyword: string,
    options: RequestOptions,
  ): QueueSubmission {
    const item = this.queue.add(song, requester, keyword, options)
    const state = this.queue.getState()
    const startedPlaying = state.current?.id === item.id
    const queueIndex = state.queue.findIndex(queued => queued.id === item.id)
    return {
      item,
      startedPlaying,
      queuePosition: startedPlaying ? 0 : queueIndex + 1,
      aheadCount: startedPlaying ? 0 : Math.max(0, queueIndex),
    }
  }
}
