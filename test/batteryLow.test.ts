import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { DeviceMapper } from '../src/mapping/DeviceMapper.ts'
import type { ZwaveNode } from '../src/types/zwave.ts'

/**
 * zwave-js 15.10.0 removed the Battery CC `isLow` VALUE, turning the warning
 * into a notification event and cleaning the stale values up on startup. From
 * that version on, `getNodes` carries only the level — so `battery-low` stopped
 * being discovered at all, and devices that had it lost it.
 *
 * `sceneControllerNode.json` is a real dump from such a version: an SCN04 at
 * 38%, with `128-0-level` and no `isLow` anywhere (and no Notification CC
 * either — the flag did not move there).
 */

const SELECTOR = 'test'
const mapper = new DeviceMapper((suffix) => `ext:${SELECTOR}:${suffix}`)

const readFixture = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as T

const modernNode = (): ZwaveNode => readFixture<ZwaveNode>('sceneControllerNode.json')

/** A node from before the change: it still publishes the flag itself. */
const legacyNode = (): ZwaveNode => {
  const { result } = readFixture<{ result: ZwaveNode[] }>('exampleNodes.json')
  const node = result.find((candidate) => candidate.id === 9)
  assert.ok(node, 'fixture node 9')
  return node
}

const battery = (node: ZwaveNode) =>
  (mapper.toDiscoveredDevice(node).features ?? []).filter((f) => f.category.startsWith('battery'))

test('a node that no longer reports isLow still exposes battery-low', () => {
  const features = battery(modernNode())

  assert.deepEqual(
    features.map((f) => f.category),
    ['battery', 'battery-low'],
  )
})

test('the derived feature keeps the historical external id', () => {
  // This is what a device migration matches on: reusing it is the difference
  // between a user keeping their feature and its history, and watching one
  // vanish while an unrelated one appears.
  const low = battery(modernNode()).find((f) => f.category === 'battery-low')

  assert.equal(low?.external_id, `ext:${SELECTOR}:13:0:battery:islow`)
  assert.equal(low?.name, '13-128-0-isLow')
})

test('the flag is derived from the level, in both directions', () => {
  const node = modernNode()
  const level =
    node.values?.['7'] ?? Object.values(node.values ?? {}).find((v) => v.commandClass === 128)
  assert.ok(level, 'the battery level value')

  const stateOf = (raw: unknown) =>
    mapper
      .convertValue(node, level, raw)
      .find((s) => s.featureExternalId.endsWith(':battery:islow'))?.state

  assert.equal(stateOf(38), 0, '38% is not low')
  assert.equal(stateOf(11), 0, 'just above the threshold')
  assert.equal(stateOf(10), 1, 'at the threshold')
  assert.equal(stateOf(0), 1, 'a low-battery warning reports 0')
})

test('the initial snapshot populates it without waiting for a report', () => {
  // The whole point: a sleeping sensor may not report for months.
  const states = mapper.snapshot(modernNode())

  assert.deepEqual(
    states.find((s) => s.featureExternalId.endsWith(':battery:islow')),
    {
      featureExternalId: `ext:${SELECTOR}:13:0:battery:islow`,
      state: 0,
      sampled: false,
      event: false,
    },
  )
})

test('a node that still reports isLow is left alone', () => {
  const node = legacyNode()
  const features = battery(node)

  // One battery-low, not two: the node's own flag stays the source of truth.
  assert.equal(features.filter((f) => f.category === 'battery-low').length, 1)

  const level = Object.values(node.values ?? {}).find(
    (v) => v.commandClass === 128 && v.propertyName === 'level',
  )
  assert.ok(level)
  assert.deepEqual(
    mapper.convertValue(node, level, 5).map((s) => s.featureExternalId),
    [`ext:${SELECTOR}:9:0:battery:level`],
    'the level must not fight the flag the device publishes itself',
  )
})
