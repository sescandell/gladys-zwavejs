import assert from 'node:assert/strict'
import test from 'node:test'

import { buildFeatureName } from '../src/mapping/featureName.ts'
import type { ZwaveValue } from '../src/types/zwave.ts'

/**
 * Feature naming. The cases below are ported from the test suite of
 * https://github.com/GladysAssistant/Gladys/pull/2730, which is where the
 * property-key substitution was pinned down.
 *
 * The name is user-facing: it is what the user reads when a device exposes
 * several equivalent features, and it is persisted with the device.
 */

const value = (fields: Partial<ZwaveValue> & { id: string }): ZwaveValue =>
  ({
    nodeId: 0,
    commandClass: 0,
    commandClassName: '',
    property: '',
    propertyName: '',
    propertyKey: null,
    propertyKeyName: null,
    ...fields,
  }) as ZwaveValue

test('an id without a property key is kept as-is', () => {
  assert.equal(buildFeatureName(value({ id: '16-64-1-mode' }), ''), '16-64-1-mode')
})

test('the exposed feature name is appended', () => {
  assert.equal(
    buildFeatureName(value({ id: '5-38-1-currentValue' }), 'position'),
    '5-38-1-currentValue:position',
  )
})

test('a numeric property key is replaced by its readable name', () => {
  assert.equal(
    buildFeatureName(
      value({
        id: '6-50-1-value-65537',
        propertyKey: 65537,
        propertyKeyName: 'Electric_kWh_Consumed',
      }),
      '',
    ),
    '6-50-1-value-Electric_kWh_Consumed',
  )
})

test('a property key colliding with a digit earlier in the id does not corrupt it', () => {
  // Node 16, Thermostat Setpoint, endpoint 1, Heating setpoint (key 1): the
  // "1" appears three times before the one that matters. Replacing the first
  // occurrence yields "Heating-67-1-setpoint-1".
  assert.equal(
    buildFeatureName(
      value({ id: '16-67-1-setpoint-1', propertyKey: 1, propertyKeyName: 'Heating' }),
      '',
    ),
    '16-67-1-setpoint-Heating',
  )
})

test('each setpoint type gets its own readable name', () => {
  assert.equal(
    buildFeatureName(
      value({ id: '16-67-1-setpoint-2', propertyKey: 2, propertyKeyName: 'Cooling' }),
      '',
    ),
    '16-67-1-setpoint-Cooling',
  )
  assert.equal(
    buildFeatureName(
      value({ id: '16-67-1-setpoint-11', propertyKey: 11, propertyKeyName: 'Energy Save Heating' }),
      '',
    ),
    '16-67-1-setpoint-Energy Save Heating',
  )
})

test('the substitution happens before the exposed name is appended', () => {
  // Otherwise the id no longer ends with the property key by the time the
  // substitution runs, and it silently never fires.
  assert.equal(
    buildFeatureName(
      value({ id: '16-67-1-setpoint-1', propertyKey: 1, propertyKeyName: 'Heating' }),
      'target',
    ),
    '16-67-1-setpoint-Heating:target',
  )
})

test('nothing is replaced when the key and its name are the same', () => {
  assert.equal(
    buildFeatureName(
      value({ id: '13-91-0-scene-001', propertyKey: '001', propertyKeyName: '001' }),
      '',
    ),
    '13-91-0-scene-001',
  )
})
