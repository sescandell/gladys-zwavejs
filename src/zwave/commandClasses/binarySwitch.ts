import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk'

import { STATE } from '../stateValues.ts'
import type { CommandClassModule } from './types.ts'

/**
 * Binary Switch (0x25) — a plain on/off relay.
 *
 * Note that on a node that also speaks Multilevel Switch, these features are
 * dropped by the device quirks: the virtual on/off derived from the dimmer is
 * kept instead, because it stays synchronized with the position.
 */
export const binarySwitch: CommandClassModule = {
  id: 37,
  name: 'binary_switch',
  properties: {
    currentvalue: {
      self: {
        expose: [
          {
            name: '',
            spec: {
              category: DEVICE_FEATURE_CATEGORIES.SWITCH,
              type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
              min: 0,
              max: 1,
              read_only: false,
              has_feedback: false,
              keep_history: true,
            },
          },
        ],
        fromZwave: [
          {
            convert: (raw) => {
              if (raw === true) {
                return STATE.ON
              }
              if (raw === false) {
                return STATE.OFF
              }
              return null
            },
          },
        ],
        toZwave: {
          '': (value) => ({
            api: 'sendCommand',
            name: 'set',
            args: [value === STATE.ON],
            stateUpdates: [],
          }),
        },
      },
    },
  },
}
