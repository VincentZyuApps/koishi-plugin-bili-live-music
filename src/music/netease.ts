import type { AxiosInstance } from 'axios'
import type { Config } from '../config'
import type { MusicProvider } from './provider'
import type { NeteaseDirectApi, Song } from './types'

interface NeteaseSearchResponse {
  code?: number
  result?: {
    songs?: Array<{
      id: number
      name: string
      duration?: number
      artists?: Array<{ name?: string }>
      album?: { name?: string; picUrl?: string; picId?: string | number }
    }>
  }
}

interface NeteaseDetailResponse {
  code?: number
  songs?: Array<{
    id: number
    album?: { picUrl?: string }
    al?: { picUrl?: string }
  }>
}

const DIRECT_URL_BUILDERS: Record<NeteaseDirectApi, (id: string) => string> = {
  'api.injahow.cn': id => `https://api.injahow.cn/meting/?type=url&id=${encodeURIComponent(id)}`,
  'api.qijieya.cn': id => `https://api.qijieya.cn/meting/?type=url&id=${encodeURIComponent(id)}`,
  'meting.jmstrand.cn': id => `https://meting.jmstrand.cn/?type=url&id=${encodeURIComponent(id)}`,
  'metingapi.nanorocky.top': id => `https://metingapi.nanorocky.top/?server=netease&type=url&id=${encodeURIComponent(id)}`,
}

export class NeteaseMusicProvider implements MusicProvider {
  constructor(private config: Config, private http: AxiosInstance) {}

  describe(): string {
    return `网易云直链 · ${this.config.neteaseDirectApi}`
  }

  async query(keyword: string): Promise<Song | null> {
    const candidates = await this.search(keyword, this.config.searchLimit)
    for (const candidate of candidates) {
      const song = await this.resolve(candidate)
      if (song?.url) return song
    }
    return null
  }

  async search(keyword: string, limit: number): Promise<Song[]> {
    const url = new URL('https://music.163.com/api/search/get/web')
    url.searchParams.set('csrf_token', '')
    url.searchParams.set('hlpretag', '')
    url.searchParams.set('hlposttag', '')
    url.searchParams.set('s', keyword)
    url.searchParams.set('type', '1')
    url.searchParams.set('offset', '0')
    url.searchParams.set('total', 'true')
    url.searchParams.set('limit', String(limit))

    const { data: response } = await this.http.get<NeteaseSearchResponse>(url.toString(), {
      headers: { Referer: 'https://music.163.com/' },
    })
    if (response?.code !== 200) throw new Error(`网易云搜索返回异常: ${response?.code}`)

    const songs = (response.result?.songs ?? []).map((item): Song => ({
      id: String(item.id),
      title: item.name,
      artist: item.artists?.map(artist => artist.name).filter(Boolean).join('/') || '未知歌手',
      album: item.album?.name,
      duration: Number(item.duration || 0),
      cover: normalizeCoverUrl(item.album?.picUrl),
      url: '',
      source: 'netease',
    }))
    await this.enrichMissingCovers(songs)
    return songs
  }

  async resolve(candidate: Song): Promise<Song | null> {
    if (!candidate.id) return null
    const builder = DIRECT_URL_BUILDERS[this.config.neteaseDirectApi]
    if (!builder) throw new Error(`不支持的网易云直链 API: ${this.config.neteaseDirectApi}`)
    return { ...candidate, url: builder(candidate.id) }
  }

  private async enrichMissingCovers(songs: Song[]): Promise<void> {
    const ids = songs.filter(song => !song.cover && song.id).map(song => Number(song.id))
    if (!ids.length) return

    const url = new URL('https://music.163.com/api/song/detail/')
    url.searchParams.set('ids', JSON.stringify(ids))
    try {
      const { data: response } = await this.http.get<NeteaseDetailResponse>(url.toString(), {
        headers: { Referer: 'https://music.163.com/' },
      })
      if (response?.code !== 200) return
      const covers = new Map(
        (response.songs ?? []).map(song => [
          String(song.id),
          normalizeCoverUrl(song.album?.picUrl || song.al?.picUrl),
        ]),
      )
      for (const song of songs) song.cover ||= covers.get(song.id || '')
    } catch {
      // Cover enrichment must not make an otherwise valid music search fail.
    }
  }
}

function normalizeCoverUrl(url?: string): string | undefined {
  if (!url) return undefined
  const secureUrl = url.replace(/^http:\/\//i, 'https://')
  if (/[?&]param=\d+y\d+/i.test(secureUrl)) return secureUrl
  return `${secureUrl}${secureUrl.includes('?') ? '&' : '?'}param=300y300`
}
