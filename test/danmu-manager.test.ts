import assert from 'node:assert/strict'
import type { Config } from '../src/config'
import { BilibiliDanmuManager, getDanmuRetryDelay } from '../src/danmu/manager'
import type { DanmuConnectionAdapter, DanmuConnectionCallbacks, DanmuIdentityMode } from '../src/danmu/types'

class FakeConnection implements DanmuConnectionAdapter {
  callbacks: DanmuConnectionCallbacks[] = []
  connectCount = 0
  stopCount = 0
  disposed = false
  closeOnStop = false
  identity: DanmuIdentityMode = 'anonymous'

  async connect(callbacks: DanmuConnectionCallbacks): Promise<DanmuIdentityMode> {
    this.connectCount++
    this.callbacks.push(callbacks)
    return this.identity
  }

  stop(): void {
    this.stopCount++
    if (this.closeOnStop) this.callbacks.at(-1)?.onClose()
  }
  dispose(): void { this.disposed = true }
}

const logger = { info() {}, warn() {}, error() {}, debug() {} }
const ctx = {
  logger: () => logger,
} as any
const config = {
  enabled: true,
  roomId: '1854258163',
  listenerVersion: '0.5.4',
} as Config

async function main() {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 20].map(count => getDanmuRetryDelay(count)),
    [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 32_000, 32_000],
  )

  const connection = new FakeConnection()
  const manager = new BilibiliDanmuManager(ctx, config, {} as any, () => {}, {
    connection,
    connectTimeoutMs: 30,
    retryDelaysMs: [10, 20, 40],
  })
  const states: string[] = []
  manager.onStateChange(snapshot => states.push(snapshot.runtime.state))
  const startup = manager.start()
  assert.equal(manager.getState().state, 'starting')
  assert.equal(connection.connectCount, 1)
  connection.callbacks[0].onConnected()
  assert.equal((await startup).state, 'connected')
  assert.equal(manager.getState().failureCount, 0)

  const reconnectA = manager.reconnect()
  const reconnectB = manager.reconnect()
  assert.equal(manager.getState().state, 'reconnecting')
  assert.equal(connection.connectCount, 2)
  connection.callbacks[1].onConnected()
  assert.equal((await reconnectA).ok, true)
  assert.equal((await reconnectB).ok, true)
  assert.equal(manager.getState().generation, 2)
  assert.ok(states.includes('starting') && states.includes('connected') && states.includes('reconnecting'))
  connection.closeOnStop = true
  connection.callbacks[1].onClose()
  assert.equal(manager.getState().state, 'waiting')
  assert.equal(manager.getState().failureCount, 1)
  manager.dispose()
  assert.equal(connection.disposed, true)

  const timeoutConnection = new FakeConnection()
  const timeoutManager = new BilibiliDanmuManager(ctx, config, {} as any, () => {}, {
    connection: timeoutConnection,
    connectTimeoutMs: 10,
    retryDelaysMs: [50, 100],
  })
  const timedOut = await timeoutManager.reconnect()
  assert.equal(timedOut.ok, false)
  assert.equal(timedOut.state.state, 'waiting')
  assert.equal(timedOut.state.failureCount, 1)
  assert.match(timedOut.state.lastError || '', /连接等待超过/)
  const retryDelay = (timedOut.state.nextRetryAt || 0) - timedOut.state.lastTransitionAt
  assert.ok(retryDelay >= 45 && retryDelay <= 55)
  timeoutManager.dispose()

  const disabledManager = new BilibiliDanmuManager(ctx, { ...config, enabled: false } as Config, {} as any, () => {}, {
    connection: new FakeConnection(),
  })
  assert.equal((await disabledManager.start()).state, 'disabled')
  assert.equal((await disabledManager.reconnect()).ok, false)
  disabledManager.dispose()

  console.log('danmu manager state machine: ok')
}

void main()
