import assert from 'node:assert/strict'
import test from 'node:test'

import { CommandDispatcher } from '../src/runtime/CommandDispatcher.ts'
import type { PendingState } from '../src/runtime/state.ts'
import { buildTopics } from '../src/zwave/topics.ts'
import { createFakeLogger } from './helpers/fakes.ts'

/**
 * The MQTT payloads are asserted field for field: they are the contract with
 * Z-Wave JS UI, and a wrong argument shape fails silently on the broker rather
 * than raising anything on our side.
 */

const SELECTOR = 'test'
const topics = buildTopics({ prefix: 'zwave', gateway: 'ZWAVE_GATEWAY-zwave-js-ui' })

function setup() {
  const published: Array<{ topic: string; payload: unknown }> = []
  const states: PendingState[] = []
  const dispatcher = new CommandDispatcher({
    logger: createFakeLogger(),
    selector: SELECTOR,
    externalId: (suffix) => `ext:${SELECTOR}:${suffix}`,
    topics: () => topics,
    publish: (topic, payload) => published.push({ topic, payload: JSON.parse(payload) }),
    pushStates: (pending) => states.push(...pending),
  })
  return { dispatcher, published, states }
}

const feature = (externalId: string, category: string) => ({
  external_id: `ext:${SELECTOR}:${externalId}`,
  category,
  type: 'binary',
})
const device = { external_id: `ext:${SELECTOR}:6` }

test('a binary switch sends a boolean set command', () => {
  const { dispatcher, published } = setup()

  dispatcher.setValue(device, feature('3:0:binary_switch:currentvalue', 'switch'), 1)

  assert.deepEqual(published, [
    {
      topic: 'zwave/_CLIENTS/ZWAVE_GATEWAY-zwave-js-ui/api/sendCommand/set',
      payload: { args: [{ nodeId: 3, commandClass: 37, endpoint: 0 }, 'set', [true]] },
    },
  ])
})

test('turning a dimmer on sets 99 and syncs its position and restorePrevious', () => {
  const { dispatcher, published, states } = setup()

  dispatcher.setValue(device, feature('6:0:multilevel_switch:currentvalue:state', 'switch'), 1)

  assert.deepEqual(published[0]?.payload, {
    args: [{ nodeId: 6, commandClass: 38, endpoint: 0 }, 'set', [99]],
  })
  assert.deepEqual(
    states.map((entry) => [entry.featureExternalId, entry.state]),
    [
      [`ext:${SELECTOR}:6:0:multilevel_switch:currentvalue:position`, 99],
      [`ext:${SELECTOR}:6:0:multilevel_switch:restoreprevious`, 1],
    ],
  )
})

test('setting a dimmer position syncs its virtual on/off state', () => {
  const { dispatcher, published, states } = setup()

  dispatcher.setValue(device, feature('6:0:multilevel_switch:currentvalue:position', 'switch'), 42)

  assert.deepEqual(published[0]?.payload, {
    args: [{ nodeId: 6, commandClass: 38, endpoint: 0 }, 'set', [42]],
  })
  assert.deepEqual(
    states.map((entry) => [entry.featureExternalId, entry.state]),
    [
      [`ext:${SELECTOR}:6:0:multilevel_switch:currentvalue:state`, 1],
      [`ext:${SELECTOR}:6:0:multilevel_switch:restoreprevious`, 1],
    ],
  )
})

test('restorePrevious ON writes the value instead of sending a command', () => {
  const { dispatcher, published, states } = setup()

  dispatcher.setValue(device, feature('6:0:multilevel_switch:restoreprevious', 'switch'), 1)

  assert.deepEqual(published, [
    {
      topic: 'zwave/_CLIENTS/ZWAVE_GATEWAY-zwave-js-ui/api/writeValue/set',
      payload: {
        args: [{ nodeId: 6, commandClass: 38, endpoint: 0, property: 'restorePrevious' }, true],
      },
    },
  ])
  // The device reports its own new position afterwards: nothing to sync.
  assert.deepEqual(states, [])
})

test('restorePrevious OFF sets 0 and syncs both sibling features', () => {
  const { dispatcher, published, states } = setup()

  dispatcher.setValue(device, feature('6:0:multilevel_switch:restoreprevious', 'switch'), 0)

  assert.deepEqual(published[0]?.payload, {
    args: [{ nodeId: 6, commandClass: 38, endpoint: 0 }, 'set', [0]],
  })
  assert.deepEqual(
    states.map((entry) => [entry.featureExternalId, entry.state]),
    [
      [`ext:${SELECTOR}:6:0:multilevel_switch:currentvalue:state`, 0],
      [`ext:${SELECTOR}:6:0:multilevel_switch:currentvalue:position`, 0],
    ],
  )
})

test('the shutter variant is chosen by the feature category, not by the node cache', () => {
  // Same command class, same property, same value 0 — but 0 means STOP for a
  // shutter and OFF for a dimmer. The Gladys category is what tells them apart,
  // which is why a command works even with a cold cache.
  const { dispatcher, published } = setup()

  dispatcher.setValue(device, feature('5:1:multilevel_switch:currentvalue:state', 'shutter'), 0)

  assert.deepEqual(published[0]?.payload, {
    args: [{ nodeId: 5, commandClass: 38, endpoint: 1 }, 'stopLevelChange', []],
  })
})

test('opening and closing a shutter sets the extreme positions', () => {
  const open = setup()
  open.dispatcher.setValue(
    device,
    feature('5:1:multilevel_switch:currentvalue:state', 'shutter'),
    1,
  )
  assert.deepEqual(open.published[0]?.payload, {
    args: [{ nodeId: 5, commandClass: 38, endpoint: 1 }, 'set', [99]],
  })
  assert.deepEqual(
    open.states.map((entry) => entry.state),
    [99],
  )

  const close = setup()
  close.dispatcher.setValue(
    device,
    feature('5:1:multilevel_switch:currentvalue:state', 'shutter'),
    -1,
  )
  assert.deepEqual(close.published[0]?.payload, {
    args: [{ nodeId: 5, commandClass: 38, endpoint: 1 }, 'set', [0]],
  })
})

test('a shutter position command carries no sibling state', () => {
  const { dispatcher, published, states } = setup()

  dispatcher.setValue(device, feature('5:2:multilevel_switch:currentvalue:position', 'shutter'), 60)

  assert.deepEqual(published[0]?.payload, {
    args: [{ nodeId: 5, commandClass: 38, endpoint: 2 }, 'set', [60]],
  })
  assert.deepEqual(states, [])
})

test('a read-only feature is refused rather than silently ignored', () => {
  const { dispatcher } = setup()

  assert.throws(
    () => dispatcher.setValue(device, feature('4:0:battery:level', 'battery'), 50),
    /not commandable/,
  )
})

test('an external id from another integration is refused', () => {
  const { dispatcher } = setup()

  assert.throws(
    () =>
      dispatcher.setValue(
        device,
        {
          external_id: 'ext:other:1:0:binary_switch:currentvalue',
          category: 'switch',
          type: 'binary',
        },
        1,
      ),
    /Unknown Z-Wave feature id/,
  )
})
