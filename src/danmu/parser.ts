import type { LiveUser } from '../music/types'

export interface SongRequest {
  keyword: string
  user: LiveUser
  raw: string
}

export function parseSongRequest(content: string, user: LiveUser, prefix: string): SongRequest | null {
  const text = content.trim()
  const command = prefix.trim()
  if (!command) return null
  if (!text.startsWith(command)) return null

  const keyword = text.slice(command.length).trim()
  if (!keyword) return null

  return { keyword, user, raw: content }
}
