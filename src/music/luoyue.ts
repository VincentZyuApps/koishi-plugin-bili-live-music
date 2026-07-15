import type { Context } from 'koishi'
import type { AxiosInstance } from 'axios'
import type { Config } from '../config'
import type { MusicSource, Song } from './types'
import type { MusicProvider } from './provider'

interface LuoyueResponse {
  code?: number
  data?: any
  msg?: string
  message?: string
}

export class LuoyueMusicProvider implements MusicProvider {
  constructor(private ctx: Context, private config: Config, private http: AxiosInstance) {}

  describe(): string {
    return `落月 API · ${this.config.enabledSources.join('/')}`
  }

  async query(keyword: string): Promise<Song | null> {
    for (const source of this.config.enabledSources) {
      try {
        const songs = await this.searchSource(source, keyword, this.config.searchLimit)
        const song = songs.find(item => item.url) ?? songs[0]
        if (!song) continue
        if (song.url) return song

        const detail = await this.resolve(song)
        if (detail?.url) return detail
      } catch (error) {
        this.ctx.logger('bili-live-music').warn(
          `音乐源 ${source} 查询失败，继续尝试下一个来源: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    return null
  }

  async search(keyword: string, limit: number): Promise<Song[]> {
    const sources = this.config.enabledSources
    if (!sources.length) return []
    const perSourceLimit = Math.max(1, Math.ceil(limit / sources.length))
    const groups = await Promise.all(sources.map(async (source) => {
      try {
        return await this.searchSource(source, keyword, perSourceLimit)
      } catch (error) {
        this.ctx.logger('bili-live-music').warn(
          `音乐源 ${source} 搜索失败: ${error instanceof Error ? error.message : String(error)}`,
        )
        return []
      }
    }))

    const merged: Song[] = []
    const maxLength = Math.max(0, ...groups.map(group => group.length))
    for (let index = 0; index < maxLength && merged.length < limit; index++) {
      for (const group of groups) {
        if (group[index]) merged.push(group[index])
        if (merged.length >= limit) break
      }
    }
    return merged
  }

  private async searchSource(source: MusicSource, keyword: string, limit: number): Promise<Song[]> {
    const url = new URL(`/v2/music/${source}`, this.config.apiBaseUrl)
    url.searchParams.set('word', keyword)
    url.searchParams.set('num', String(limit))
    url.searchParams.set('quality', String(this.getQuality(source)))

    const response = await this.get(url)
    const data = Array.isArray(response.data) ? response.data : response.data ? [response.data] : []
    return data.map(item => this.normalize(source, item)).filter(Boolean) as Song[]
  }

  async resolve(song: Song): Promise<Song | null> {
    const source = song.source
    const url = new URL(`/v2/music/${source}`, this.config.apiBaseUrl)
    const params = this.buildDetailParams(source, song)
    for (const [key, value] of Object.entries(params)) {
      if (value) url.searchParams.set(key, value)
    }
    url.searchParams.set('quality', String(this.getQuality(source)))

    const response = await this.get(url)
    if (!response.data) return null

    return this.normalize(source, response.data, song)
  }

  private async get(url: URL): Promise<LuoyueResponse> {
    const { data: response } = await this.http.get<LuoyueResponse>(url.toString())
    if (!response || response.code !== 200 || !response.data) {
      throw new Error(response?.message || response?.msg || `落月 API 返回异常: ${response?.code}`)
    }
    return response
  }

  private getQuality(source: MusicSource) {
    if (source === 'netease') return this.config.neteaseQuality
    if (source === 'tencent') return this.config.tencentQuality
    return this.config.kugouQuality
  }

  private buildDetailParams(source: MusicSource, song: Song): Record<string, string | undefined> {
    if (source === 'tencent' && song.mid) return { mid: song.mid }
    if (source === 'kugou') {
      return {
        hash: song.hash,
        album_id: song.albumId,
        album_audio_id: song.albumAudioId,
      }
    }
    return { id: song.id }
  }

  private normalize(source: MusicSource, data: any, fallback?: Song): Song | null {
    if (!data) return null
    const duration = parseDuration(data.interval) || Number(data.duration || 0) || fallback?.duration || 0
    const title = data.song || data.name || data.title || fallback?.title
    const artist = data.singer || data.artist || data.author || fallback?.artist
    if (!title || !artist) return null

    return {
      id: stringify(data.id) || fallback?.id,
      mid: stringify(data.mid) || fallback?.mid,
      hash: stringify(data.hash) || fallback?.hash,
      albumId: stringify(data.album_id || data.albumID) || fallback?.albumId,
      albumAudioId: stringify(data.album_audio_id || data.albumAudioID) || fallback?.albumAudioId,
      lyricId: stringify(data.lyric_id) || fallback?.lyricId,
      accesskey: stringify(data.accesskey) || fallback?.accesskey,
      title,
      artist,
      album: data.album || fallback?.album,
      duration,
      cover: data.cover || data.pic || fallback?.cover,
      url: data.url || fallback?.url || '',
      source,
      quality: stringify(data.quality) || fallback?.quality,
      size: stringify(data.size) || fallback?.size,
      kbps: data.kbps || fallback?.kbps,
    }
  }
}

function stringify(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined
  return String(value)
}

function parseDuration(value: unknown): number {
  if (typeof value !== 'string') return 0
  const match = value.match(/(\d+)分(\d+)秒/)
  if (!match) return 0
  return (Number(match[1]) * 60 + Number(match[2])) * 1000
}
