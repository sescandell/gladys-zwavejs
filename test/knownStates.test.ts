import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'

import type { Device } from '@gladysassistant/integration-sdk'

import { DeviceMapper } from '../src/mapping/DeviceMapper.ts'
import { ZwaveIntegration } from '../src/runtime/ZwaveIntegration.ts'
import type { GetNodesResponse, ZwaveNode } from '../src/types/zwave.ts'
import { createFakeGladys, createFakeLogger } from './helpers/fakes.ts'

/**
 * A value that never changes is only reported when the node is interviewed, so
 * a device that already existed when a new version added a feature — the
 * battery-low of a FGMS001, typically — would stare at an empty widget until
 * the node happened to change. The full `getNodes` answer holds that value:
 * this checks it is actually published.
 */

const SELECTOR = 'test-selector'
const NODE_ID = 50

const readNode = (id: number): ZwaveNode => {
  const { result } = JSON.parse(
    readFileSync(new URL('./fixtures/exampleNodes.json', import.meta.url), 'utf8'),
  ) as { result: ZwaveNode[] }
  const node = result.find((candidate) => candidate.id === id)
  assert.ok(node, `fixture node ${id}`)
  return node
}

/** `onNodes` is the private MQTT entry point; there is no public way in. */
type NodesHandler = { onNodes(message: GetNodesResponse): Promise<void> }

test('a full node list publishes the states of a device that already existed', async () => {
  const node = readNode(NODE_ID)
  const { published, gladys } = createFakeGladys(SELECTOR)
  const integration = new ZwaveIntegration(gladys, createFakeLogger())

  // The device is already in Gladys, with every feature the mapper produces:
  // this is the user who added it before, not one being created now.
  const mapper = new DeviceMapper((suffix) => `ext:${SELECTOR}:${suffix}`)
  const device = mapper.toDiscoveredDevice(node)
  integration.onDeviceUpdated(device as Device)

  await (integration as unknown as NodesHandler).onNodes({ success: true, result: [node] })
  await delay(400)

  const islow = published.find((state) =>
    state.device_feature_external_id.endsWith(':battery:islow'),
  )
  assert.ok(islow, 'the battery-low state must be published without waiting for a node report')
  assert.equal(islow.state, 0)

  await integration.stop()
})

test('states of features the user never created are not published', async () => {
  const node = readNode(NODE_ID)
  const { published, gladys } = createFakeGladys(SELECTOR)
  const integration = new ZwaveIntegration(gladys, createFakeLogger())

  // No device known: the budget must not be spent on what Gladys would ignore.
  await (integration as unknown as NodesHandler).onNodes({ success: true, result: [node] })
  await delay(400)

  assert.deepEqual(published, [])

  await integration.stop()
})
