import type { ZwaveNode } from '../types/zwave.ts'
import { clean } from './clean.ts'

/** One `{ text, value }` entry of a Z-Wave value metadata `states` list. */
interface StateOption {
  readonly text: string
  readonly value: number
}

/** Gladys device param carrying the Z-Wave JS UI location of the node. */
const LOCATION_PARAM = 'location'

const CONFIGURATION_CC = 112

/**
 * Configuration (0x70) parameters worth surfacing in the Gladys device
 * "technical parameters" block, by `<manufacturerId>-<productType>-<productId>`.
 *
 * This is deliberately nominative: exposing every configuration parameter of
 * every node would bury each device under dozens of static lines. A parameter
 * lands here only when knowing its value helps the user understand what the
 * device does — each entry carries the reason.
 */
const CONFIG_PARAMS: Readonly<Record<string, readonly number[]>> = {
  // Zooz ZEN55 LR (DC Signal Sensor): parameter 8 selects which of the three
  // functions — relay, smoke, CO — the node exposes on the network. Showing it
  // lets the user tell "relay disabled" from "relay enabled but the Z-Wave
  // interview was not refreshed", the usual reason the switch feature is
  // missing after a reconfiguration.
  '634-4-272': [8],
}

/** The configuration params surfaced for a node, decoded to their state label. */
function configParams(node: ZwaveNode): Array<{ name: string; value: string }> {
  const properties = CONFIG_PARAMS[node.deviceId ?? '']
  if (!properties) {
    return []
  }

  return properties.flatMap((property) => {
    const value = Object.values(node.values ?? {}).find(
      (candidate) => candidate.commandClass === CONFIGURATION_CC && candidate.property === property,
    )
    if (!value || value.value == null) {
      return []
    }
    const states = (value.states as StateOption[] | undefined) ?? []
    const label = states.find((state) => state.value === value.value)?.text
    return [{ name: clean(value.propertyName), value: label ?? String(value.value) }]
  })
}

/**
 * Every Gladys device param (name/value) of a node, in display order: the
 * Z-Wave JS UI location first, then the nominative configuration parameters.
 * Never produces a feature or an external id.
 */
export function deviceParams(node: ZwaveNode): Array<{ name: string; value: string }> {
  return [{ name: LOCATION_PARAM, value: node.loc ?? '' }, ...configParams(node)]
}
