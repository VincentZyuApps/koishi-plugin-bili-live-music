export type MusicSource = 'netease' | 'tencent' | 'kugou'
export type MusicBackend = 'netease' | 'luoyue'
export type NeteaseDirectApi = 'api.injahow.cn' | 'api.qijieya.cn' | 'meting.jmstrand.cn' | 'metingapi.nanorocky.top'
export type BotRequestContext = 'group' | 'private'
export type RequestOrigin = 'bilibili' | 'bot-group' | 'bot-private' | 'webui'
export type NeteaseQuality = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
export type TencentQuality = 4 | 8 | 10 | 11 | 12 | 14
export type KugouQuality = '128' | '320' | 'flac' | 'high'

export const NETEASE_QUALITY_LABELS: Record<NeteaseQuality, string> = {
  1: '标准（64k，standard）',
  2: '标准（128k，standard）',
  3: 'HQ极高（192k，higher）',
  4: 'HQ极高（320k，exhigh）',
  5: 'SQ无损（lossless）',
  6: '高解析度无损（Hi-Res，hires）',
  7: '高清臻音（Spatial Audio，jyeffect）',
  8: '沉浸环绕声（Surround Audio，sky）',
  9: '超清母带（Master，jymaster）',
}

export const TENCENT_QUALITY_LABELS: Record<TencentQuality, string> = {
  4: '标准音质（128）',
  8: 'HQ高音质（320）',
  10: 'SQ无损音质（flac）',
  11: 'Hi-Res音质（hires）',
  12: '杜比全景声（dolby）',
  14: '臻品母带2.0（master）',
}

export const KUGOU_QUALITY_LABELS: Record<KugouQuality, string> = {
  128: '标准音质（128）',
  320: 'HQ高品质（320）',
  flac: 'SQ无损（flac）',
  high: 'Hi-Res（high）',
}

export interface LiveUser {
  uid: string
  name: string
  origin: RequestOrigin
}

export interface Song {
  id?: string
  mid?: string
  hash?: string
  hqHash?: string
  sqHash?: string
  albumId?: string
  albumAudioId?: string
  lyricId?: string
  accesskey?: string
  title: string
  artist: string
  album?: string
  duration: number
  cover?: string
  url: string
  source: MusicSource
  quality?: string
  size?: string
  kbps?: string | number
}

export interface QueueItem {
  id: string
  song: Song
  requester: LiveUser
  keyword: string
  createdAt: number
}

export type PlaybackFinishReason = 'ended' | 'skipped' | 'error'
export type PlaybackPhase = 'idle' | 'loading' | 'playing' | 'paused' | 'finished' | 'error'

export interface LastFinishedTrack {
  item: QueueItem
  reason: PlaybackFinishReason
  position: number
  finishedAt: number
}

export interface PlayerState {
  current: QueueItem | null
  lastFinished: LastFinishedTrack | null
  queue: QueueItem[]
  history: QueueItem[]
  phase: PlaybackPhase
  playing: boolean
  paused: boolean
  position: number
  backendError: string | null
}

export interface QueueSubmission {
  item: QueueItem
  startedPlaying: boolean
  queuePosition: number
  aheadCount: number
}
