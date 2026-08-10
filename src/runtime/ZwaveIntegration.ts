import type {
  Device,
  DeviceFeature,
  GladysIntegration,
  IntegrationConfig,
  Logger,
  MultiLanguageMessage,
} from '@gladysassistant/integration-sdk'

import { resolveBroker, resolveTopics, sameBroker, type BrokerSettings } from '../config.ts'
import { DeviceMapper } from '../mapping/DeviceMapper.ts'
import type {
  GetNodesResponse,
  NodeEvent,
  NodeValueUpdatedEvent,
  ZwaveNode,
} from '../types/zwave.ts'
import { NodeRegistry } from '../zwave/NodeRegistry.ts'
import { ZwaveJsUiClient } from '../zwave/ZwaveJsUiClient.ts'
import { buildTopics, nodeEventName, type Topics } from '../zwave/topics.ts'
import { CommandDispatcher } from './CommandDispatcher.ts'
import { StatePublisher } from './StatePublisher.ts'

/** Node events that make the cached network view stale. */
const NODE_REFRESH_EVENTS = new Set(['node_ready', 'node_added', 'node_available'])
const NODE_REMOVED_EVENT = 'node_removed'
const NODE_VALUE_UPDATED_EVENT = 'node_value_updated'

const NOT_CONFIGURED: MultiLanguageMessage = {
  en: 'MQTT broker not configured. Fill in the connection settings below.',
  fr: 'Broker MQTT non configuré. Renseignez les paramètres de connexion ci-dessous.',
}

/**
 * The integration itself: it owns the MQTT link, the network view and the two
 * data paths (Z-Wave reports to Gladys states, Gladys commands to Z-Wave).
 *
 * `index.ts` only wires the SDK callbacks to these methods.
 */
export class ZwaveIntegration {
  private readonly gladys: GladysIntegration
  private readonly logger: Logger
  private readonly registry = new NodeRegistry()
  private readonly mapper: DeviceMapper
  private readonly states: StatePublisher
  private readonly commands: CommandDispatcher
  private readonly client: ZwaveJsUiClient

  /** Features of the devices the user actually created — the state filter. */
  private knownFeatures = new Set<string>()
  private broker: BrokerSettings | undefined
  private topics: Topics

  constructor(gladys: GladysIntegration, logger: Logger) {
    this.gladys = gladys
    this.logger = logger
    this.topics = buildTopics(resolveTopics({}))

    const externalId = (suffix: string) => gladys.externalId(suffix)
    this.mapper = new DeviceMapper(externalId)

    this.states = new StatePublisher({
      logger: logger.child('states'),
      publish: (batch) => gladys.publishStates(batch),
      knownFeatures: () => this.knownFeatures,
    })

    this.commands = new CommandDispatcher({
      logger: logger.child('commands'),
      selector: gladys.selector,
      externalId,
      topics: () => this.topics,
      publish: (topic, payload) => this.client.publish(topic, payload),
      pushStates: (pending) => this.states.push(pending),
    })

    this.client = new ZwaveJsUiClient({
      logger: logger.child('mqtt'),
      onConnected: () => this.onBrokerConnected(),
      onDisconnected: (reason) => this.onBrokerDisconnected(reason),
      onMessage: (topic, payload) => this.onMessage(topic, payload),
    })
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Run on every (re)connection to Gladys — never assume anything survived. */
  async start(): Promise<void> {
    const config = await this.gladys.getConfig()
    this.refreshKnownFeatures(this.gladys.devices)
    // A reconnection may have hidden state changes: publish freely again.
    this.states.reset()
    await this.applyConfig(config, { force: true })
  }

  /** Config saved in the UI: reopen the link only if it actually changed. */
  async onConfigUpdated(config: IntegrationConfig): Promise<void> {
    await this.applyConfig(config, { force: false })
  }

  async stop(): Promise<void> {
    this.states.stop()
    await this.client.close()
  }

  private async applyConfig(
    config: IntegrationConfig,
    { force }: { force: boolean },
  ): Promise<void> {
    const topics = buildTopics(resolveTopics(config))
    const broker = resolveBroker(config, this.gladys.selector)
    const topicsChanged = JSON.stringify(topics) !== JSON.stringify(this.topics)

    this.topics = topics

    if (!broker) {
      this.broker = undefined
      await this.client.close()
      await this.setStatus(false, NOT_CONFIGURED)
      return
    }

    if (!force && !topicsChanged && sameBroker(broker, this.broker) && this.client.connected) {
      return
    }

    this.broker = broker
    // Always reopens: `open` closes the previous client first, so repeated
    // saves cannot pile up connections.
    await this.client.open(broker, topics)
  }

  // -------------------------------------------------------------------------
  // MQTT
  // -------------------------------------------------------------------------

  private onBrokerConnected(): void {
    this.client.requestNodes()
    void this.setStatus(true)
  }

  private onBrokerDisconnected(reason: string): void {
    void this.setStatus(false, {
      en: `Cannot reach the MQTT broker (${reason}).`,
      fr: `Broker MQTT injoignable (${reason}).`,
    })
  }

  private onMessage(topic: string, payload: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      this.logger.debug(`Ignoring a non-JSON payload on ${topic}`)
      return
    }

    if (topic === this.topics.getNodesResponse) {
      void this.onNodes(parsed as GetNodesResponse)
      return
    }

    const event = nodeEventName(topic, this.topics)
    if (event === NODE_VALUE_UPDATED_EVENT) {
      this.onValueUpdated(parsed as NodeValueUpdatedEvent)
    } else if (event && NODE_REFRESH_EVENTS.has(event)) {
      this.onNodeRefreshed(parsed as NodeEvent)
    } else if (event === NODE_REMOVED_EVENT) {
      this.onNodeRemoved(parsed as NodeEvent)
    }
  }

