import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk'

import { OPENING_SENSOR_STATE, STATE } from '../stateValues.ts'
import type { CommandClassModule, PropertyVariant } from './types.ts'

const ZWAVE_MOTION = {
  IDLE: 0,
  MOTION_DETECTION: 8,
}

const ZWAVE_OPENING = {
  OPENED: 22,
  CLOSED: 23,
}

/**
 * Notification (0x71) alarm sensor status scale, shared by the Smoke Alarm and
 * CO Alarm notification types: `0` is idle, `2` is "detected". Any other code
 * (unknown or a maintenance event) publishes nothing rather than freezing the
 * feature on a wrong value.
 */
const alarmSensorStatus = (category: string): PropertyVariant => ({
  expose: [
    {
      name: '',
      spec: {
        category,
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
        if (raw === 0) {
          return STATE.OFF
        }
        if (raw === 2) {
          return STATE.ON
        }
        return null
      },
    },
  ],
})

/**
 * Notification (0x71) — door/window state, motion, and the smoke / CO alarm
 * sensor status; the notification catalog is huge, only what a real device
 * reported is mapped.
 */
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
            },
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
        },
      },
    },
    // Smoke & CO bridges such as the Zooz ZEN55 report the wired detector state
    // through these two notification types (`Sensor status` property key).
    smoke_alarm: {
      keys: {
        sensor_status: alarmSensorStatus(DEVICE_FEATURE_CATEGORIES.SMOKE_SENSOR),
      },
    },
    co_alarm: {
      keys: {
        sensor_status: alarmSensorStatus(DEVICE_FEATURE_CATEGORIES.CO_SENSOR),
      },
    },
  },
}
