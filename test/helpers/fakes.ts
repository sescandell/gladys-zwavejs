import type { DeviceState, Logger } from '@gladysassistant/integration-sdk'

/** A logger that records instead of printing, so tests can assert on warnings. */
export function createFakeLogger(): Logger & { warnings: string[]; errors: string[] } {
  const warnings: string[] = []
  const errors: string[] = []
  const logger: Logger & { warnings: string[]; errors: string[] } = {
    debug: () => {},
    info: () => {},
    warn: (...args: unknown[]) => warnings.push(args.map(String).join(' ')),
    error: (...args: unknown[]) => errors.push(args.map(String).join(' ')),
    child: () => logger,
    warnings,
    errors,
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
