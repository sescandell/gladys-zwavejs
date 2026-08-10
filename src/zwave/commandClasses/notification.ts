import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk'

import { OPENING_SENSOR_STATE } from '../stateValues.ts'
import type { CommandClassModule } from './types.ts'

/** Notification (0x71) — door/window state today, the notification catalog is huge. */
export const notification: CommandClassModule = {
  id: 113,
  name: 'notification',
  properties: {
    access_control: {
      keys: {
        door_state_simple: {
          expose: [
            {
              name: '',
              spec: {
                category: DEVICE_FEATURE_CATEGORIES.OPENING_SENSOR,
                type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
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
                if (raw === 22) {
                  return OPENING_SENSOR_STATE.OPEN
                }
                if (raw === 23) {
                  return OPENING_SENSOR_STATE.CLOSE
                }
                return null
              },
            },
          ],
        },
      },
    },
  },
}
