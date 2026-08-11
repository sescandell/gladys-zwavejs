import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk'

import { THERMOSTAT_MODE } from '../stateValues.ts'
import type { CommandClassModule } from './types.ts'
import { writeValue } from './types.ts'

/** Mode values defined by the Z-Wave Thermostat Mode command class. */
const ZWAVE_MODE = {
  OFF: 0,
  HEAT: 1,
  COOL: 2,
  AUTO: 3,
  /**
   * "Energy Save Heat" — heat, but to the eco setpoint. Gladys has no such
   * mode, so it is REPORTED as heating: the thermostat is heating, and that is
   * the part the user must not be misled about. The eco temperature itself
   * stays reachable through the dedicated setpoint feature.
   *
   * The consequence is one-way: selecting "Heating" in Gladys writes the plain
   * heat mode, so a device sitting in energy-save heat leaves it as soon as the
   * user touches the mode.
   */
  ENERGY_SAVE_HEAT: 11,
} as const

/** Thermostat Mode (0x40) — what the thermostat is asked to do. */
export const thermostatMode: CommandClassModule = {
  id: 64,
  name: 'thermostat_mode',
  properties: {
    mode: {
      self: {
        expose: [
          {
            name: '',
            spec: {
              category: DEVICE_FEATURE_CATEGORIES.THERMOSTAT,
              type: DEVICE_FEATURE_TYPES.THERMOSTAT.MODE,
              min: THERMOSTAT_MODE.OFF,
              // The bound is what the Gladys UI uses to decide which modes to
              // offer. Off and Heating are always shown; Cooling and Auto only
              // up to `max`. A heat-only thermostat will therefore still be
              // offered Cool and Auto, and simply ignore them — Z-Wave does not
              // reliably advertise the modes a device supports.
              max: THERMOSTAT_MODE.AUTO,
              read_only: false,
              has_feedback: false,
              keep_history: true,
            },
          },
        ],
        fromZwave: [
          {
            convert: (raw) => {
              switch (raw) {
                case ZWAVE_MODE.OFF:
                  return THERMOSTAT_MODE.OFF
                case ZWAVE_MODE.HEAT:
                case ZWAVE_MODE.ENERGY_SAVE_HEAT:
                  return THERMOSTAT_MODE.HEATING
                case ZWAVE_MODE.COOL:
                  return THERMOSTAT_MODE.COOLING
                case ZWAVE_MODE.AUTO:
                  return THERMOSTAT_MODE.AUTO
                default:
                  return null
              }
            },
          },
        ],
        toZwave: {
          '': (value) => {
            switch (value) {
              case THERMOSTAT_MODE.OFF:
                return writeValue('mode', ZWAVE_MODE.OFF)
              case THERMOSTAT_MODE.COOLING:
                return writeValue('mode', ZWAVE_MODE.COOL)
              case THERMOSTAT_MODE.AUTO:
                return writeValue('mode', ZWAVE_MODE.AUTO)
              default:
                return writeValue('mode', ZWAVE_MODE.HEAT)
            }
          },
        },
      },
    },
  },
}
