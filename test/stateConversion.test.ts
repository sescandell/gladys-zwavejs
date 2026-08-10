import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { DeviceMapper } from '../src/mapping/DeviceMapper.ts'
import { parseFeatureId, featureSuffix } from '../src/mapping/externalId.ts'
import type { ZwaveNode, ZwaveValue } from '../src/types/zwave.ts'

/**
 * The other half of the ISO-functional guarantee: the golden test covers what
 * is discovered, this one covers what is read back from the network.
 */

const SELECTOR = 'test'
const mapper = new DeviceMapper((suffix) => `ext:${SELECTOR}:${suffix}`)

const { result: NODES } = JSON.parse(
  readFileSync(new URL('./fixtures/exampleNodes.json', import.meta.url), 'utf8'),
) as { result: ZwaveNode[] }

const node = (id: number): ZwaveNode => {
  const found = NODES.find((candidate) => candidate.id === id)
  assert.ok(found, `node ${id} missing from the fixture`)
  return found
}

/** Find a value of a node by command class, property and endpoint. */
const valueOf = (
  source: ZwaveNode,
  commandClass: number,
  property: string,
  endpoint = 0,
): ZwaveValue => {
  const found = Object.values(source.values ?? {}).find(
    (value) =>
      value.commandClass === commandClass &&
      value.propertyName === property &&
      (value.endpoint ?? 0) === endpoint,
  )
  assert.ok(found, `value ${commandClass}/${property}@${endpoint} missing`)
  return found
}

const convert = (source: ZwaveNode, value: ZwaveValue, raw: unknown) =>
  mapper
    .convertValue(source, value, raw)
    .map((state) => [state.featureExternalId, state.state] as const)

test('a dimmer position report feeds the position, the on/off state and restorePrevious', () => {
  const dimmer = node(6)
  const states = convert(dimmer, valueOf(dimmer, 38, 'currentValue'), 42)

  assert.deepEqual(states, [
    [`ext:${SELECTOR}:6:0:multilevel_switch:currentvalue:position`, 42],
    [`ext:${SELECTOR}:6:0:multilevel_switch:currentvalue:state`, 1],
    [`ext:${SELECTOR}:6:0:multilevel_switch:restoreprevious`, 1],
  ])
})

test('a dimmer at zero reports off on every derived feature', () => {
  const dimmer = node(6)
  const states = convert(dimmer, valueOf(dimmer, 38, 'currentValue'), 0)

  assert.deepEqual(
    states.map(([, value]) => value),
    [0, 0, 0],
  )
})

test('a shutter reports only its position, never a synthetic state', () => {
  // A moving shutter has no readable "opening" value: the state is a command.
  const shutter = node(5)
  const states = convert(shutter, valueOf(shutter, 38, 'currentValue', 1), 60)

  assert.deepEqual(states, [[`ext:${SELECTOR}:5:1:multilevel_switch:currentvalue:position`, 60]])
})

test('the Central Scene value scale maps to the Gladys button statuses', () => {
  const controller = node(9)
  const scene = valueOf(controller, 91, 'scene')

  assert.deepEqual(
    [0, 1, 2, 3, 4].map((raw) => convert(controller, scene, raw)[0]?.[1]),
    [1, 20, 5, 2, 18],
  )
  assert.deepEqual(convert(controller, scene, 99), [], 'an unknown scene value publishes nothing')
})

test('the door sensor notification maps 22/23 to open/close', () => {
  const sensor = node(2)
  const door = valueOf(sensor, 113, 'Access Control')

  assert.deepEqual(convert(sensor, door, 22), [
    [`ext:${SELECTOR}:2:0:notification:access_control:door_state_simple`, 0],
  ])
  assert.deepEqual(convert(sensor, door, 23), [
    [`ext:${SELECTOR}:2:0:notification:access_control:door_state_simple`, 1],
  ])
  assert.deepEqual(convert(sensor, door, 7), [], 'an unmapped notification publishes nothing')
})

test('a battery low flag only publishes on a real boolean', () => {
  const sensor = node(2)
  const isLow = valueOf(sensor, 128, 'isLow')

  assert.deepEqual(convert(sensor, isLow, true), [[`ext:${SELECTOR}:2:0:battery:islow`, 1]])
  assert.deepEqual(convert(sensor, isLow, false), [[`ext:${SELECTOR}:2:0:battery:islow`, 0]])
  assert.deepEqual(convert(sensor, isLow, null), [])
})

test('measurements are flagged sampled, buttons are flagged event', () => {
  const sensor = node(4)
  const temperature = mapper.convertValue(sensor, valueOf(sensor, 49, 'Air temperature'), 19.5)
  assert.deepEqual(
    temperature.map((s) => [s.sampled, s.event]),
    [[true, false]],
  )

  const controller = node(9)
  const scene = mapper.convertValue(controller, valueOf(controller, 91, 'scene'), 0)
  assert.deepEqual(
    scene.map((s) => [s.sampled, s.event]),
    [[false, true]],
  )

  const shutter = node(5)
  const position = mapper.convertValue(shutter, valueOf(shutter, 38, 'currentValue', 1), 60)
  assert.deepEqual(
    position.map((s) => [s.sampled, s.event]),
    [[false, false]],
  )
})

test('the initial snapshot reads the current values of the last getNodes', () => {
  // What a freshly created device shows instead of staying blank until the
  // sensor next wakes up — which for a battery motion sensor can be hours.
  const sensor = node(4)
  const discovered = new Set(
    (mapper.toDiscoveredDevice(sensor).features ?? []).map((feature) => feature.external_id),
  )

  const snapshot = new Map(
    mapper.snapshot(sensor).map((state) => [state.featureExternalId, state.state]),
  )

  // Every feature of the device that has a readable value is populated.
  assert.equal(snapshot.get(`ext:${SELECTOR}:4:0:multilevel_sensor:air_temperature`), 20.1)
  assert.equal(snapshot.get(`ext:${SELECTOR}:4:0:multilevel_sensor:illuminance`), 0)
  assert.equal(snapshot.get(`ext:${SELECTOR}:4:0:battery:level`), 100)
  assert.equal(snapshot.get(`ext:${SELECTOR}:4:0:binary_sensor:general_purpose`), 0)

  // The snapshot may also carry states for values the quirks removed from the
  // device (this Fibaro exposes a duplicate "Any" motion sensor). Harmless:
  // StatePublisher drops anything outside the created features — asserted
  // here so the contract is not accidental.
  assert.ok(
    [...snapshot.keys()].some((id) => !discovered.has(id)),
    'the fixture must exercise the surplus case',
  )
})

test('a feature id survives a build/parse round trip', () => {
  const cases = [
    {
      nodeId: 6,
      endpoint: 0,
      cc: 'Multilevel Switch',
      property: 'currentValue',
      key: null,
      name: 'position',
    },
    { nodeId: 9, endpoint: 0, cc: 'Central Scene', property: 'scene', key: '001', name: '' },
    {
      nodeId: 2,
      endpoint: 0,
      cc: 'Notification',
      property: 'Access Control',
      key: 'Door state (simple)',
      name: '',
    },
    { nodeId: 4, endpoint: 0, cc: 'Battery', property: 'level', key: null, name: '' },
  ]

  for (const { nodeId, endpoint, cc, property, key, name } of cases) {
    const externalId = `ext:${SELECTOR}:${featureSuffix(nodeId, cc, endpoint, property, key, name)}`
    const parsed = parseFeatureId(externalId, SELECTOR)
    assert.ok(parsed, externalId)
    assert.equal(parsed.nodeId, nodeId)
    assert.equal(parsed.endpoint, endpoint)
  }
})
