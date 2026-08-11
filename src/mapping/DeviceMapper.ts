import type { Device, DeviceFeature } from '@gladysassistant/integration-sdk'

import type { PendingState } from '../runtime/state.ts'
import type { ZwaveNode, ZwaveValue } from '../types/zwave.ts'
import { getCommandClass, resolveVariant } from '../zwave/commandClasses/index.ts'
import type { ExposedFeature, FeatureSpec } from '../zwave/commandClasses/types.ts'
import { buildFeatureName } from './featureName.ts'
import { deviceSuffix, featureSuffix } from './externalId.ts'
import { applyQuirks, type MappedFeature } from './quirks.ts'

/** Name of the Gladys device param carrying the Z-Wave JS UI location. */
const LOCATION_PARAM = 'location'

/**
 * A device name that is never empty.
 *
 * A Z-Wave node carries no name until someone types one in Z-Wave JS UI, and
 * the Gladys host API rejects a nameless device — rejecting the WHOLE batch
 * with it, so one unnamed node is enough to make the Discovery screen stay
 * empty. The model description is the best readable fallback; the node id is
 * the last resort, and always exists.
 */
function buildDeviceName(node: ZwaveNode): string {
  for (const candidate of [node.name, node.productDescription, node.productLabel]) {
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return candidate.trim()
    }
  }
  return `Z-Wave node ${node.id}`
}

/**
 * Turns Z-Wave JS UI nodes into Gladys devices, and Z-Wave value reports into
 * Gladys states. Both directions go through the same command class registry,
 * so a feature that is discovered is a feature whose reports are understood.
 */
export class DeviceMapper {
  /** Builds `ext:<selector>:<suffix>` — the SDK helper. */
  private readonly externalId: (suffix: string) => string

  constructor(externalId: (suffix: string) => string) {
    this.externalId = externalId
  }

  /** Map every real node; the broadcast/multicast pseudo-nodes are skipped. */
  toDiscoveredDevices(nodes: readonly ZwaveNode[]): Device[] {
    return nodes
      .filter((node) => node.virtual !== true)
      .map((node) => this.toDiscoveredDevice(node))
  }

  toDiscoveredDevice(node: ZwaveNode): Device {
    const mapped: Array<MappedFeature<DeviceFeature>> = []

    for (const value of Object.values(node.values ?? {})) {
      const module = getCommandClass(value.commandClassName)
      if (!module) {
        continue
      }
      const variant = resolveVariant(
        module,
        value.propertyName,
        value.propertyKeyName,
        node.deviceClass,
      )
      if (!variant) {
        continue
      }

      for (const exposed of variant.expose) {
        const spec = module.refineCategory
          ? module.refineCategory(exposed.spec, value)
          : exposed.spec
        mapped.push({
          feature: this.buildFeature(node, value, exposed, spec),
          commandClass: value.commandClass,
          endpoint: value.endpoint ?? 0,
          propertyName: value.propertyName,
        })
      }
    }

    return {
      name: buildDeviceName(node),
      external_id: this.externalId(deviceSuffix(node.id)),
      features: applyQuirks(mapped, node).map((entry) => entry.feature),
      params: [{ name: LOCATION_PARAM, value: node.loc ?? '' }],
    }
  }

  /**
   * Convert one Z-Wave value into the states it feeds. A single value can feed
   * several features (a dimmer position also drives its virtual on/off), and a
   * converter returning null publishes nothing.
   *
   * Used both for live `node_value_updated` events and for the initial
   * snapshot taken from the last `getNodes` — same code path, so a freshly
   * created device is populated exactly like a running one.
   */
  convertValue(node: ZwaveNode, value: ZwaveValue, raw: unknown): PendingState[] {
    const module = getCommandClass(value.commandClassName)
    if (!module) {
      return []
    }
    const variant = resolveVariant(
      module,
      value.propertyName,
      value.propertyKeyName,
      node.deviceClass,
    )
    if (!variant?.fromZwave) {
      return []
    }

    const states: PendingState[] = []
    for (const converter of variant.fromZwave) {
      const state = converter.convert(raw)
      if (state === null) {
        continue
      }
      const featureName = converter.featureName ?? ''
      // A converter targeting another property (the dimmer reporting its
      // `restorePrevious` state) leaves that property's own key behind.
      const targetProperty = converter.propertyName ?? value.propertyName
      const targetKey = converter.propertyName
        ? (converter.propertyKeyName ?? '')
        : value.propertyKeyName

      // The policy belongs to the exposed feature, which only exists when the
      // converter stays on its own property.
      const exposed = converter.propertyName
        ? undefined
        : variant.expose.find((feature) => feature.name === featureName)

      states.push({
        featureExternalId: this.externalId(
          featureSuffix(
            node.id,
            value.commandClassName,
            value.endpoint ?? 0,
            targetProperty,
            targetKey,
            featureName,
          ),
        ),
        state,
        sampled: exposed?.sampled === true,
        event: exposed?.event === true,
      })
    }
    return states
  }

  /** Every state readable from the last `getNodes` snapshot of one node. */
  snapshot(node: ZwaveNode): PendingState[] {
    return Object.values(node.values ?? {}).flatMap((value) =>
      value.value === undefined || value.value === null
        ? []
        : this.convertValue(node, value, value.value),
    )
  }

  private buildFeature(
    node: ZwaveNode,
    value: ZwaveValue,
    exposed: ExposedFeature,
    spec: FeatureSpec,
  ): DeviceFeature {
    return {
      ...spec,
      name: buildFeatureName(value, exposed.name),
      external_id: this.externalId(
        featureSuffix(
          node.id,
          value.commandClassName,
          value.endpoint ?? 0,
          value.propertyName,
          value.propertyKeyName,
          exposed.name,
        ),
      ),
    }
  }
}
