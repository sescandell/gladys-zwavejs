import type { ZwaveNode } from '../types/zwave.ts'
import { clean } from './clean.ts'

/** A mapped feature plus the Z-Wave provenance the quirks reason about. */
export interface MappedFeature<T> {
  readonly feature: T
  readonly commandClass: number
  readonly endpoint: number
  readonly propertyName: string
}

const COMMAND_CLASS = {
  BINARY_SWITCH: 37,
  MULTILEVEL_SWITCH: 38,
  BINARY_SENSOR: 48,
  ALARM_SENSOR: 156,
} as const

/** The root endpoint, which on a multi-endpoint device mirrors the real ones. */
const ROOT_ENDPOINT = 0

/** Devices needing a specific fix, by `<manufacturerId>-<productType>-<productId>`. */
const PRODUCT_ID = {
  FIBARO_FGMS001: '271-4097-2048',
} as const

/**
 * Drop the features that would confuse the user, device by device.
 *
 * Every rule here must come with the reason it exists — this is the file that
 * silently deletes things the user would otherwise see.
 */
export function applyQuirks<T>(
  features: Array<MappedFeature<T>>,
  node: ZwaveNode,
): Array<MappedFeature<T>> {
  let result = features

  // Multilevel Switch: some devices publish an explicit Binary Switch on top
  // of their dimmer, some do not (Qubino vs Fibaro). Since we synthesize a
  // virtual on/off from the Multilevel Switch anyway — and that one stays
  // synchronized with the position — we drop the explicit one rather than
  // show the user two on/off controls that behave differently.
  //
  // Two shapes to tell apart, and only one of them must be filtered:
  //  - the SAME endpoint carries both classes: the Binary Switch duplicates
  //    the dimmer, drop it;
  //  - the root endpoint 0 mirrors the real endpoints, as most multi-endpoint
  //    devices do: its Binary Switch is a duplicate too, drop it;
  //  - two DIFFERENT real endpoints, a dimmer on one and a plain relay on the
  //    other: the relay has no dimmer to be replaced by, keep it or that half
  //    of the device loses its only control.
  const dimmerEndpoints = new Set(
    result.filter((f) => f.commandClass === COMMAND_CLASS.MULTILEVEL_SWITCH).map((f) => f.endpoint),
  )
  const rootMirrorsADimmer = dimmerEndpoints.size > 0 && !dimmerEndpoints.has(ROOT_ENDPOINT)
  result = result.filter(
    (f) =>
      f.commandClass !== COMMAND_CLASS.BINARY_SWITCH ||
      !(dimmerEndpoints.has(f.endpoint) || (rootMirrorsADimmer && f.endpoint === ROOT_ENDPOINT)),
  )

  // Fibaro Motion Sensor FGMS-001: its Alarm Sensor duplicates the motion
  // information without adding anything, and depending on the firmware the
  // motion is reported either as Binary Sensor "General Purpose" or as "Any".
  // When both are present, "General Purpose" is the accurate one.
  if (node.deviceId === PRODUCT_ID.FIBARO_FGMS001) {
    result = result.filter((f) => f.commandClass !== COMMAND_CLASS.ALARM_SENSOR)

    const hasGeneralPurpose = result.some(
      (f) =>
        f.commandClass === COMMAND_CLASS.BINARY_SENSOR &&
        clean(f.propertyName) === 'general_purpose',
    )
    if (hasGeneralPurpose) {
      result = result.filter(
        (f) => !(f.commandClass === COMMAND_CLASS.BINARY_SENSOR && clean(f.propertyName) === 'any'),
      )
    }
  }

  return result
}
