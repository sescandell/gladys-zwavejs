import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { DeviceMapper } from '../src/mapping/DeviceMapper.ts'
import type { ZwaveNode, ZwaveValue } from '../src/types/zwave.ts'

/**
 * Zooz ZEN55 LR (DC Signal Sensor): a wired smoke/CO detector bridge that
 * reports each alarm through the Notification (0x71) command class — property
 * `Smoke Alarm` / `CO Alarm`, property key `Sensor status`.
 *
 * Runs against `zooz-zen55Node.json`, rebuilt from a real debug dump — its own
 * fixture because exampleNodes.json feeds the golden test, whose reference
 * output predates this device.
 */

const SELECTOR = 'test'
const externalId = (suffix: string) => `ext:${SELECTOR}:${suffix}`
const mapper = new DeviceMapper(externalId)

const node = JSON.parse(
  readFileSync(new URL('./fixtures/zooz-zen55Node.json', import.meta.url), 'utf8'),
) as ZwaveNode

const valueOf = (commandClass: number, property: string, propertyKey?: string): ZwaveValue => {
  const found = Object.values(node.values ?? {}).find(
    (value) =>
      value.commandClass === commandClass &&
      value.propertyName === property &&
      (propertyKey === undefined || value.propertyKey === propertyKey),
  )
  assert.ok(found, `value ${commandClass}/${property}/${propertyKey} missing from the fixture`)
  return found
}

const device = () => mapper.toDiscoveredDevice(node)
const features = () => device().features ?? []
const feature = (suffix: string) => {
  const found = features().find((entry) => entry.external_id === externalId(suffix))
  assert.ok(found, `${suffix} was not discovered`)
  return found
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

test('the ZEN55 exposes exactly a smoke and a CO sensor, nothing for the raw alarm values', () => {
  assert.deepEqual(
    features().map((entry) => entry.external_id.replace(`ext:${SELECTOR}:42:0:`, '')),
    ['notification:smoke_alarm:sensor_status', 'notification:co_alarm:sensor_status'],
  )
})

test('the smoke feature is a read-only binary smoke sensor', () => {
  const smoke = feature('42:0:notification:smoke_alarm:sensor_status')

  assert.equal(smoke.category, 'smoke-sensor')
  assert.equal(smoke.type, 'binary')
  assert.equal(smoke.read_only, true)
  assert.equal(smoke.has_feedback, true)
  assert.equal(smoke.keep_history, true)
  assert.deepEqual([smoke.min, smoke.max], [0, 1])
  assert.equal(smoke.name, '42-113-0-Smoke Alarm-Sensor status')
})

test('the CO feature is a read-only binary CO sensor', () => {
  const co = feature('42:0:notification:co_alarm:sensor_status')

  assert.equal(co.category, 'co-sensor')
  assert.equal(co.type, 'binary')
  assert.equal(co.name, '42-113-0-CO Alarm-Sensor status')
})

test('a newly created ZEN55 is populated from the last known values (both idle)', () => {
  const snapshot = new Map(
    mapper.snapshot(node).map((state) => [state.featureExternalId, state.state]),
  )

  assert.equal(
    snapshot.get(externalId('42:0:notification:smoke_alarm:sensor_status')),
    0,
    'smoke idle',
  )
  assert.equal(snapshot.get(externalId('42:0:notification:co_alarm:sensor_status')), 0, 'CO idle')
})

// ---------------------------------------------------------------------------
// Technical parameters
// ---------------------------------------------------------------------------

test('the "Enabled Features" configuration parameter is surfaced as a device param', () => {
  const params = new Map((device().params ?? []).map((param) => [param.name, param.value]))

  assert.equal(params.get('location'), 'Chaufferie')
  assert.equal(params.get('enabled_features'), 'Relay, smoke & CO sensor')
})

test('a device with no such configuration value only carries its location', () => {
  const withoutConfig = JSON.parse(JSON.stringify(node)) as ZwaveNode
  delete (withoutConfig.values ?? {})['42-112-0-8']

  assert.deepEqual(mapper.toDiscoveredDevice(withoutConfig).params, [
    { name: 'location', value: 'Chaufferie' },
  ])
})

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const convert = (value: ZwaveValue, raw: unknown) =>
  mapper.convertValue(node, value, raw).map((state) => [state.featureExternalId, state.state])

test('the alarm sensor status scale maps 0 to idle and 2 to detected', () => {
  const smoke = valueOf(113, 'Smoke Alarm', 'Sensor status')

  assert.deepEqual(convert(smoke, 0), [
    [externalId('42:0:notification:smoke_alarm:sensor_status'), 0],
  ])
  assert.deepEqual(convert(smoke, 2), [
    [externalId('42:0:notification:smoke_alarm:sensor_status'), 1],
  ])
  assert.deepEqual(convert(smoke, 3), [], 'an unmapped notification value publishes nothing')
})

test('the CO alarm maps on its own feature', () => {
  const co = valueOf(113, 'CO Alarm', 'Sensor status')

  assert.deepEqual(convert(co, 2), [[externalId('42:0:notification:co_alarm:sensor_status'), 1]])
})

test('the raw alarmType / alarmLevel notification values are not mapped', () => {
  assert.deepEqual(convert(valueOf(113, 'alarmType'), 2), [])
  assert.deepEqual(convert(valueOf(113, 'alarmLevel'), 2), [])
})

test('the smoke feature is neither sampled nor an event', () => {
  const smoke = valueOf(113, 'Smoke Alarm', 'Sensor status')
  const state = mapper.convertValue(node, smoke, 2)

  assert.deepEqual(
    state.map((s) => [s.sampled, s.event]),
    [[false, false]],
  )
})
