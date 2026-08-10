import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk'

import { THERMOSTAT_OPERATING_STATE } from '../stateValues.ts'
import type { CommandClassModule } from './types.ts'

/**
 * Thermostat Operating State (0x42) — read-only, what the thermostat is doing
 * right now. Distinct from the mode: a thermostat set to Heat is idle once the
 * room is warm enough, and this is the feature that says so.
 *
 * Z-Wave defines further states (fan only, pending heat, pending cool...);
 * they publish nothing rather than being folded into a state they are not.
 */
export const thermostatOperatingState: CommandClassModule = {
  id: 66,
  name: 'thermostat_operating_state',
  properties: {
    state: {
      self: {
        expose: [
          {
            name: '',
            spec: {
              category: DEVICE_FEATURE_CATEGORIES.THERMOSTAT,
              type: DEVICE_FEATURE_TYPES.THERMOSTAT.OPERATING_STATE,
              min: THERMOSTAT_OPERATING_STATE.IDLE,
              max: THERMOSTAT_OPERATING_STATE.COOLING,
              read_only: true,
              has_feedback: true,
              keep_history: true,
            },
          },
        ],
        fromZwave: [
          {
            convert: (raw) => {
              switch (raw) {
                case 0:
                  return THERMOSTAT_OPERATING_STATE.IDLE
                case 1:
                  return THERMOSTAT_OPERATING_STATE.HEATING
                case 2:
                  return THERMOSTAT_OPERATING_STATE.COOLING
                default:
                  return null
              }
            },
          },
        ],
      },
    },
  },
}
