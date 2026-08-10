import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { DeviceMapper } from '../src/mapping/DeviceMapper.ts'
import { CommandDispatcher } from '../src/runtime/CommandDispatcher.ts'
import type { PendingState } from '../src/runtime/state.ts'
import type { ZwaveNode, ZwaveValue } from '../src/types/zwave.ts'
import { buildTopics } from '../src/zwave/topics.ts'
import { createFakeLogger } from './helpers/fakes.ts'

/**
 * Thermostat support: Thermostat Mode (0x40), Operating State (0x42) and
 * Setpoint (0x43).
 *
 * Everything runs against `thermostatNode.json`, a real thermostat node whose
 * shape comes from the fixtures of Gladys PR #2730 (validated there against a
 * Heatit Z-TRM6) — not from values written to fit the implementation.
 */

const SELECTOR = 'test'
const externalId = (suffix: string) => `ext:${SELECTOR}:${suffix}`
const mapper = new DeviceMapper(externalId)

const thermostat = JSON.parse(
  readFileSync(new URL('./fixtures/thermostatNode.json', import.meta.url), 'utf8'),
) as ZwaveNode

const valueOf = (commandClass: number, property: string, propertyKey?: number): ZwaveValue => {
  const found = Object.values(thermostat.values ?? {}).find(
    (value) =>
      value.commandClass === commandClass &&
      value.propertyName === property &&
      (propertyKey === undefined || value.propertyKey === propertyKey),
  )
  assert.ok(found, `value ${commandClass}/${property}/${propertyKey} missing from the fixture`)
  return found
}

