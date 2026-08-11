import type { IntegrationConfig } from '@gladysassistant/integration-sdk'

/**
 * Configuration of the integration, mirroring the manifest `config_schema`.
 * `manifest.test.ts` asserts the two stay in sync.
 */
export const DEFAULT_CONFIG = {
  mqtt_url: '',
  mqtt_username: '',
  mqtt_password: '',
} as const

/** Everything needed to open the MQTT connection — and nothing else. */
export interface BrokerSettings {
  readonly url: string
  readonly username: string | undefined
  readonly password: string | undefined
  readonly clientId: string
}

/** The two values that locate Z-Wave JS UI inside the broker's topic tree. */
export interface TopicSettings {
  readonly prefix: string
  readonly gateway: string
}

/**
 * Where Z-Wave JS UI publishes. Fixed rather than configurable: the user is
 * told to set the gateway "Name" to zwave-js-ui and keep "Prefix" at zwave —
 * a handful of settings that must match on both sides, and are far easier to
 * get right from a screenshot than from two free-text fields.
 */
export const TOPIC_SETTINGS: TopicSettings = {
  prefix: 'zwave',
  gateway: 'ZWAVE_GATEWAY-zwave-js-ui',
}

function readString(config: IntegrationConfig, key: keyof typeof DEFAULT_CONFIG): string {
  const value = config[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : DEFAULT_CONFIG[key]
}

/**
 * Read a value VERBATIM. A password may legitimately start or end with a
 * space, and trimming it turns a valid credential into an authentication
 * failure the user cannot diagnose — the field is a secret, so they cannot
 * even look at what was stored.
 */
function readSecret(config: IntegrationConfig, key: keyof typeof DEFAULT_CONFIG): string {
  const value = config[key]
  return typeof value === 'string' && value !== '' ? value : DEFAULT_CONFIG[key]
}

/**
 * Resolve where the MQTT broker is.
 *
 * This indirection is the whole reason `ZwaveJsUiClient` never reads the
 * configuration itself: the day the integration ships its own Mosquitto as a
 * companion sub-container, only this function changes — it will return the
 * private-network address and the credentials generated in /data, and every
 * caller keeps working unchanged.
 */
export function resolveBroker(
  config: IntegrationConfig,
  selector: string,
): BrokerSettings | undefined {
  const url = readString(config, 'mqtt_url')
  if (url === '') {
    return undefined
  }
  const username = readString(config, 'mqtt_username')
  const password = readSecret(config, 'mqtt_password')
  return {
    url,
    username: username === '' ? undefined : username,
    password: password === '' ? undefined : password,
    // A stable, unique client id: two Gladys instances on the same broker must
    // not fight over one session, and reconnecting must reuse the same id.
    clientId: `gladys-${selector}`,
  }
}

/** True when the two configurations would open the same connection. */
export function sameBroker(a: BrokerSettings | undefined, b: BrokerSettings | undefined): boolean {
  if (!a || !b) {
    return a === b
  }
  return a.url === b.url && a.username === b.username && a.password === b.password
}
