import { spawn, type ChildProcess } from 'node:child_process'

export interface VlcProcessOptions {
  executable: string
  rcPort: number
  showWindow: boolean
}

export class VlcProcessHost {
  private child?: ChildProcess
  private listeners = new Set<(code: number | null, signal: NodeJS.Signals | null) => void>()

  constructor(private options: VlcProcessOptions) {}

  start(): void {
    if (this.child && this.child.exitCode === null) return
    const args = [
      '--intf=dummy',
      '--extraintf=rc',
      `--rc-host=127.0.0.1:${this.options.rcPort}`,
      '--rc-quiet',
      '--no-video',
      '--no-one-instance',
      '--no-repeat',
      '--no-loop',
      '--ignore-config',
    ]
    const child = spawn(this.options.executable, args, {
      windowsHide: !this.options.showWindow,
      shell: false,
      stdio: 'ignore',
    })
    this.child = child
    let exitNotified = false
    const notifyExit = (code: number | null, signal: NodeJS.Signals | null) => {
      if (exitNotified) return
      exitNotified = true
      for (const listener of this.listeners) listener(code, signal)
    }
    child.once('error', error => {
      if (this.child === child) this.child = undefined
      notifyExit(null, null)
      void error
    })
    child.once('exit', (code, signal) => {
      if (this.child === child) this.child = undefined
      notifyExit(code, signal)
    })
  }

  isRunning(): boolean {
    return Boolean(this.child && this.child.exitCode === null && !this.child.killed)
  }

  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async stop(graceMs = 2_000): Promise<void> {
    const child = this.child
    if (!child || child.exitCode !== null) return
    await Promise.race([
      new Promise<void>(resolve => child.once('exit', () => resolve())),
      new Promise<void>(resolve => setTimeout(resolve, graceMs)),
    ])
    if (child.exitCode === null && !child.killed) child.kill()
  }
}

export async function probeVlcVersion(executable: string, timeout = 5_000): Promise<string> {
  if (process.platform === 'win32') {
    let resolvedExecutable = executable
    if (!/[\\/]/.test(executable)) {
      const located = await captureProcess('where.exe', [executable], timeout)
      resolvedExecutable = located.split(/\r?\n/).find(Boolean)?.trim() || executable
    }
    const version = await captureProcess(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `(Get-Item -LiteralPath '${resolvedExecutable.replace(/'/g, "''")}').VersionInfo.FileVersion`],
      timeout,
    )
    const fileVersion = version.trim().match(/\d+\.\d+\.\d+(?:\.\d+)?/)
    if (fileVersion) return fileVersion[0]
    throw new Error('无法读取 VLC Windows 文件版本')
  }
  const output = await captureProcess(
    executable,
    ['--version', '--intf=dummy', '--no-one-instance', 'vlc://quit'],
    timeout,
  )
  const match = output.match(/VLC media player\s+([\w.-]+)/i)
  if (match) return match[1]
  throw new Error('无法识别 VLC 版本输出')
}

function captureProcess(executable: string, args: string[], timeout: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`命令执行超时: ${executable}`))
    }, timeout)
    child.stdout?.on('data', data => { output += data.toString() })
    child.stderr?.on('data', data => { output += data.toString() })
    child.once('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', () => {
      clearTimeout(timer)
      resolve(output)
    })
  })
}