const features = () => mapper.toDiscoveredDevice(thermostat).features ?? []
const feature = (suffix: string) => {
  const found = features().find((entry) => entry.external_id === externalId(suffix))
  assert.ok(found, `${suffix} was not discovered`)
  return found
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

test('a thermostat is discovered with its five features and nothing else', () => {
  assert.deepEqual(
    features().map((entry) => entry.external_id.replace(`ext:${SELECTOR}:16:1:`, '')),
    [
      'thermostat_mode:mode',
      'thermostat_operating_state:state',
      'thermostat_setpoint:setpoint:heating',
      'thermostat_setpoint:setpoint:cooling',
      'thermostat_setpoint:setpoint:energy_save_heating',
    ],
  )
})

test('a newly created thermostat is populated from the last known values', () => {
  const snapshot = new Map(
    mapper.snapshot(thermostat).map((state) => [state.featureExternalId, state.state]),
  )

  assert.equal(snapshot.get(externalId('16:1:thermostat_mode:mode')), 1, 'heating')
  assert.equal(snapshot.get(externalId('16:1:thermostat_operating_state:state')), 1, 'heating')
  assert.equal(snapshot.get(externalId('16:1:thermostat_setpoint:setpoint:heating')), 21)
  assert.equal(
    snapshot.get(externalId('16:1:thermostat_setpoint:setpoint:energy_save_heating')),
    17,
  )
})

test('the thermostat mode is discovered as a writable thermostat mode feature', () => {
  const mode = feature('16:1:thermostat_mode:mode')

  assert.equal(mode.category, 'thermostat')
  assert.equal(mode.type, 'mode')
  assert.equal(mode.read_only, false)
  assert.equal(mode.has_feedback, true)
  assert.deepEqual([mode.min, mode.max], [0, 3])
})

test('each setpoint type becomes its own temperature feature', () => {
  const heating = feature('16:1:thermostat_setpoint:setpoint:heating')
  const cooling = feature('16:1:thermostat_setpoint:setpoint:cooling')
  const eco = feature('16:1:thermostat_setpoint:setpoint:energy_save_heating')

  assert.deepEqual([heating.category, heating.type], ['thermostat', 'target-temperature'])
  // A cooling setpoint is air conditioning, not heating.
  assert.deepEqual([cooling.category, cooling.type], ['air-conditioning', 'target-temperature'])
  assert.deepEqual([eco.category, eco.type], ['thermostat', 'target-temperature'])

  for (const entry of [heating, cooling, eco]) {
    assert.equal(entry.unit, 'celsius')
    assert.equal(entry.read_only, false)
    assert.deepEqual([entry.min, entry.max], [5, 40])
  }
})

test('a setpoint is named after its type, not after the endpoint that shares its digit', () => {
  // `16-67-1-setpoint-1`: the property key 1 also appears in the node id and
  // in the endpoint. Only an anchored substitution names this correctly.
  assert.equal(
    feature('16:1:thermostat_setpoint:setpoint:heating').name,
    '16-67-1-setpoint-Heating',
  )
  assert.equal(
    feature('16:1:thermostat_setpoint:setpoint:cooling').name,
    '16-67-1-setpoint-Cooling',
  )
  assert.equal(
    feature('16:1:thermostat_setpoint:setpoint:energy_save_heating').name,
    '16-67-1-setpoint-Energy Save Heating',
  )
})

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const convert = (value: ZwaveValue, raw: unknown) =>
  mapper.convertValue(thermostat, value, raw).map((state) => [state.featureExternalId, state.state])

test('the Z-Wave mode scale maps onto the Gladys thermostat modes', () => {
  const mode = valueOf(64, 'mode')
  const read = (raw: number) => convert(mode, raw)[0]?.[1]

  assert.equal(read(0), 0, 'off')
  assert.equal(read(1), 1, 'heat')
  assert.equal(read(2), 2, 'cool')
  assert.equal(read(3), 3, 'auto')
  // Energy save heat has no Gladys equivalent: the thermostat IS heating, and
  // that is what must not be misreported.
  assert.equal(read(11), 1, 'energy save heat reads as heating')
  assert.deepEqual(convert(mode, 7), [], 'an unsupported mode publishes nothing')
})

test('a setpoint report lands on the feature of its own setpoint type', () => {
  assert.deepEqual(convert(valueOf(67, 'setpoint', 1), 21.5), [
    [externalId('16:1:thermostat_setpoint:setpoint:heating'), 21.5],
  ])
  assert.deepEqual(convert(valueOf(67, 'setpoint', 11), 17), [
    [externalId('16:1:thermostat_setpoint:setpoint:energy_save_heating'), 17],
  ])
})

test('the operating state is discovered as a read-only thermostat feature', () => {
  const state = feature('16:1:thermostat_operating_state:state')

  assert.equal(state.category, 'thermostat')
  assert.equal(state.type, 'operating-state')
  assert.equal(state.read_only, true)
  assert.equal(state.name, '16-66-1-state')
})

test('idle, heating and cooling are reported; the other Z-Wave states are not invented', () => {
  const read = (raw: number) =>
    mapper.convertValue(thermostat, valueOf(66, 'state'), raw).map((state) => state.state)

  assert.deepEqual(read(0), [0], 'idle')
  assert.deepEqual(read(1), [1], 'heating')
  assert.deepEqual(read(2), [2], 'cooling')
  // Fan only, pending heat, pending cool... have no Gladys equivalent: better
  // no state than a state the thermostat is not in.
  assert.deepEqual(read(3), [])
})

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

const topics = buildTopics({ prefix: 'zwave', gateway: 'ZWAVE_GATEWAY-zwave-js-ui' })

function setup() {
  const published: Array<{ topic: string; payload: unknown }> = []
  const states: PendingState[] = []
  const dispatcher = new CommandDispatcher({
    logger: createFakeLogger(),
    selector: SELECTOR,
    externalId,
    topics: () => topics,
    publish: (topic, payload) => published.push({ topic, payload: JSON.parse(payload) }),
    pushStates: (pending) => states.push(...pending),
  })
  return { dispatcher, published }
}

const device = { external_id: externalId('16') }

test('setting the mode writes the matching Z-Wave mode', () => {
  const cases: Array<[number, number]> = [
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 3],
  ]

  for (const [gladysMode, zwaveMode] of cases) {
    const { dispatcher, published } = setup()
    dispatcher.setValue(
      device,
      {
        external_id: externalId('16:1:thermostat_mode:mode'),
        category: 'thermostat',
        type: 'mode',
      },
      gladysMode,
    )
    assert.deepEqual(published, [
      {
        topic: 'zwave/_CLIENTS/ZWAVE_GATEWAY-zwave-js-ui/api/writeValue/set',
        payload: {
          args: [{ nodeId: 16, commandClass: 64, endpoint: 1, property: 'mode' }, zwaveMode],
        },
      },
    ])
  }
})

test('writing a setpoint carries its propertyKey, or it would hit the wrong setpoint', () => {
  const cases: Array<[string, string, number]> = [
    ['heating', 'thermostat', 1],
    ['cooling', 'air-conditioning', 2],
    ['energy_save_heating', 'thermostat', 11],
  ]

  for (const [key, category, propertyKey] of cases) {
    const { dispatcher, published } = setup()
    dispatcher.setValue(
      device,
      {
        external_id: externalId(`16:1:thermostat_setpoint:setpoint:${key}`),
        category,
        type: 'target-temperature',
      },
      19.5,
    )
    assert.deepEqual(
      published[0]?.payload,
      {
        args: [
          { nodeId: 16, commandClass: 67, endpoint: 1, property: 'setpoint', propertyKey },
          19.5,
        ],
      },
      key,
    )
  }
})

test('the operating state is read-only and cannot be commanded', () => {
  const { dispatcher } = setup()

  assert.throws(
    () =>
      dispatcher.setValue(
        device,
        {
          external_id: externalId('16:1:thermostat_operating_state:state'),
          category: 'thermostat',
          type: 'operating-state',
        },
        1,
      ),
    /not commandable/,
  )
})
