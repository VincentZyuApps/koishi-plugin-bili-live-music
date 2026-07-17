import assert from 'node:assert/strict'
import { writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { VlcProcessHost, probeVlcVersion } from '../src/player/vlc/process'
import { VlcRcClient } from '../src/player/vlc/rc-client'
import { parseAudioDevices, parseRcState } from '../src/player/vlc/protocol'

const executable = process.env.VLC_PATH || 'vlc'
const port = Number(process.env.VLC_RC_PORT || 60727)
const wavPath = path.join(tmpdir(), `bili-live-music-vlc-${process.pid}.wav`)

async function main() {
  await writeFile(wavPath, createSilentWav(4))
  const version = await probeVlcVersion(executable)
  const host = new VlcProcessHost({ executable, rcPort: port, showWindow: false })
  const rc = new VlcRcClient('127.0.0.1', port)
  try {
    host.start()
    await connectWithRetry(rc, host)
    await rc.execute('clear')
    await rc.execute(`add ${pathToFileURL(wavPath).href}`)
    await waitForState(rc, 'playing')
    await rc.execute('pause')
    await waitForState(rc, 'paused')
    await rc.execute('pause')
    await waitForState(rc, 'playing')
    const devices = await rc.execute('adev')
    assert.match(devices, /adev|audio|device|mmdevice|waveout|directx/i)
    assert.ok(parseAudioDevices(devices).length > 0)
    await rc.execute('stop')
    await waitForState(rc, 'stopped')
    console.log(`vlc integration: ok (${version})`)
  } finally {
    await rc.execute('quit', 1_000).catch(() => undefined)
    rc.close()
    await host.stop()
    await rm(wavPath, { force: true })
  }
}

async function connectWithRetry(rc: VlcRcClient, host: VlcProcessHost) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    assert.equal(host.isRunning(), true, 'VLC exited before RC became ready')
    try {
      await rc.connect(750)
      await rc.execute('status', 1_000)
      return
    } catch {
      rc.close()
      await delay(200)
    }
  }
  throw new Error('VLC RC did not become ready')
}

async function waitForState(rc: VlcRcClient, expected: 'playing' | 'paused' | 'stopped') {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (parseRcState(await rc.execute('status')) === expected) return
    await delay(100)
  }
  throw new Error(`VLC did not enter ${expected} state`)
}

function createSilentWav(seconds: number): Buffer {
  const sampleRate = 8_000
  const channels = 1
  const bitsPerSample = 16
  const dataLength = sampleRate * seconds * channels * bitsPerSample / 8
  const buffer = Buffer.alloc(44 + dataLength)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataLength, 4)
  buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, 28)
  buffer.writeUInt16LE(channels * bitsPerSample / 8, 32)
  buffer.writeUInt16LE(bitsPerSample, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataLength, 40)
  return buffer
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

void main()