  private async onNodes(message: GetNodesResponse): Promise<void> {
    const nodes = message.result
    if (!Array.isArray(nodes)) {
      this.logger.warn('Received a getNodes answer without a node list')
      return
    }
    this.registry.replace(nodes)
    await this.publishDiscovered()
  }

  private onValueUpdated(message: NodeValueUpdatedEvent): void {
    const [node, value] = message.data ?? []
    if (!node || !value) {
      return
    }
    // The event carries the whole node: keep the cached view warm for free.
    this.registry.upsert(node)
    this.states.push(this.mapper.convertValue(node, value, value.newValue))
  }

  private onNodeRefreshed(message: NodeEvent): void {
    const [node] = message.data ?? []
    if (!node) {
      return
    }
    this.registry.upsert(node)
    void this.publishDiscovered()
  }

  private onNodeRemoved(message: NodeEvent): void {
    const [node] = message.data ?? []
    if (typeof node?.id !== 'number') {
      return
    }
    this.registry.remove(node.id)
    void this.publishDiscovered()
  }

  // -------------------------------------------------------------------------
  // Gladys
  // -------------------------------------------------------------------------

  /** Answer a scan request: ask Z-Wave JS UI again, the answer republishes. */
  requestScan(): void {
    this.client.requestNodes()
  }

  setValue(device: Device, feature: DeviceFeature, value: number): void {
    this.commands.setValue(device, feature, value)
  }

  /**
   * A device was just created: publish what we already know about it instead
   * of leaving it blank until the next report — which, for a battery sensor
   * waking up every few hours, is a long time to stare at an empty widget.
   */
  onDeviceCreated(device: Device): void {
    this.addKnownFeatures(device)
    const node = this.findNode(device)
    if (node) {
      this.states.push(this.mapper.snapshot(node))
    }
  }

  onDeviceUpdated(device: Device): void {
    this.addKnownFeatures(device)
  }

  onDeviceDeleted(device: Device): void {
    for (const feature of device.features ?? []) {
      this.knownFeatures.delete(feature.external_id)
    }
  }

  /** Manifest action: report what the integration currently sees. */
  testConnection(): MultiLanguageMessage {
    if (!this.broker) {
      return NOT_CONFIGURED
    }
    if (!this.client.connected) {
      return {
        en: `Not connected to the MQTT broker at ${this.broker.url}.`,
        fr: `Non connecté au broker MQTT ${this.broker.url}.`,
      }
    }
    const count = this.registry.size
    return {
      en: `Connected to ${this.broker.url}. ${count} Z-Wave node(s) known.`,
      fr: `Connecté à ${this.broker.url}. ${count} nœud(s) Z-Wave connu(s).`,
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async publishDiscovered(): Promise<void> {
    const devices = this.mapper.toDiscoveredDevices(this.registry.all())
    try {
      await this.gladys.publishDiscoveredDevices(devices)
      this.logger.info(`Published ${devices.length} discovered device(s)`)
    } catch (error) {
      this.logger.error('Failed to publish the discovered devices', error)
    }
  }

  private findNode(device: Device): ZwaveNode | undefined {
    const suffix = device.external_id.slice(`ext:${this.gladys.selector}:`.length)
    const nodeId = Number.parseInt(suffix, 10)
    return Number.isInteger(nodeId) ? this.registry.get(nodeId) : undefined
  }

  private refreshKnownFeatures(devices: readonly Device[]): void {
    this.knownFeatures = new Set(
      devices.flatMap((device) => (device.features ?? []).map((feature) => feature.external_id)),
    )
  }

  private addKnownFeatures(device: Device): void {
    for (const feature of device.features ?? []) {
      this.knownFeatures.add(feature.external_id)
    }
  }

  private async setStatus(connected: boolean, message?: MultiLanguageMessage): Promise<void> {
    try {
      await (message
        ? this.gladys.setConnectionStatus(connected, message)
        : this.gladys.setConnectionStatus(connected))
    } catch (error) {
      this.logger.warn('Failed to report the connection status', error)
    }
  }
}
