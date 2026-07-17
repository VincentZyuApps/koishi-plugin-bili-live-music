import type { AudioDeviceInfo } from '../types'

export function assertSafeRcValue(value: string, name: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${name} 不能为空`)
  if (/[\r\n\0]/.test(normalized)) throw new Error(`${name} 包含非法控制字符`)
  return normalized
}

export function parseRcNumber(output: string): number | null {
  const lines = cleanRcOutput(output).split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index--) {
    if (/^-?\d+(?:\.\d+)?$/.test(lines[index])) return Number(lines[index])
  }
  return null
}

export function parseRcState(output: string): 'playing' | 'paused' | 'stopped' | 'unknown' {
  const match = output.match(/\(\s*state\s+(playing|paused|stopped)\s*\)/i)
  if (match) return match[1].toLowerCase() as 'playing' | 'paused' | 'stopped'
  if (/\(\s*play state:\s*\d+\s*\)/i.test(output)) return 'playing'
  if (/\(\s*pause state:\s*\d+\s*\)/i.test(output)) return 'paused'
  if (/\(\s*stop state:\s*\d+\s*\)/i.test(output)) return 'stopped'
  return 'unknown'
}

export function parseAudioDevices(output: string, selectedId = ''): AudioDeviceInfo[] {
  const devices: AudioDeviceInfo[] = []
  for (const rawLine of cleanRcOutput(output).split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^\|\s*/, '')
    const match = line.match(/^([^\s:]+)\s*[-:]\s*(.+?)(\s+\*)?$/)
    if (!match) continue
    const id = match[1].trim()
    if (/^(audio|device|adev)$/i.test(id)) continue
    devices.push({ id, name: match[2].trim(), active: Boolean(match[3]) || id === selectedId })
  }
  return devices
}

export function cleanRcOutput(output: string): string {
  return output.replace(/(?:^|\r?\n)>\s*/g, '\n').replace(/^\s+|\s+$/g, '')
}

export function volumePercentToVlc(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)) * 2.56)
}
