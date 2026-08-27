import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk'

import { OPENING_SENSOR_STATE, STATE } from '../stateValues.ts'
import type { CommandClassModule } from './types.ts'

const ZWAVE_MOTION = {
  IDLE: 0,
  MOTION_DETECTION: 8
}

const ZWAVE_OPENING = {
  OPENED: 22,
  CLOSED: 23
}

/** Notification (0x71) — door/window state + motion today, the notification catalog is huge. */
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
                if (raw === ZWAVE_OPENING.OPENED) {
                  return OPENING_SENSOR_STATE.OPEN
                }
                if (raw === ZWAVE_OPENING.CLOSED) {
                  return OPENING_SENSOR_STATE.CLOSE
                }
                return null
              },
            },
          ],
        },
      },
    },
    home_security: {
      keys: {
        motion_sensor_status: {
          expose: [
            {
              name: '',
              spec: {
                category: DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR,
                type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
                min: 0,
                max: 1,
                read_only: true,
                has_feedback: true,
                keep_history: true,
              },
            }
          ],
          fromZwave: [
            {
              convert: (raw) => {
                if (raw === ZWAVE_MOTION.IDLE) {
                  return STATE.OFF
                }
                if (raw === ZWAVE_MOTION.MOTION_DETECTION) {
                  return STATE.ON
                }
                return null
              },
            },
          ],
        }
      }
    },
  },
}
