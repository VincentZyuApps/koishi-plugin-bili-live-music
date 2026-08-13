export type DanmuConnectionState = 'disabled' | 'starting' | 'connected' | 'waiting' | 'reconnecting' | 'stopped'
export type DanmuIdentityMode = 'unknown' | 'anonymous' | 'authenticated'

export interface DanmuRuntimeState {
  state: DanmuConnectionState
  roomId: string
  identity: DanmuIdentityMode
  attempt: number
  failureCount: number
  generation: number
  connectedAt: number | null
  lastTransitionAt: number
  nextRetryAt: number | null
  lastError: string | null
}

export interface DanmuStateTransition {
  id: number
  from: DanmuConnectionState
  to: DanmuConnectionState
  at: number
  reason: string
}

export interface DanmuReconnectResult {
  ok: boolean
  elapsed: number
  state: DanmuRuntimeState
}

export interface ConsoleFeatures {
  musicManagementPage: boolean
  danmuStateMachinePage: boolean
}

export const fallbackDanmuState: DanmuRuntimeState = {
  state: 'stopped',
  roomId: '',
  identity: 'unknown',
  attempt: 0,
  failureCount: 0,
  generation: 0,
  connectedAt: null,
  lastTransitionAt: 0,
  nextRetryAt: null,
  lastError: null,
}

export const stateLabels: Record<DanmuConnectionState, string> = {
  disabled: '已禁用',
  starting: '正在启动',
  connected: '监听中',
  waiting: '等待重试',
  reconnecting: '正在重连',
  stopped: '已停止',
}

export function identityLabel(identity: DanmuIdentityMode): string {
  return identity === 'authenticated' ? '登录身份' : identity === 'anonymous' ? '匿名身份' : '尚未确定'
}
