import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk'

import type { ZwaveNode, ZwaveValue } from '../../types/zwave.ts'
import { STATE } from '../stateValues.ts'
import type { CommandClassModule } from './types.ts'

const BATTERY_COMMAND_CLASS = 128
const IS_LOW_PROPERTY = 'isLow'
const LEVEL_PROPERTY = 'level'

/**
 * Below this, the battery is reported as low when the node does not say so
 * itself. It is the threshold the Gladys core already uses to decide which
 * batteries need replacing, so both readings agree rather than contradicting
 * each other in the same interface.
 */
const LOW_BATTERY_PERCENT = 10

/** Values of a node, whatever shape zwave-js-ui published them in. */
function valuesOf(node: ZwaveNode): ZwaveValue[] {
  return Object.values(node.values ?? {})
}

function isBatteryProperty(value: ZwaveValue, property: string): boolean {
  return value.commandClass === BATTERY_COMMAND_CLASS && value.propertyName === property
}

/**
 * Does the node report the low-battery flag itself?
 *
 * zwave-js 15.10.0 removed the Battery CC `isLow` VALUE and turned the warning
 * into a notification event, then cleaned the stale values up on startup. On
 * anything newer, `isLow` is simply absent from `getNodes` — so the feature is
 * no longer discovered, and a device that had it loses it.
 *
 * Both worlds therefore have to work at once: when the node still publishes
 * `isLow` it stays the source of truth, and only when it does not do we derive
 * the flag from the level.
 */
export function reportsIsLow(node: ZwaveNode): boolean {
  return valuesOf(node).some((value) => isBatteryProperty(value, IS_LOW_PROPERTY))
}

/**
 * The `isLow` values a node no longer publishes but should still expose.
 *
 * They are synthetic: they carry no value of their own (the level feeds the
 * feature) and exist only so discovery keeps producing the SAME external id,
 * `…:<endpoint>:battery:islow`. That matters more than it looks — the external
 * id is what a device migration matches on, so reusing it means a user who
 * already migrated keeps their feature and its history instead of watching one
 * disappear and an unrelated one take its place.
 */
export function derivedBatteryValues(node: ZwaveNode): ZwaveValue[] {
  if (reportsIsLow(node)) {
    return []
  }
  return valuesOf(node)
    .filter((value) => isBatteryProperty(value, LEVEL_PROPERTY))
    .map((level) => {
      const endpoint = level.endpoint ?? 0
      return {
        id: `${node.id}-${BATTERY_COMMAND_CLASS}-${endpoint}-${IS_LOW_PROPERTY}`,
        nodeId: node.id,
        commandClass: BATTERY_COMMAND_CLASS,
        commandClassName: 'Battery',
        endpoint,
        property: IS_LOW_PROPERTY,
        propertyName: IS_LOW_PROPERTY,
        type: 'boolean',
        readable: true,
        writeable: false,
        label: 'Low battery level',
      }
    })
}

/** Battery (0x80) — charge level and the low-battery flag. */
export const battery: CommandClassModule = {
  id: BATTERY_COMMAND_CLASS,
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
        fromZwave: [
          { convert: (raw) => (typeof raw === 'number' ? raw : null) },
          {
            // Feeds the sibling `isLow` feature on nodes that no longer report
            // the flag. A low-battery warning arrives as a Battery Report like
            // any other — the level field carries 0xFF instead of a percentage
            // — and there is NO event saying the battery is fine again. So the
            // level is what has to drive the flag in both directions, and it
            // is also the only thing a fresh `getNodes` can initialize it from.
            propertyName: IS_LOW_PROPERTY,
            when: (node) => !reportsIsLow(node),
            convert: (raw) =>
              typeof raw === 'number' ? (raw <= LOW_BATTERY_PERCENT ? STATE.ON : STATE.OFF) : null,
          },
        ],
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
