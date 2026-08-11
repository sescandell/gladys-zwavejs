import type { DeviceState, Logger } from '@gladysassistant/integration-sdk'

import type { PendingState } from './state.ts'

/** Hard limits of the Gladys host API (spec C.3). */
const MAX_STATES_PER_REQUEST = 100
const MAX_STATES_PER_MINUTE = 300
const BUDGET_WINDOW_MS = 60_000

/** How long states accumulate before being sent as one batch. */
const FLUSH_DELAY_MS = 200

/** Retry delay once the budget is spent — no point re-checking every 200 ms. */
const BUDGET_RETRY_DELAY_MS = 1000

/** Above this, the queue is considered stuck and gets degraded (see `degrade`). */
const QUEUE_HIGH_WATER_MARK = MAX_STATES_PER_MINUTE

/**
 * Absolute ceiling. `degrade` spares event states, which is right — but it
 * means a device stuck repeating an event faster than the budget allows could
 * otherwise grow the queue until the container runs out of memory. Past this
 * point the oldest entries go, newest kept: a state nobody could send for
 * minutes is worthless anyway.
 */
const QUEUE_HARD_LIMIT = 10 * MAX_STATES_PER_MINUTE

/** Warn at most once per minute, so a saturated network does not flood the logs. */
const WARN_INTERVAL_MS = 60_000

export interface StatePublisherOptions {
  readonly logger: Logger
  /** Sends one batch; must reject on failure so the batch can be requeued. */
  readonly publish: (states: DeviceState[]) => Promise<unknown>
  /** Feature external ids of the devices the user actually created. */
  readonly knownFeatures: () => ReadonlySet<string>
  /** Injectable clock, so the tests do not have to wait a minute. */
  readonly now?: () => number
}

interface QueuedState {
  readonly featureExternalId: string
  state: number
  readonly sampled: boolean
  /**
   * Carried all the way to the wire: an event is an occurrence, not a value,
   * so neither the requeue nor the degradation may collapse two of them.
   */
  readonly event: boolean
}

/**
 * Turns a Z-Wave firehose into something the Gladys host API accepts.
 *
 * A Z-Wave network reports far more often than Gladys accepts: every state is
 * an HTTP call counted against 300 states/minute per integration, batched 100
 * at a time. Four stages, in order:
 *
 *  1. **Drop what nobody asked for.** A state for a device the user never
 *     created is ignored by the core anyway — but only AFTER being counted
 *     against the budget. On a network where 8 of 40 nodes are in Gladys, this
 *     alone removes most of the traffic.
 *  2. **Deduplicate.** Same feature, same value as last published: drop.
 *     Except for event features (a button pressed twice sends the same value
 *     twice, and the repetition IS the information).
 *  3. **Batch, and coalesce only where coalescing is wanted.** Grouping loses
 *     nothing. Coalescing does — so it is opt-in, per feature (`sampled`). A
 *     shutter reporting 30 → 55 → 80 → 100 keeps all four: watching the
 *     position progress is how the user sees the command was taken into
 *     account. A temperature reporting three times in 200 ms keeps the last.
 *  4. **Stay inside the budget.** When it is exhausted the queue waits rather
 *     than being dropped.
 */
export class StatePublisher {
  private readonly options: StatePublisherOptions
  private readonly now: () => number

  /** Ordered queue; `sampledIndex` lets a sampled feature overwrite in place. */
  private queue: QueuedState[] = []
  private sampledIndex = new Map<string, number>()

  private lastPublished = new Map<string, number>()
  private sentAt: number[] = []

  private timer: NodeJS.Timeout | undefined
  private flushing = false
  private stopped = false
  private inFlight: Promise<void> | undefined
  private lastWarnAt = new Map<string, number>()

  constructor(options: StatePublisherOptions) {
    this.options = options
    this.now = options.now ?? Date.now
  }

