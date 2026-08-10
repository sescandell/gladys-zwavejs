import assert from 'node:assert/strict'
import test from 'node:test'

import { applyQuirks, type MappedFeature } from '../src/mapping/quirks.ts'
import type { ZwaveNode } from '../src/types/zwave.ts'

const BINARY_SWITCH = 37
const MULTILEVEL_SWITCH = 38
const BINARY_SENSOR = 48
const ALARM_SENSOR = 156

const entry = (
  name: string,
  commandClass: number,
  endpoint: number,
  propertyName = 'currentValue',
): MappedFeature<string> => ({ feature: name, commandClass, endpoint, propertyName })

const node = (overrides: Partial<ZwaveNode> = {}): ZwaveNode => ({ id: 1, ...overrides })

const names = (features: Array<MappedFeature<string>>) => features.map((f) => f.feature)

test('a dimmer hides the explicit binary switch sitting on the same endpoint', () => {
  const result = applyQuirks(
    [entry('dimmer', MULTILEVEL_SWITCH, 0), entry('relay', BINARY_SWITCH, 0)],
    node(),
  )

  assert.deepEqual(names(result), ['dimmer'])
})

test('a relay on another endpoint keeps its on/off control', () => {
  // A device mixing a dimmer on endpoint 1 and a plain relay on endpoint 2 has
  // no virtual on/off to offer the relay: dropping its Binary Switch would
  // leave that half of the device with no control at all.
  const result = applyQuirks(
    [entry('dimmer', MULTILEVEL_SWITCH, 1), entry('relay', BINARY_SWITCH, 2)],
    node(),
  )

  assert.deepEqual(names(result), ['dimmer', 'relay'])
})

test('a plain relay is untouched when no dimmer is present', () => {
  const result = applyQuirks([entry('relay', BINARY_SWITCH, 0)], node())

  assert.deepEqual(names(result), ['relay'])
})

test('the Fibaro FGMS-001 drops its alarm sensor and its redundant "Any" motion', () => {
  const result = applyQuirks(
    [
      entry('any', BINARY_SENSOR, 0, 'Any'),
      entry('general', BINARY_SENSOR, 0, 'General Purpose'),
      entry('alarm', ALARM_SENSOR, 0, 'state'),
    ],
    node({ deviceId: '271-4097-2048' }),
  )

  assert.deepEqual(names(result), ['general'])
})

test('a Fibaro without the General Purpose sensor keeps "Any"', () => {
  const result = applyQuirks(
    [entry('any', BINARY_SENSOR, 0, 'Any'), entry('alarm', ALARM_SENSOR, 0, 'state')],
    node({ deviceId: '271-4097-2048' }),
  )

  assert.deepEqual(names(result), ['any'])
})

test('another manufacturer keeps everything it exposes', () => {
  const features = [entry('any', BINARY_SENSOR, 0, 'Any'), entry('alarm', ALARM_SENSOR, 0, 'state')]

  assert.deepEqual(names(applyQuirks(features, node({ deviceId: '1-2-3' }))), ['any', 'alarm'])
})
