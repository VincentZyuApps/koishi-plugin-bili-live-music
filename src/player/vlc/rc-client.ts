import { Socket } from 'node:net'

export class VlcRcClient {
  private socket?: Socket
  private commandChain: Promise<unknown> = Promise.resolve()
  private pending?: {
    resolve: (value: string) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
    settleTimer?: NodeJS.Timeout
  }
  private response = ''

  constructor(private host: string, private port: number) {}

  async connect(timeout = 2_000): Promise<void> {
    if (this.socket && !this.socket.destroyed) return
    await new Promise<void>((resolve, reject) => {
      const socket = new Socket()
      let settled = false
      const timer = setTimeout(() => finish(new Error(`连接 VLC RC 超时: ${this.host}:${this.port}`)), timeout)
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        socket.removeListener('error', onError)
        if (error) {
          socket.destroy()
          reject(error)
        } else {
          this.socket = socket
          resolve()
        }
      }
      const onError = (error: Error) => finish(error)
      socket.setEncoding('utf8')
      socket.setNoDelay(true)
      socket.on('data', data => this.handleData(String(data)))
      socket.on('close', () => this.handleClose())
      socket.once('error', onError)
      socket.connect(this.port, this.host, () => finish())
    })
  }

  execute(command: string, timeout = 2_000): Promise<string> {
    const task = this.commandChain.then(() => this.executeNow(command, timeout))
    this.commandChain = task.then(() => undefined, () => undefined)
    return task
  }

  isConnected(): boolean {
    return Boolean(this.socket && !this.socket.destroyed)
  }

  close(): void {
    const socket = this.socket
    this.socket = undefined
    socket?.destroy()
    this.rejectPending(new Error('VLC RC 连接已关闭'))
  }

  private executeNow(command: string, timeout: number): Promise<string> {
    if (!this.socket || this.socket.destroyed) throw new Error('VLC RC 尚未连接')
    if (/[\r\n\0]/.test(command)) throw new Error('VLC RC 命令包含非法控制字符')
    this.response = ''
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = undefined
        reject(new Error(`VLC RC 命令超时: ${command.split(' ', 1)[0]}`))
      }, timeout)
      this.pending = { resolve, reject, timer }
      this.socket!.write(`${command}\n`, (error) => {
        if (error) this.rejectPending(error)
        else this.scheduleSettle(120)
      })
    })
  }

  private handleData(data: string): void {
    if (!this.pending) return
    this.response += data
    if (!/(?:^|\r?\n)>\s*$/.test(this.response)) {
      this.scheduleSettle(40)
      return
    }
    this.finishPending()
  }

  private scheduleSettle(delay: number): void {
    if (!this.pending) return
    if (this.pending.settleTimer) clearTimeout(this.pending.settleTimer)
    this.pending.settleTimer = setTimeout(() => this.finishPending(), delay)
  }

  private finishPending(): void {
    if (!this.pending) return
    const pending = this.pending
    this.pending = undefined
    clearTimeout(pending.timer)
    if (pending.settleTimer) clearTimeout(pending.settleTimer)
    pending.resolve(this.response)
  }

  private handleClose(): void {
    this.socket = undefined
    this.rejectPending(new Error('VLC RC 连接意外断开'))
  }

  private rejectPending(error: Error): void {
    if (!this.pending) return
    const pending = this.pending
    this.pending = undefined
    clearTimeout(pending.timer)
    if (pending.settleTimer) clearTimeout(pending.settleTimer)
    pending.reject(error)
  }
}
