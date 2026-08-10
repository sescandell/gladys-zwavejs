import type { ZwaveNode } from '../types/zwave.ts'

/**
 * In-memory cache of the Z-Wave network.
 *
 * It is deliberately NOT the source of truth for commands — those are resolved
 * from the feature external id and the command class registry, so a command
 * works even when the cache is cold. The registry serves discovery (mapping
 * nodes to devices) and the initial snapshot of a freshly created device.
 */
export class NodeRegistry {
  private nodes = new Map<number, ZwaveNode>()

  /** Replace the whole cache with a fresh `getNodes` answer. */
  replace(nodes: readonly ZwaveNode[]): void {
    this.nodes = new Map(nodes.map((node) => [node.id, node]))
  }

  /** Insert or refresh one node (a node event carries its full state). */
  upsert(node: ZwaveNode): void {
    if (typeof node?.id === 'number') {
      this.nodes.set(node.id, node)
    }
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
