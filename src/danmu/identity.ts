import type { Logger } from 'koishi'
import type { AxiosInstance } from 'axios'

const FINGER_SPI_URL = 'https://api.bilibili.com/x/frontend/finger/spi'

export const BILIBILI_WEB_USER_AGENT = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'AppleWebKit/537.36 (KHTML, like Gecko)',
  'Chrome/120.0.0.0 Safari/537.36',
].join(' ')

interface FingerSpiResponse {
  code?: number
  message?: string
  data?: {
    b_3?: string
    b_4?: string
  }
}

export interface DanmuIdentity {
  headers: Record<string, string>
  uid: number
  anonymous: boolean
  generatedBuvid: boolean
}

export async function prepareDanmuIdentity(
  http: AxiosInstance,
  configuredCookie: string,
  configuredUid: string,
  logger: Logger,
): Promise<DanmuIdentity> {
  const cookies = parseCookieHeader(configuredCookie)
  const hasLoginCookie = Boolean(cookies.get('SESSDATA'))
  const cookieUid = parseUid(cookies.get('DedeUserID'))
  const requestedUid = parseUid(configuredUid)

  let uid = 0
  if (hasLoginCookie) {
    if (requestedUid && cookieUid && requestedUid !== cookieUid) {
      throw new Error(`配置 UID ${requestedUid} 与 Cookie 中的 DedeUserID ${cookieUid} 不一致`)
    }
    uid = requestedUid || cookieUid || 0
    if (!uid) logger.warn('检测到登录 Cookie，但未找到对应 UID，将以 uid=0 连接')
  } else if (requestedUid) {
    logger.warn(`未检测到 SESSDATA，已忽略配置 UID ${requestedUid}，匿名连接将使用 uid=0`)
  }

  let generatedBuvid = false
  if (!cookies.get('buvid3')) {
    const { data: response } = await http.get<FingerSpiResponse>(FINGER_SPI_URL, {
      headers: { 'User-Agent': BILIBILI_WEB_USER_AGENT },
    })
    const buvid3 = response?.data?.b_3?.trim()
    if (response?.code !== 0 || !buvid3) {
      throw new Error(`无法初始化匿名 buvid3: ${response?.message || `code=${response?.code}`}`)
    }
    cookies.set('buvid3', buvid3)
    if (response.data?.b_4?.trim()) cookies.set('buvid4', response.data.b_4.trim())
    if (!cookies.get('b_nut')) cookies.set('b_nut', String(Math.floor(Date.now() / 1000)))
    generatedBuvid = true
  }

  return {
    headers: {
      'User-Agent': BILIBILI_WEB_USER_AGENT,
      Referer: 'https://live.bilibili.com/',
      Cookie: serializeCookieHeader(cookies),
    },
    uid,
    anonymous: !hasLoginCookie,
    generatedBuvid,
  }
}

export function parseCookieHeader(header: string): Map<string, string> {
  const cookies = new Map<string, string>()
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator <= 0) continue
    const key = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (key && value) cookies.set(key, value)
  }
  return cookies
}

export function serializeCookieHeader(cookies: Map<string, string>): string {
  return [...cookies].map(([key, value]) => `${key}=${value}`).join('; ')
}

function parseUid(value?: string): number {
  if (!value?.trim()) return 0
  const uid = Number.parseInt(value.trim(), 10)
  return Number.isSafeInteger(uid) && uid > 0 ? uid : 0
}
