import type { ZwaveDeviceClass, ZwaveNode, ZwaveValue } from '../../types/zwave.ts'
import { clean } from '../../mapping/clean.ts'
import { alarmSensor } from './alarmSensor.ts'
import { battery, derivedBatteryValues } from './battery.ts'
import { binarySensor } from './binarySensor.ts'
import { binarySwitch } from './binarySwitch.ts'
import { centralScene } from './centralScene.ts'
import { meter } from './meter.ts'
import { multilevelSensor } from './multilevelSensor.ts'
import { multilevelSwitch } from './multilevelSwitch.ts'
import { notification } from './notification.ts'
import { thermostatMode } from './thermostatMode.ts'
import { thermostatOperatingState } from './thermostatOperatingState.ts'
import { thermostatSetpoint } from './thermostatSetpoint.ts'
import type { ActionBuilder, CommandClassModule, PropertyMap, PropertyVariant } from './types.ts'

const MODULES: readonly CommandClassModule[] = [
  binarySwitch,
  multilevelSwitch,
  binarySensor,
  multilevelSensor,
  meter,
  centralScene,
  notification,
  battery,
  alarmSensor,
  thermostatMode,
  thermostatOperatingState,
  thermostatSetpoint,
]

const BY_NAME = new Map(MODULES.map((module) => [module.name, module]))

/** The command class module handling a `commandClassName`, if any. */
export function getCommandClass(commandClassName: string): CommandClassModule | undefined {
  return BY_NAME.get(clean(commandClassName))
}

/** Key of a device-class specific variant, e.g. `17-6` for a class B motor. */
function deviceClassKey(deviceClass: ZwaveDeviceClass | undefined): string | undefined {
  return deviceClass ? `${deviceClass.generic}-${deviceClass.specific}` : undefined
}

function lookup(
  properties: PropertyMap | undefined,
  property: string,
  key: string,
): PropertyVariant | undefined {
  const node = properties?.[property]
  if (!node) {
    return undefined
  }
  if (key !== '') {
    const keyed = node.keys?.[key]
    if (keyed) {
      return keyed
    }
  }
  return undefined
}

function lookupSelf(
  properties: PropertyMap | undefined,
  property: string,
): PropertyVariant | undefined {
  return properties?.[property]?.self
}

/**
 * Resolve the variant describing a Z-Wave value.
 *
 * The order matters: the most specific match wins, and a value whose property
 * key is unknown falls back to the property itself — which is what lets one
 * Central Scene definition serve every `001`, `002`... scene of a controller.
 *
 *   1. `<deviceClass>.<property>.<propertyKey>`
 *   2. `<property>.<propertyKey>`
 *   3. `<deviceClass>.<property>`
 *   4. `<property>`
 */
export function resolveVariant(
  module: CommandClassModule,
  propertyName: string,
  propertyKeyName: string | null | undefined,
  deviceClass: ZwaveDeviceClass | undefined,
): PropertyVariant | undefined {
  const property = clean(propertyName)
  const key = clean(propertyKeyName)
  const dcKey = deviceClassKey(deviceClass)
  const dcProperties = dcKey ? module.byDeviceClass?.[dcKey] : undefined

  return (
    lookup(dcProperties, property, key) ??
    lookup(module.properties, property, key) ??
    lookupSelf(dcProperties, property) ??
    lookupSelf(module.properties, property)
  )
}

/** A command builder resolved from a Gladys feature. */
export interface ResolvedCommand {
  readonly module: CommandClassModule
  readonly build: ActionBuilder
  /**
   * How the ambiguous trailing segments were read. The caller needs it to
   * rebuild sibling feature ids: it must not have to guess a second time
   * whether `...:currentvalue:position` ends with a property key or a feature
   * name.
   */
  readonly propertyKeyName: string
  readonly featureName: string
}

/**
 * Resolve the command to run for a Gladys feature, WITHOUT consulting the node
 * cache: the external id carries the node, endpoint, command class and
 * property, and the command class module knows the numeric id and the
 * canonical property names. A command therefore works on a cold cache, right
 * after a restart and before the first scan has answered.
 *
 * The Gladys feature `category` is what disambiguates two variants of the same
 * command class — a dimmer and a shutter motor both expose a `state` on
 * Multilevel Switch, but a value of 0 means OFF for one and STOP for the
 * other. That category was itself produced by the mapping, so it is the exact
 * inverse of the discovery decision.
 *
 * `trailing` is the ambiguous tail of the external id: zero, one or two
 * segments that may be a property key, a feature name, or both.
 */
export function resolveCommand(
  module: CommandClassModule,
  propertyName: string,
  trailing: readonly string[],
  category: string,
): ResolvedCommand | undefined {
  const property = clean(propertyName)
  const interpretations: Array<{ key: string; featureName: string }> = []
  if (trailing.length === 0) {
    interpretations.push({ key: '', featureName: '' })
  } else if (trailing.length === 1) {
    const only = trailing[0] as string
    interpretations.push({ key: only, featureName: '' }, { key: '', featureName: only })
  } else {
    interpretations.push({ key: trailing[0] as string, featureName: trailing[1] as string })
  }

  const propertyMaps: Array<PropertyMap | undefined> = [
    ...Object.values(module.byDeviceClass ?? {}),
    module.properties,
  ]

  // First pass: the variant must actually expose a feature of this category
  // under this name. Second pass: accept a command-only variant (an empty
  // `expose`, e.g. `restorePrevious` on a non-dimmer).
  for (const requireCategory of [true, false]) {
    for (const properties of propertyMaps) {
      for (const { key, featureName } of interpretations) {
        const variant =
          lookup(properties, property, key) ??
          (key === '' ? lookupSelf(properties, property) : undefined)
        const build = variant?.toZwave?.[featureName]
        if (!variant || !build) {
          continue
        }
        const matches = variant.expose.some(
          (f) => f.name === featureName && f.spec.category === category,
        )
        if (requireCategory ? matches : variant.expose.length === 0) {
          return { module, build, propertyKeyName: key, featureName }
        }
      }
    }
  }

  return undefined
}

/**
 * Values a node should expose but no longer publishes. Today only the Battery
 * low flag, dropped from `getNodes` by zwave-js 15.10.0 — see `battery.ts`.
 */
export function derivedValues(node: ZwaveNode): ZwaveValue[] {
  return derivedBatteryValues(node)
}
