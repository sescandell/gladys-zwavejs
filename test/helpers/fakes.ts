import type {
  Device,
  DeviceState,
  GladysIntegration,
  Logger,
} from '@gladysassistant/integration-sdk'

/** Everything a fake logger records, by level. */
export interface RecordedLogs {
  debugs: string[]
  infos: string[]
  warnings: string[]
  errors: string[]
}

const record =
  (lines: string[]) =>
  (...args: unknown[]) => {
    lines.push(args.map(String).join(' '))
  }

/** A logger that records instead of printing, so tests can assert on output. */
export function createFakeLogger(): Logger & RecordedLogs {
  const logs: RecordedLogs = { debugs: [], infos: [], warnings: [], errors: [] }
  const logger: Logger & RecordedLogs = {
    debug: record(logs.debugs),
    info: record(logs.infos),
    warn: record(logs.warnings),
    error: record(logs.errors),
    child: () => logger,
    ...logs,
  }
  return logger
}

/** Records the published batches; can be told to fail the next N calls. */
export function createFakePublisher() {
  const batches: DeviceState[][] = []
  let failures = 0
  return {
    batches,
    failNext(count: number) {
      failures = count
    },
    /** Every state published so far, batches flattened. */
    get states(): DeviceState[] {
      return batches.flat()
    },
    publish: async (states: DeviceState[]) => {
      if (failures > 0) {
        failures -= 1
        throw new Error('boom')
      }
      batches.push(states)
    },
  }
}

/** A clock the tests move by hand. */
export function createFakeClock(start = 1_000_000) {
  let current = start
  return {
    now: () => current,
    advance(ms: number) {
      current += ms
    },
  }
}

/**
 * The Gladys host, reduced to what ZwaveIntegration actually calls. The cast
 * is deliberate: implementing the whole SDK class would test the SDK, not us.
 */
export function createFakeGladys(selector = 'test-selector') {
  const published: DeviceState[] = []
  const discovered: Device[][] = []
  const gladys = {
    selector,
    devices: [] as Device[],
    externalId: (suffix: string) => `ext:${selector}:${suffix}`,
    publishStates: async (states: DeviceState[]) => {
      published.push(...states)
    },
    publishDiscoveredDevices: async (devices: Device[]) => {
      discovered.push(devices)
    },
    setConnectionStatus: async () => {},
    getConfig: async () => ({}),
  }
  return { published, discovered, gladys: gladys as unknown as GladysIntegration }
}
