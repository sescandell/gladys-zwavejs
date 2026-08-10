import type { Logger } from '@gladysassistant/integration-sdk'
import mqtt, { type MqttClient } from 'mqtt'

import type { BrokerSettings } from '../config.ts'
import type { Topics } from './topics.ts'

/** Delay between reconnection attempts, handled by the MQTT client itself. */
const RECONNECT_PERIOD_MS = 5000

export interface ZwaveJsUiClientOptions {
  readonly logger: Logger
  /** Called on every (re)connection, once the subscriptions are in place. */
  readonly onConnected: () => void
  /** Called when the link drops; `reason` is meant for the user-facing status. */
  readonly onDisconnected: (reason: string) => void
  readonly onMessage: (topic: string, payload: string) => void
}

/**
 * The MQTT link to Z-Wave JS UI.
 *
 * Two properties matter beyond "it connects":
 *
 *  - **(Re)connection is idempotent.** `open()` always closes the previous
 *    client first, so saving the configuration repeatedly cannot pile up
 *    connections that would each re-process every message.
 *  - **An unreachable broker is not fatal.** `open()` resolves as soon as the
 *    client is wired; the connection itself is retried for life. The user
 *    saves the configuration before the broker exists more often than not, and
 *    the container must not die on it — the status is reported instead.
 */
export class ZwaveJsUiClient {
  private readonly options: ZwaveJsUiClientOptions
  private client: MqttClient | undefined
  private topics: Topics | undefined
  /**
   * Serializes open/close. Both yield to the event loop, so two overlapping
   * calls would each see "no client" and each create one — the first left
   * running, with its listeners still processing every message a second time.
   */
  private operations: Promise<void> = Promise.resolve()

  constructor(options: ZwaveJsUiClientOptions) {
    this.options = options
  }

  get connected(): boolean {
    return this.client?.connected === true
  }

  /** Open (or re-open) the link. Safe to call at any time, in any state. */
  async open(settings: BrokerSettings, topics: Topics): Promise<void> {
    return this.enqueue(() => this.doOpen(settings, topics))
  }

  /** Close the link and drop every listener. */
  async close(): Promise<void> {
    return this.enqueue(() => this.doClose())
  }

  private async enqueue(operation: () => Promise<void>): Promise<void> {
    // A failed operation must not break the chain for the next one.
    const next = this.operations.then(operation, operation)
    this.operations = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  private async doOpen(settings: BrokerSettings, topics: Topics): Promise<void> {
    await this.doClose()
    this.topics = topics

    const { logger } = this.options
    logger.info(`Connecting to MQTT broker ${settings.url}`)

    const client = mqtt.connect(settings.url, {
      // Spread rather than assign: an anonymous broker must receive NO
      // credentials at all, not empty ones.
      ...(settings.username === undefined ? {} : { username: settings.username }),
      ...(settings.password === undefined ? {} : { password: settings.password }),
      clientId: settings.clientId,
      reconnectPeriod: RECONNECT_PERIOD_MS,
    })
    this.client = client

    client.on('connect', () => {
      client.subscribe([...topics.subscriptions], (error) => {
        if (error) {
          logger.error('Failed to subscribe to the Z-Wave JS UI topics', error)
          this.options.onDisconnected('subscription failed')
          return
        }
        logger.info(`Subscribed to ${topics.subscriptions.join(', ')}`)
        this.options.onConnected()
      })
    })

    client.on('reconnect', () => logger.debug('Reconnecting to the MQTT broker'))

    client.on('error', (error) => {
      // Not fatal: the client keeps retrying on its own.
      logger.warn(`MQTT error: ${error.message}`)
      this.options.onDisconnected(error.message)
    })

    client.on('offline', () => {
      logger.warn('MQTT broker is offline')
      this.options.onDisconnected('broker unreachable')
    })

    client.on('message', (topic, payload) => {
      this.options.onMessage(topic, payload.toString())
    })
  }

  private async doClose(): Promise<void> {
    const client = this.client
    if (!client) {
      return
    }
    this.client = undefined
    this.topics = undefined
    client.removeAllListeners()
    await client.endAsync(true).catch(() => {
      // Closing a broken socket is best effort: nothing to recover here.
    })
  }

  /** Ask Z-Wave JS UI for the full node list. */
  requestNodes(): void {
    if (this.topics) {
      this.publish(this.topics.getNodesRequest, 'true')
    }
  }

  publish(topic: string, payload: string): void {
    const client = this.client
    if (!client?.connected) {
      this.options.logger.warn(`Dropping a message on ${topic}: the broker is not connected`)
      return
    }
    client.publish(topic, payload, (error) => {
      if (error) {
        this.options.logger.warn(`Failed to publish on ${topic}: ${error.message}`)
      }
    })
  }
}
