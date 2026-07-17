const LEASE_REGISTRY = Symbol.for('koishi-plugin-bili-live-music.obs-server-leases')

interface LeaseRegistry {
  queues: Map<string, Promise<void>>
}

function getRegistry(): LeaseRegistry {
  const target = globalThis as typeof globalThis & { [LEASE_REGISTRY]?: LeaseRegistry }
  return target[LEASE_REGISTRY] ??= { queues: new Map() }
}

/**
 * Serializes ownership of a Fastify listen address across Koishi HMR module instances.
 */
export async function acquireObsServerLease(host: string, port: number): Promise<() => void> {
  const registry = getRegistry()
  const key = `${host}:${port}`
  const previous = registry.queues.get(key) ?? Promise.resolve()
  let releaseGate!: () => void
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve
  })
  const tail = previous.catch(() => {}).then(() => gate)
  registry.queues.set(key, tail)
  await previous.catch(() => {})

  let released = false
  return () => {
    if (released) return
    released = true
    releaseGate()
    void tail.finally(() => {
      if (registry.queues.get(key) === tail) registry.queues.delete(key)
    })
  }
}