  /** Queue states; they leave in the next batch. */
  push(states: readonly PendingState[]): void {
    const known = this.options.knownFeatures()
    let queued = false

    for (const pending of states) {
      if (!known.has(pending.featureExternalId)) {
        continue
      }
      if (!pending.event && this.lastPublished.get(pending.featureExternalId) === pending.state) {
        continue
      }
      // Reserve the value now: two identical reports inside one window must
      // not both go through.
      this.lastPublished.set(pending.featureExternalId, pending.state)

      const existingIndex = pending.sampled
        ? this.sampledIndex.get(pending.featureExternalId)
        : undefined
      const existing = existingIndex === undefined ? undefined : this.queue[existingIndex]
      if (existing) {
        existing.state = pending.state
      } else {
        if (pending.sampled) {
          this.sampledIndex.set(pending.featureExternalId, this.queue.length)
        }
        this.queue.push({
          featureExternalId: pending.featureExternalId,
          state: pending.state,
          sampled: pending.sampled,
          event: pending.event,
        })
      }
      queued = true
    }

    if (queued) {
      this.schedule()
    }
  }

  /**
   * Send everything that fits in the budget, now. Concurrent callers join the
   * flush already running rather than returning immediately — a caller that
   * awaits this needs the drain to be over when it resolves.
   */
  async flush(): Promise<void> {
    if (this.inFlight) {
      return this.inFlight
    }
    const run = this.drain()
    this.inFlight = run.finally(() => {
      this.inFlight = undefined
    })
    return this.inFlight
  }

  private async drain(): Promise<void> {
    this.clearTimer()
    this.flushing = true
    // Scheduling happens in the `finally`: `schedule()` refuses to arm a timer
    // while a flush is running, so asking for a retry from inside the loop
    // would leave the queue stranded until an unrelated push came along.
    let retryIn: number | undefined
    try {
      while (this.queue.length > 0) {
        const budget = this.availableBudget()
        if (budget <= 0) {
          this.degrade()
          retryIn = BUDGET_RETRY_DELAY_MS
          return
        }
        const size = Math.min(budget, MAX_STATES_PER_REQUEST, this.queue.length)
        const batch = this.queue.slice(0, size)
        this.dequeue(size)

        try {
          // Sequential on purpose: batches must land in order, and the budget
          // of the next one depends on this one having been accepted. The rule
          // stays on everywhere else — this is the one place it is wrong.
          // oxlint-disable-next-line no-await-in-loop
          await this.options.publish(
            batch.map((entry) => ({
              device_feature_external_id: entry.featureExternalId,
              state: entry.state,
            })),
          )
          const sentAt = this.now()
          for (let index = 0; index < batch.length; index += 1) {
            this.sentAt.push(sentAt)
          }
        } catch (error) {
          this.options.logger.warn(`Failed to publish ${batch.length} states, requeueing`, error)
          this.requeue(batch)
          retryIn = FLUSH_DELAY_MS
          return
        }
      }
    } finally {
      this.flushing = false
      if (retryIn !== undefined) {
        this.schedule(retryIn)
      }
    }
  }

  /**
   * Drain what can still be sent, then stop. Called on shutdown and on a
   * Gladys disconnection: without the drain, the sibling states of a command
   * that was just accepted would die with the process.
   */
  async stop(): Promise<void> {
    // Set FIRST: a flush already in flight will reach its `finally` and ask for
    // a retry, which must not re-arm a timer on a publisher that is going away.
    this.stopped = true
    this.clearTimer()
    await this.flush().catch(() => {
      // Best effort: we are on our way out.
    })
    this.clearTimer()
  }

  /**
   * Forget the deduplication memory — after a reconnection, republish freely.
   * Also revives a stopped publisher: `stop()` runs on every Gladys
   * disconnection, and `start()` calls this on the way back.
   */
  reset(): void {
    this.lastPublished.clear()
    this.stopped = false
  }

