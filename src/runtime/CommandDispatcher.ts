import type { Device, DeviceFeature, Logger } from '@gladysassistant/integration-sdk'

import { parseFeatureId, featureSuffix, type ParsedFeatureId } from '../mapping/externalId.ts'
import type { Topics } from '../zwave/topics.ts'
import { getCommandClass, resolveCommand } from '../zwave/commandClasses/index.ts'
import type { SiblingStateUpdate } from '../zwave/commandClasses/types.ts'
import type { PendingState } from './state.ts'

export interface CommandDispatcherOptions {
  readonly logger: Logger
  readonly selector: string
  readonly externalId: (suffix: string) => string
  readonly topics: () => Topics
  readonly publish: (topic: string, payload: string) => void
  /** Applies the sibling states locally, right after the command is sent. */
  readonly pushStates: (states: readonly PendingState[]) => void
}

/**
 * Translates a Gladys command into a Z-Wave JS UI MQTT message.
 *
 * Everything needed is derived from the feature external id and the command
 * class registry — no node cache lookup, so a command works right after a
 * restart, before the first scan has answered.
 */
export class CommandDispatcher {
  private readonly options: CommandDispatcherOptions

  constructor(options: CommandDispatcherOptions) {
    this.options = options
  }

  /** Throwing here is how the SDK acks the command as failed. */
  setValue(_device: Device, feature: DeviceFeature, value: number): void {
    const externalId = feature.external_id
    const parsed = parseFeatureId(externalId, this.options.selector)
    if (!parsed) {
      throw new Error(`Unknown Z-Wave feature id: "${externalId}"`)
    }

    const module = getCommandClass(parsed.commandClassName)
    if (!module) {
      throw new Error(`Unsupported command class "${parsed.commandClassName}" for "${externalId}"`)
    }

    const resolved = resolveCommand(module, parsed.propertyName, parsed.trailing, feature.category)
    if (!resolved) {
      throw new Error(`Feature "${externalId}" is not commandable`)
    }

    const command = resolved.build(value)
    const target = {
      nodeId: parsed.nodeId,
      commandClass: module.id,
      endpoint: parsed.endpoint,
    }
    const topics = this.options.topics()

    if (command.api === 'sendCommand') {
      // https://zwave-js.github.io/zwave-js-ui/#/guide/mqtt?id=sendcommand
      this.options.publish(
        topics.sendCommand,
        JSON.stringify({ args: [target, command.name, command.args] }),
      )
    } else {
      // https://zwave-js.github.io/zwave-js-ui/#/guide/mqtt?id=writevalue
      const valueId = {
        ...target,
        property: command.name,
        // Only carried when the property exists several times on the command
        // class (thermostat setpoints); omitted otherwise, as zwave-js expects.
        ...(command.propertyKey === undefined ? {} : { propertyKey: command.propertyKey }),
      }
      this.options.publish(topics.writeValue, JSON.stringify({ args: [valueId, command.args[0]] }))
    }

    this.applySiblingStates(parsed, resolved.propertyKeyName, command.stateUpdates)
  }

  /**
   * Keep the sibling features coherent without waiting for the device to
   * report: setting a dimmer to 0 also turns its virtual on/off state off.
   *
   * The commanded feature itself is NOT republished — the Gladys core already
   * saves it, because every writable feature here declares
   * `has_feedback: false`. Publishing it again would just duplicate the state.
   */
  private applySiblingStates(
    parsed: ParsedFeatureId,
    sourceKey: string,
    updates: readonly SiblingStateUpdate[],
  ): void {
    if (updates.length === 0) {
      return
    }

    const states: PendingState[] = updates.map((update) => ({
      featureExternalId: this.options.externalId(
        featureSuffix(
          parsed.nodeId,
          parsed.commandClassName,
          parsed.endpoint,
          update.propertyName ?? parsed.propertyName,
          update.propertyName ? (update.propertyKeyName ?? '') : sourceKey,
          update.featureName ?? '',
        ),
      ),
      state: update.value,
      sampled: false,
      event: false,
    }))

    this.options.pushStates(states)
  }
}
