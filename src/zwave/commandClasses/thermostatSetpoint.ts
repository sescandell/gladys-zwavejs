import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk'

import type { CommandClassModule, FeatureSpec, PropertyVariant } from './types.ts'
import { writeValue } from './types.ts'

/** Setpoint types defined by the Z-Wave Thermostat Setpoint command class. */
const ZWAVE_SETPOINT_TYPE = {
  HEATING: 1,
  COOLING: 2,
  ENERGY_SAVE_HEATING: 11,
} as const

/**
 * A thermostat exposes several setpoints under the SAME `setpoint` property,
 * discriminated by their property key. Writing one therefore has to carry that
 * key, or the write lands on whichever setpoint zwave-js resolves first.
 */
function setpoint(spec: FeatureSpec, zwaveType: number): PropertyVariant {
  return {
    expose: [{ name: '', spec }],
    fromZwave: [{ convert: (raw) => (typeof raw === 'number' ? raw : null) }],
    toZwave: { '': (value) => writeValue('setpoint', value, [], zwaveType) },
  }
}

/**
 * Bounds and unit are declared, not read from the device: Z-Wave reports them
 * per value, but a feature template is static. 5-40 °C covers domestic
 * thermostats; a device reporting in Fahrenheit would be mislabelled.
 */
const temperature = (category: string, type: string): FeatureSpec => ({
  category,
  type,
  unit: DEVICE_FEATURE_UNITS.CELSIUS,
  min: 5,
  max: 40,
  read_only: false,
  has_feedback: true,
  keep_history: true,
})

/** Thermostat Setpoint (0x43) — the target temperatures. */
export const thermostatSetpoint: CommandClassModule = {
  id: 67,
  name: 'thermostat_setpoint',
  properties: {
    setpoint: {
      keys: {
        heating: setpoint(
          temperature(
            DEVICE_FEATURE_CATEGORIES.THERMOSTAT,
            DEVICE_FEATURE_TYPES.THERMOSTAT.TARGET_TEMPERATURE,
          ),
          ZWAVE_SETPOINT_TYPE.HEATING,
        ),
        cooling: setpoint(
          temperature(
            DEVICE_FEATURE_CATEGORIES.AIR_CONDITIONING,
            DEVICE_FEATURE_TYPES.AIR_CONDITIONING.TARGET_TEMPERATURE,
          ),
          ZWAVE_SETPOINT_TYPE.COOLING,
        ),
        // The eco temperature. It stays reachable even though "energy save
        // heat" has no Gladys mode of its own (see thermostatMode).
        energy_save_heating: setpoint(
          temperature(
            DEVICE_FEATURE_CATEGORIES.THERMOSTAT,
            DEVICE_FEATURE_TYPES.THERMOSTAT.TARGET_TEMPERATURE,
          ),
          ZWAVE_SETPOINT_TYPE.ENERGY_SAVE_HEATING,
        ),
      },
    },
  },
}
