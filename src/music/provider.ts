import type { Context } from 'koishi'
import type { AxiosInstance } from 'axios'
import type { Config } from '../config'
import { LuoyueMusicProvider } from './luoyue'
import { NeteaseMusicProvider } from './netease'
import type { Song } from './types'

export interface MusicProvider {
  query(keyword: string): Promise<Song | null>
  search(keyword: string, limit: number): Promise<Song[]>
  resolve(candidate: Song): Promise<Song | null>
  describe(): string
}

export function createMusicProvider(ctx: Context, config: Config, http: AxiosInstance): MusicProvider {
  if (config.musicBackend === 'netease') return new NeteaseMusicProvider(config, http)
  return new LuoyueMusicProvider(ctx, config, http)
}
