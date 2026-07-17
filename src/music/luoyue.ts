import type { Context } from 'koishi'
import type { AxiosInstance } from 'axios'
import type { Config } from '../config'
import type { MusicSource, Song } from './types'
import type { MusicProvider } from './provider'
import { logInfo } from '../utils/logger'

interface LuoyueResponse {
  code?: number
  data?: any
  msg?: string
  message?: string
}

export class LuoyueMusicProvider implements MusicProvider {
  constructor(private ctx: Context, private config: Config, private http: AxiosInstance) {}

  describe(): string {
    return `落月 API · ${this.getSources().join('/') || '未启用音乐源'} · ${this.getApiOrigin()}`
  }

  async query(keyword: string): Promise<Song | null> {
    for (const source of this.getSources()) {
      let songs: Song[]
      try {
        songs = await this.searchSource(source, keyword, this.config.searchLimit)
      } catch (error) {
        this.ctx.logger('bili-live-music').warn(
          `音乐源 ${source} 搜索失败，继续尝试下一个来源: ${error instanceof Error ? error.message : String(error)}`,
        )
        continue
      }

      let lastError: unknown
      for (const song of songs) {
        if (song.url) return song
        try {
          const detail = await this.resolve(song)
          if (detail?.url) return detail
        } catch (error) {
          lastError = error
        }
      }
      if (lastError) {
        this.ctx.logger('bili-live-music').warn(
          `音乐源 ${source} 的 ${songs.length} 条候选均不可播放，继续尝试下一个来源: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
        )
      }
    }
    return null
  }

  async search(keyword: string, limit: number): Promise<Song[]> {
    const sources = this.getSources()
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

    const response = await this.get(url, '搜索')
    const data = Array.isArray(response.data) ? response.data : response.data ? [response.data] : []
    const songs = data.map(item => this.normalize(source, item)).filter(Boolean) as Song[]
    logInfo(
      this.ctx,
      this.config,
      `✅ 音乐源 ${source} 搜索完成：${keyword}，共 ${songs.length} 条结果`,
      `🔎 [音乐API:搜索结果] source=${source}, keyword=${JSON.stringify(keyword)}, results=${songs.length}`,
    )
    return songs
  }

  async resolve(song: Song): Promise<Song | null> {
    const source = song.source
    logInfo(
      this.ctx,
      this.config,
      `🎵 正在获取播放地址：${song.title} - ${song.artist}（${source}）`,
      `🔎 [音乐API:解析候选] source=${source}, title=${JSON.stringify(song.title)}, identifiers=${this.formatIdentifiers(song)}, quality=${this.getQuality(source)}`,
    )
    const response = source === 'kugou'
      ? await this.resolveKugou(song)
      : await this.get(this.buildDetailUrl(source, song), '详情')
    if (!response.data) return null

    const resolved = this.normalize(source, response.data, song)
    logInfo(
      this.ctx,
      this.config,
      resolved?.url ? `✅ 已获取播放地址：${song.title} - ${song.artist}` : `[WARN] 音乐 API 未返回播放地址：${song.title} - ${song.artist}`,
      `🔎 [音乐API:解析结果] source=${source}, title=${JSON.stringify(song.title)}, url=${resolved?.url ? this.formatMediaUrl(resolved.url) : 'none'}`,
    )
    return resolved
  }

  private async get(url: URL, operation: string): Promise<LuoyueResponse> {
    const startedAt = Date.now()
    logInfo(
      this.ctx,
      this.config,
      `🌐 音乐 API ${operation}请求：${url.origin}${url.pathname}`,
      `🔎 [音乐API:${operation}请求参数] ${url.toString()}`,
    )
    try {
      const { data: response } = await this.http.get<LuoyueResponse>(url.toString())
      logInfo(
        this.ctx,
        this.config,
        `📥 音乐 API ${operation}响应：code=${response?.code ?? 'none'}，耗时 ${Date.now() - startedAt}ms`,
        `🔎 [音乐API:${operation}响应详情] data=${Array.isArray(response?.data) ? `array(${response.data.length})` : response?.data ? typeof response.data : 'empty'}, message=${JSON.stringify(response?.message || response?.msg || '')}`,
      )
      if (!response || response.code !== 200 || !response.data) {
        throw new Error(response?.message || response?.msg || `落月 API 返回异常: ${response?.code}`)
      }
      return response
    } catch (error) {
      logInfo(
        this.ctx,
        this.config,
        `[WARN] 音乐 API ${operation}失败：${error instanceof Error ? error.message : String(error)}`,
        `🔎 [音乐API:${operation}失败详情] url=${url.toString()}, elapsed=${Date.now() - startedAt}ms`,
      )
      throw error
    }
  }

  private getQuality(source: MusicSource) {
    if (source === 'netease') return this.config.neteaseQuality ?? 1
    if (source === 'tencent') return this.config.tencentQuality ?? 10
    return this.config.kugouQuality ?? '320'
  }

  private getSources(): MusicSource[] {
    if (!Array.isArray(this.config.enabledSources)) return []
    return this.config.enabledSources.filter(
      source => source === 'netease' || source === 'tencent' || source === 'kugou',
    )
  }

  private getApiOrigin(): string {
    try {
      return new URL(this.config.apiBaseUrl).origin
    } catch {
      return this.config.apiBaseUrl
    }
  }

  private formatIdentifiers(song: Song): string {
    return [
      song.id && `id=${song.id}`,
      song.mid && `mid=${song.mid}`,
      song.hash && `hash=${song.hash}`,
      song.hqHash && `hqHash=${song.hqHash}`,
      song.sqHash && `sqHash=${song.sqHash}`,
      song.albumId && `albumId=${song.albumId}`,
      song.albumAudioId && `albumAudioId=${song.albumAudioId}`,
    ].filter(Boolean).join(',') || 'none'
  }

  private formatMediaUrl(value: string): string {
    try {
      const url = new URL(value)
      return `${url.origin}${url.pathname}`
    } catch {
      return 'invalid-url'
    }
  }

  private buildDetailParams(source: MusicSource, song: Song): Record<string, string | undefined> {
    if (source === 'tencent' && song.mid) return { mid: song.mid }
    return { id: song.id }
  }

  private buildDetailUrl(source: MusicSource, song: Song): URL {
    const url = new URL(`/v2/music/${source}`, this.config.apiBaseUrl)
    for (const [key, value] of Object.entries(this.buildDetailParams(source, song))) {
      if (value) url.searchParams.set(key, value)
    }
    url.searchParams.set('quality', String(this.getQuality(source)))
    return url
  }

  private async resolveKugou(song: Song): Promise<LuoyueResponse> {
    const quality = String(this.getQuality('kugou'))
    const preferredHash = this.selectKugouHash(song, quality)
    const attempts: Array<Record<string, string | undefined>> = [
      { hash: preferredHash },
      preferredHash !== song.hash ? { hash: song.hash } : {},
      {
        hash: song.hash,
        album_id: song.albumId,
        album_audio_id: song.albumAudioId,
      },
    ]
    const seen = new Set<string>()
    let lastError: unknown

    for (const params of attempts) {
      if (!params.hash) continue
      const url = new URL('/v2/music/kugou', this.config.apiBaseUrl)
      for (const [key, value] of Object.entries(params)) {
        if (value) url.searchParams.set(key, value)
      }
      url.searchParams.set('quality', String(quality))
      const signature = url.searchParams.toString()
      if (seen.has(signature)) continue
      seen.add(signature)
      try {
        const response = await this.get(url, '详情')
        if (this.normalize('kugou', response.data, song)?.url) return response
        lastError = new Error('落月 API 返回成功，但未包含酷狗播放地址')
      } catch (error) {
        lastError = error
      }
      logInfo(
        this.ctx,
        this.config,
        `[WARN] 酷狗当前取链方式失败，尝试下一种参数组合：${song.title}`,
        `🔎 [音乐API:酷狗取链降级] params=${signature}, error=${lastError instanceof Error ? lastError.message : String(lastError)}`,
      )
    }
    throw lastError instanceof Error ? lastError : new Error(`酷狗无法获取播放地址：${song.title}`)
  }

  private selectKugouHash(song: Song, quality: string): string | undefined {
    if (quality === '320') return song.hqHash || song.hash
    if (quality === 'flac') return song.sqHash || song.hash
    return song.hash
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
      hqHash: stringify(data.hq_hash || data.hqHash) || fallback?.hqHash,
      sqHash: stringify(data.sq_hash || data.sqHash) || fallback?.sqHash,
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
