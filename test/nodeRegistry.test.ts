import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { DeviceMapper } from '../src/mapping/DeviceMapper.ts'
import type { ZwaveNode } from '../src/types/zwave.ts'
import { NodeRegistry } from '../src/zwave/NodeRegistry.ts'

/**
 * A zwave-js-ui restart re-announces every node BEFORE interviewing it, so a
 * node event can carry an empty or partial `values`. The discovery payload
 * replaces the Gladys device list wholesale, so trusting such an announcement
 * republishes the user's devices with no feature at all — which is what the
 * "Mettre à jour, 0 fonctionnalités" reports were.
 */

const readNodes = (): ZwaveNode[] =>
  JSON.parse(readFileSync(new URL('./fixtures/exampleNodes.json', import.meta.url), 'utf8'))
    .result as ZwaveNode[]

const findNode = (id: number): ZwaveNode => {
  const node = readNodes().find((candidate) => candidate.id === id)
  assert.ok(node, `fixture node ${id}`)
  return node
}

/**
 * The value ids a node carries. zwave-js-ui publishes `values` either as an
 * array or as a keyed object depending on the node, and merging normalizes it
 * to an object — so the tests compare what the values ARE, not how they are
 * indexed.
 */
const valueIds = (node: ZwaveNode | undefined): string[] =>
  Object.values(node?.values ?? {})
    .map((value) => value.id)
    .toSorted()

/** The same node as zwave-js-ui announces it before the interview. */
const announced = (node: ZwaveNode, values: ZwaveNode['values']): ZwaveNode => ({
  ...node,
  ready: false,
  ...(values === undefined ? {} : { values }),
})

test('a node announced without values keeps the values already known', () => {
  const node = findNode(50)
  const registry = new NodeRegistry()
  registry.replace([node])

  const bare = announced(node, {})
  delete (bare as { values?: unknown }).values

  assert.equal(registry.upsert(bare), true, 'the caller must be told to resynchronize')
  assert.deepEqual(valueIds(registry.get(50)), valueIds(node))
})

test('a partially interviewed node is merged, never subtracted', () => {
  const node = findNode(50)
  const registry = new NodeRegistry()
  registry.replace([node])

  const [firstKey] = Object.keys(node.values ?? {})
  assert.ok(firstKey)
  const partial = announced(node, { [firstKey]: (node.values ?? {})[firstKey]! })

  assert.equal(registry.upsert(partial), true)
  assert.deepEqual(valueIds(registry.get(50)), valueIds(node))
})

test('a node that carries everything it used to is taken as is', () => {
  const node = findNode(50)
  const registry = new NodeRegistry()
  registry.replace([node])

  assert.equal(registry.upsert({ ...node, name: 'renamed' }), false)
  assert.equal(registry.get(50)?.name, 'renamed')
})

test('a ready node is authoritative and may drop a value', () => {
  const node = findNode(50)
  const registry = new NodeRegistry()
  registry.replace([node])

  const [firstKey] = Object.keys(node.values ?? {})
  assert.ok(firstKey)
  const trimmed: ZwaveNode = {
    ...node,
    ready: true,
    values: { [firstKey]: (node.values ?? {})[firstKey]! },
  }

  assert.equal(registry.upsert(trimmed), false, 'a finished interview is not a degradation')
  assert.deepEqual(valueIds(registry.get(50)), [(node.values ?? {})[firstKey]!.id])
})

test('an unknown node is inserted as announced', () => {
  const registry = new NodeRegistry()
  assert.equal(registry.upsert({ id: 7, ready: false }), false)
  assert.equal(registry.size, 1)
})

test('a getNodes answer produced mid-interview does not erase the network', () => {
  const node = findNode(50)
  const registry = new NodeRegistry()
  registry.replace([node])

  assert.equal(registry.replace([announced(node, {})]), true)
  assert.deepEqual(valueIds(registry.get(50)), valueIds(node))
})

test('a getNodes answer still drops the nodes it no longer lists', () => {
  const registry = new NodeRegistry()
  registry.replace([findNode(50), findNode(41)])

  assert.equal(registry.replace([findNode(50)]), false)
  assert.equal(registry.get(41), undefined)
  assert.equal(registry.size, 1)
})

test('a zwave-js-ui restart never publishes a device with no feature', () => {
  // The end-to-end shape of the bug: nodes re-announced bare must not turn
  // every already-added device into an empty one on the Discovery screen.
  const nodes = readNodes().filter((node) => node.virtual !== true)
  const registry = new NodeRegistry()
  registry.replace(nodes)

  const mapper = new DeviceMapper((suffix) => `ext:test:${suffix}`)
  const before = mapper.toDiscoveredDevices(registry.all())

  for (const node of nodes) {
    const bare = { ...node, ready: false }
    delete (bare as { values?: unknown }).values
    registry.upsert(bare)
  }

  assert.deepEqual(mapper.toDiscoveredDevices(registry.all()), before)
})
