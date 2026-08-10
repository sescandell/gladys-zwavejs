import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk'

import { STATE } from '../stateValues.ts'
import type { CommandClassModule, FeatureSpec, PropertyNode } from './types.ts'

const booleanState = (raw: unknown): number | null => {
  if (raw === true) {
    return STATE.ON
  }
  if (raw === false) {
    return STATE.OFF
  }
  return null
}

const motionSpec: FeatureSpec = {
  category: DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR,
  type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
  min: 0,
  max: 1,
  read_only: true,
  has_feedback: true,
  keep_history: true,
}

const binaryProperty: PropertyNode = {
  self: {
    expose: [{ name: '', spec: motionSpec }],
    fromZwave: [{ convert: booleanState }],
  },
}

/**
 * `sensorType` values of the Binary Sensor command class that map to a more
 * precise Gladys category than the generic motion sensor.
 */
const SENSOR_TYPE_CATEGORIES: Readonly<Record<number, string>> = {
  0x02: DEVICE_FEATURE_CATEGORIES.SMOKE_SENSOR,
  0x03: DEVICE_FEATURE_CATEGORIES.CO_SENSOR,
  0x04: DEVICE_FEATURE_CATEGORIES.CO2_SENSOR,
  0x05: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
  0x06: DEVICE_FEATURE_CATEGORIES.LEAK_SENSOR,
  0x07: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
  0x0a: DEVICE_FEATURE_CATEGORIES.OPENING_SENSOR,
  0x0b: DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR,
  0x0c: DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR,
}

/**
 * Binary Sensor (0x30) — a boolean sensor whose real nature (smoke, leak,
 * opening...) is only known from the `ccSpecific.sensorType` metadata.
 */
export const binarySensor: CommandClassModule = {
  id: 48,
  name: 'binary_sensor',
  properties: {
    any: binaryProperty,
    general_purpose: binaryProperty,
  },
  refineCategory: (spec, value) => {
    if (spec.category !== DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR) {
      return spec
    }
    const sensorType = value.ccSpecific?.sensorType ?? -1
    const category = SENSOR_TYPE_CATEGORIES[sensorType]
    return category ? { ...spec, category } : spec
  },
}