  private schedule(delay: number = FLUSH_DELAY_MS): void {
    if (this.timer || this.flushing || this.stopped) {
      return
    }
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush()
    }, delay)
    // Never hold the process open just to drain states.
    this.timer.unref?.()
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
  }

  private availableBudget(): number {
    const threshold = this.now() - BUDGET_WINDOW_MS
    this.sentAt = this.sentAt.filter((timestamp) => timestamp > threshold)
    return MAX_STATES_PER_MINUTE - this.sentAt.length
  }

  private dequeue(count: number): void {
    this.queue = this.queue.slice(count)
    this.reindex()
  }

  private requeue(batch: QueuedState[]): void {
    // Back in front, but never over a fresher value of the same feature —
    // except for events, where each entry is a distinct occurrence that a
    // newer one does not replace.
    const superseded = new Set(
      this.queue.filter((entry) => !entry.event).map((entry) => entry.featureExternalId),
    )
    this.queue = [
      ...batch.filter((entry) => entry.event || !superseded.has(entry.featureExternalId)),
      ...this.queue,
    ]
    this.reindex()
  }

  private reindex(): void {
    this.sampledIndex.clear()
    for (const [index, entry] of this.queue.entries()) {
      if (entry.sampled) {
        this.sampledIndex.set(entry.featureExternalId, index)
      }
    }
  }

  /**
   * Last resort, when the budget is exhausted AND the queue keeps growing.
   *
   * Sampled features already coalesce, so what is left is the progressive
   * ones. We keep the FIRST and the LAST value of each: the first because it
   * is the transition that started the movement, the last because it is where
   * the device ended up. Intermediate positions are lost — never the final
   * state, and never an event, which is exempt from the thinning entirely.
   *
   * This is a deliberate, logged trade-off, not a silent drop.
   */
  private degrade(): void {
    if (this.queue.length <= QUEUE_HIGH_WATER_MARK) {
      return
    }

    const firstIndex = new Map<string, number>()
    const lastIndex = new Map<string, number>()
    for (const [index, entry] of this.queue.entries()) {
      if (entry.event) {
        continue
      }
      if (!firstIndex.has(entry.featureExternalId)) {
        firstIndex.set(entry.featureExternalId, index)
      }
      lastIndex.set(entry.featureExternalId, index)
    }

    const before = this.queue.length
    this.queue = this.queue.filter(
      (entry, index) =>
        // Events are never thinned out: dropping the third of five button
        // presses means a scene that should have run does not.
        entry.event ||
        firstIndex.get(entry.featureExternalId) === index ||
        lastIndex.get(entry.featureExternalId) === index,
    )
    this.reindex()

    this.warn(
      'degraded',
      `State budget exhausted (${MAX_STATES_PER_MINUTE}/min): dropped ${before - this.queue.length} ` +
        `intermediate states, kept the first and last of each feature. ` +
        `Your Z-Wave network is reporting faster than Gladys accepts.`,
    )

    this.enforceHardLimit()
  }

  /**
   * The last line of defence, once thinning has done what it could. Only an
   * event flood can get here — everything else has already collapsed to two
   * entries per feature — and events must not grow the queue forever.
   */
  private enforceHardLimit(): void {
    if (this.queue.length <= QUEUE_HARD_LIMIT) {
      return
    }
    const dropped = this.queue.length - QUEUE_HARD_LIMIT
    this.queue = this.queue.slice(dropped)
    this.reindex()
    this.warn(
      'hard-limit',
      `State queue over ${QUEUE_HARD_LIMIT} entries: dropped the ${dropped} oldest. ` +
        `A device is reporting events faster than Gladys can accept them.`,
    )
  }

  /**
   * Throttled per `kind`: the degradation warning must not swallow the rarer,
   * more serious hard-limit one just because it fired a few milliseconds earlier.
   */
  private warn(kind: string, message: string): void {
    const now = this.now()
    if (now - (this.lastWarnAt.get(kind) ?? -WARN_INTERVAL_MS) < WARN_INTERVAL_MS) {
      return
    }
    this.lastWarnAt.set(kind, now)
    this.options.logger.warn(message)
  }
}
