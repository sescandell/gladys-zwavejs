import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk'

import { STATE } from '../stateValues.ts'
import type { CommandClassModule } from './types.ts'

/** Same idea as the Binary Sensor, with the legacy Alarm Sensor sensorType scale. */
const SENSOR_TYPE_CATEGORIES: Readonly<Record<number, string>> = {
  0x01: DEVICE_FEATURE_CATEGORIES.SMOKE_SENSOR,
  0x02: DEVICE_FEATURE_CATEGORIES.CO_SENSOR,
  0x03: DEVICE_FEATURE_CATEGORIES.CO2_SENSOR,
  0x04: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
  0x05: DEVICE_FEATURE_CATEGORIES.LEAK_SENSOR,
}

/**
 * Alarm Sensor (0x9C) — the legacy alarm command class, still emitted by some
 * devices alongside a Notification or Binary Sensor value for the same
 * physical event (see the Fibaro FGMS-001 quirk).
 */
export const alarmSensor: CommandClassModule = {
  id: 156,
  name: 'alarm_sensor',
  properties: {
    state: {
      self: {
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
            convert: (raw) => (typeof raw === 'number' && raw > 0 ? STATE.ON : STATE.OFF),
          },
        ],
      },
    },
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
