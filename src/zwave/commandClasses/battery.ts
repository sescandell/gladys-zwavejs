import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk'

import { STATE } from '../stateValues.ts'
import type { CommandClassModule } from './types.ts'

/** Battery (0x80) — charge level and the low-battery flag. */
export const battery: CommandClassModule = {
  id: 128,
  name: 'battery',
  properties: {
    level: {
      self: {
        expose: [
          {
            name: '',
            // A battery level drifts slowly and reports often: only the last
            // reading of a window is worth publishing.
            sampled: true,
            spec: {
              category: DEVICE_FEATURE_CATEGORIES.BATTERY,
              type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
              unit: DEVICE_FEATURE_UNITS.PERCENT,
              min: 0,
              max: 100,
              read_only: true,
              has_feedback: true,
              keep_history: true,
            },
          },
        ],
        fromZwave: [{ convert: (raw) => (typeof raw === 'number' ? raw : null) }],
      },
    },
    islow: {
      self: {
        expose: [
          {
            name: '',
            spec: {
              category: DEVICE_FEATURE_CATEGORIES.BATTERY_LOW,
              type: DEVICE_FEATURE_TYPES.BATTERY_LOW.BINARY,
              min: 0,
              max: 1,
              read_only: true,
              has_feedback: true,
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
      },
    },
  },
}
