import type { ZwaveNode, ZwaveValue } from '../types/zwave.ts'

/** Values of a node, whatever shape zwave-js-ui used to publish them. */
function valuesOf(node: ZwaveNode | undefined): Record<string, ZwaveValue> {
  return node?.values ?? {}
}

/**
 * Merge an incoming node over the cached one WITHOUT losing known values.
 *
 * zwave-js-ui does not always publish a node's full state. `node_added` fires
 * before the interview, and a zwave-js-ui restart re-announces every node with
 * `values` still empty or partial. Taking those at face value drops values
 * that are perfectly alive.
 *
 * `ready` is what separates the two cases: a node zwave-js-ui reports as ready
 * has finished its interview, so it is authoritative and may legitimately drop
 * a value (an endpoint reconfigured, a command class gone). Anything else only
 * ever ADDS: the incoming values win where they exist, the others are kept.
 *
 * `degraded` says the incoming node was missing values the cache already had,
 * which is the caller's cue to ask for a fresh `getNodes`.
 */
function reconcile(
  previous: ZwaveNode | undefined,
  incoming: ZwaveNode,
): { node: ZwaveNode; degraded: boolean } {
  if (!previous) {
    return { node: incoming, degraded: false }
  }

  const known = valuesOf(previous)
  const next = valuesOf(incoming)
  const missing = Object.keys(known).filter((key) => !(key in next))
  if (missing.length === 0) {
    return { node: incoming, degraded: false }
  }
  if (incoming.ready === true) {
    return { node: incoming, degraded: false }
  }

  return {
    node: { ...incoming, values: { ...known, ...next } },
    degraded: true,
  }
}

/**
 * In-memory cache of the Z-Wave network.
 *
 * It is deliberately NOT the source of truth for commands — those are resolved
 * from the feature external id and the command class registry, so a command
 * works even when the cache is cold. The registry serves discovery (mapping
 * nodes to devices) and the initial snapshot of a freshly created device.
 *
 * Because the discovery payload REPLACES the Gladys device list, an amputated
 * node here becomes a device with no feature on the user's Discovery screen —
 * so the cache never lets a half-interviewed node erase what it already knows.
 * See `reconcile`.
 */
export class NodeRegistry {
  private nodes = new Map<number, ZwaveNode>()

  /**
   * Take in a fresh `getNodes` answer. Nodes absent from it are dropped — it
   * is the full picture — but a node that came back with fewer values than we
   * had is still reconciled rather than trusted blindly: the answer may have
   * been produced while zwave-js-ui was still interviewing.
   *
   * Returns true when at least one node came back degraded.
   */
  replace(nodes: readonly ZwaveNode[]): boolean {
    const previous = this.nodes
    const next = new Map<number, ZwaveNode>()
    let degraded = false

    for (const node of nodes) {
      if (typeof node?.id !== 'number') {
        continue
      }
      const reconciled = reconcile(previous.get(node.id), node)
      degraded ||= reconciled.degraded
      next.set(node.id, reconciled.node)
    }

    this.nodes = next
    return degraded
  }

  /**
   * Insert or refresh one node from a node event. Returns true when the event
   * carried less than the cache already held, i.e. when the caller should
   * resynchronize on a full `getNodes`.
   */
  upsert(node: ZwaveNode): boolean {
    if (typeof node?.id !== 'number') {
      return false
    }
    const { node: reconciled, degraded } = reconcile(this.nodes.get(node.id), node)
    this.nodes.set(node.id, reconciled)
    return degraded
  }

  remove(nodeId: number): void {
    this.nodes.delete(nodeId)
  }

  get(nodeId: number): ZwaveNode | undefined {
    return this.nodes.get(nodeId)
  }

  all(): ZwaveNode[] {
    return [...this.nodes.values()]
  }

  get size(): number {
    return this.nodes.size
  }
}
