import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { DeviceMapper } from '../src/mapping/DeviceMapper.ts'
import type { ZwaveNode, ZwaveValue } from '../src/types/zwave.ts'

/**
 * Notification (0x71) Home Security / Motion sensor status: the binary motion
 * detector exposed by PIR sensors such as the Zipato ZP3102.
 *
 * Runs against `motionSensorNode.json`, built from a real getNodes dump of
 * that device — it lives in its own fixture because exampleNodes.json feeds
 * the golden test, whose reference output predates this device.
 */

const SELECTOR = 'test'
const externalId = (suffix: string) => `ext:${SELECTOR}:${suffix}`
const mapper = new DeviceMapper(externalId)

const sensor = JSON.parse(
  readFileSync(new URL('./fixtures/motionSensorNode.json', import.meta.url), 'utf8'),
) as ZwaveNode

const valueOf = (commandClass: number, property: string, propertyKey?: string): ZwaveValue => {
  const found = Object.values(sensor.values ?? {}).find(
    (value) =>
      value.commandClass === commandClass &&
      value.propertyName === property &&
      (propertyKey === undefined || value.propertyKey === propertyKey),
  )
  assert.ok(found, `value ${commandClass}/${property}/${propertyKey} missing from the fixture`)
  return found
}

const features = () => mapper.toDiscoveredDevice(sensor).features ?? []
const feature = (suffix: string) => {
  const found = features().find((entry) => entry.external_id === externalId(suffix))
  assert.ok(found, `${suffix} was not discovered`)
  return found
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

test('a motion sensor is discovered with its motion feature, and nothing for the unmapped notifications', () => {
  assert.deepEqual(
    features().map((entry) => entry.external_id.replace(`ext:${SELECTOR}:20:0:`, '')),
    ['notification:home_security:motion_sensor_status', 'battery:islow', 'battery:level'],
  )
})

test('the motion feature is a read-only binary motion sensor', () => {
  const motion = feature('20:0:notification:home_security:motion_sensor_status')

  assert.equal(motion.category, 'motion-sensor')
  assert.equal(motion.type, 'binary')
  assert.equal(motion.read_only, true)
  assert.equal(motion.has_feedback, true)
  assert.equal(motion.keep_history, true)
  assert.deepEqual([motion.min, motion.max], [0, 1])
  assert.equal(motion.name, '20-113-0-Home Security-Motion sensor status')
})

test('a newly created motion sensor is populated from the last known values', () => {
  const snapshot = new Map(
    mapper.snapshot(sensor).map((state) => [state.featureExternalId, state.state]),
  )

  assert.equal(
    snapshot.get(externalId('20:0:notification:home_security:motion_sensor_status')),
    0,
    'idle',
  )
})

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const convert = (value: ZwaveValue, raw: unknown) =>
  mapper.convertValue(sensor, value, raw).map((state) => [state.featureExternalId, state.state])

test('the Z-Wave Home Security motion scale maps to idle/motion', () => {
  const motion = valueOf(113, 'Home Security', 'Motion sensor status')

  assert.deepEqual(convert(motion, 0), [
    [externalId('20:0:notification:home_security:motion_sensor_status'), 0],
  ])
  assert.deepEqual(convert(motion, 8), [
    [externalId('20:0:notification:home_security:motion_sensor_status'), 1],
  ])
  assert.deepEqual(convert(motion, 3), [], 'an unmapped notification value publishes nothing')
})

test('the Cover status notification of the same Home Security type is not mapped', () => {
  const cover = valueOf(113, 'Home Security', 'Cover status')

  assert.deepEqual(convert(cover, 0), [])
  assert.deepEqual(convert(cover, 3), [])
})

test('the motion feature is neither sampled nor an event', () => {
  const motion = valueOf(113, 'Home Security', 'Motion sensor status')
  const state = mapper.convertValue(sensor, motion, 8)

  assert.deepEqual(
    state.map((s) => [s.sampled, s.event]),
    [[false, false]],
  )
})
