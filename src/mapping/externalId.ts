import { clean } from './clean.ts'

/**
 * External ids. The `ext:<selector>:` prefix is mandatory — the Gladys core
 * rejects anything else.
 *
 *   device  : ext:<selector>:<nodeId>
 *   feature : ext:<selector>:<nodeId>:<endpoint>:<cc>:<property>[:<propertyKey>][:<featureName>]
 *
 * They are persisted and are what a device migration matches on, so the
 * structure is frozen: it identifies a feature for the lifetime of a device.
 */

/** Segments of a parsed feature external id. */
export interface ParsedFeatureId {
  readonly nodeId: number
  readonly endpoint: number
  readonly commandClassName: string
  readonly propertyName: string
  /**
   * The remaining zero to two segments. They are AMBIGUOUS on purpose: one
   * trailing segment can be a property key (`central_scene:scene:001`) or a
   * feature name (`multilevel_switch:currentvalue:position`), and nothing in
   * the string says which. The command class registry disambiguates them.
   */
  readonly trailing: readonly string[]
}

/** Build the device suffix (to be passed to `gladys.externalId`). */
export function deviceSuffix(nodeId: number): string {
  return String(nodeId)
}

/** Build the feature suffix (to be passed to `gladys.externalId`). */
export function featureSuffix(
  nodeId: number,
  commandClassName: string,
  endpoint: number,
  propertyName: string,
  propertyKeyName: string | null | undefined,
  featureName: string,
): string {
  const key = clean(propertyKeyName)
  return [
    String(nodeId),
    String(endpoint),
    clean(commandClassName),
    clean(propertyName),
    ...(key === '' ? [] : [key]),
    ...(featureName === '' ? [] : [featureName]),
  ].join(':')
}

/**
 * Parse a feature external id back into its segments. Returns undefined when
 * the id does not belong to this integration or is malformed — the caller
 * turns that into a failed command ack rather than a crash.
 */
export function parseFeatureId(externalId: string, selector: string): ParsedFeatureId | undefined {
  const prefix = `ext:${selector}:`
  if (!externalId.startsWith(prefix)) {
    return undefined
  }
  const segments = externalId.slice(prefix.length).split(':')
  if (segments.length < 4 || segments.length > 6) {
    return undefined
  }
  const [rawNodeId, rawEndpoint, commandClassName, propertyName, ...trailing] = segments as [
    string,
    string,
    string,
    string,
    ...string[],
  ]
  const nodeId = Number.parseInt(rawNodeId, 10)
  const endpoint = Number.parseInt(rawEndpoint, 10)
  if (!Number.isInteger(nodeId) || !Number.isInteger(endpoint)) {
    return undefined
  }
  return { nodeId, endpoint, commandClassName, propertyName, trailing }
}
