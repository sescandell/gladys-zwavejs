import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk'

import type { CommandClassModule, FeatureSpec, PropertyVariant } from './types.ts'

const identity = (raw: unknown): number | null => (typeof raw === 'number' ? raw : null)

/** Energy meters are the noisiest source on a Z-Wave network: always sampled. */
function reading(spec: FeatureSpec): PropertyVariant {
  return {
    expose: [{ name: '', sampled: true, spec }],
    fromZwave: [{ convert: identity }],
  }
}

/**
 * Meter (0x32) — energy metering. Every reading lives under the `value`
 * property, discriminated by its property key (`Electric_W_Consumed`...).
 */
export const meter: CommandClassModule = {
  id: 50,
  name: 'meter',
  properties: {
    value: {
      keys: {
        electric_a_consumed: reading({
          category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
          type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.CURRENT,
          unit: DEVICE_FEATURE_UNITS.AMPERE,
          min: 0,
          max: 1000,
          read_only: true,
          has_feedback: false,
          keep_history: true,
        }),
        electric_kwh_consumed: reading({
          category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
          type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.ENERGY,
          unit: DEVICE_FEATURE_UNITS.KILOWATT_HOUR,
          min: 0,
          max: 1000000,
          read_only: true,
          has_feedback: false,
          keep_history: true,
        }),
        electric_v_consumed: reading({
          category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
          type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.VOLTAGE,
          unit: DEVICE_FEATURE_UNITS.VOLT,
          min: 0,
          max: 10000,
          read_only: true,
          has_feedback: false,
          keep_history: true,
        }),
        electric_w_consumed: reading({
          category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
          type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.POWER,
          unit: DEVICE_FEATURE_UNITS.WATT,
          min: 0,
          max: 1000000,
          read_only: true,
          has_feedback: false,
          keep_history: true,
        }),
      },
    },
  },
}
