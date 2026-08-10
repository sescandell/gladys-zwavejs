import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout } from 'node:timers/promises'

import { StatePublisher } from '../src/runtime/StatePublisher.ts'
import type { PendingState } from '../src/runtime/state.ts'
import { createFakeClock, createFakeLogger, createFakePublisher } from './helpers/fakes.ts'

const SHUTTER = 'ext:test:5:1:multilevel_switch:currentvalue:position'
const TEMPERATURE = 'ext:test:4:0:multilevel_sensor:air_temperature'
const BUTTON = 'ext:test:9:0:central_scene:scene:001'

function state(
  featureExternalId: string,
  value: number,
  policy: Partial<PendingState> = {},
): PendingState {
  return { featureExternalId, state: value, sampled: false, event: false, ...policy }
}

function setup(known: string[]) {
  const logger = createFakeLogger()
  const publisher = createFakePublisher()
  const clock = createFakeClock()
  const knownFeatures = new Set(known)
  const states = new StatePublisher({
    logger,
    publish: publisher.publish,
    knownFeatures: () => knownFeatures,
    now: clock.now,
  })
  return { logger, publisher, clock, knownFeatures, states }
}

test('a state for a device the user never created is dropped before the budget', async () => {
  const { publisher, states } = setup([SHUTTER])

  states.push([state(SHUTTER, 40), state('ext:test:99:0:battery:level', 80)])
  await states.flush()

  assert.deepEqual(publisher.states, [{ device_feature_external_id: SHUTTER, state: 40 }])
})

test('the same value twice in a row is published once', async () => {
  const { publisher, states } = setup([TEMPERATURE])

  states.push([state(TEMPERATURE, 21.5, { sampled: true })])
  await states.flush()
  states.push([state(TEMPERATURE, 21.5, { sampled: true })])
  await states.flush()

  assert.equal(publisher.states.length, 1)
})

test('an event feature is never deduplicated: two presses are two states', async () => {
  const { publisher, states } = setup([BUTTON])

  states.push([state(BUTTON, 1, { event: true })])
  await states.flush()
  states.push([state(BUTTON, 1, { event: true })])
  await states.flush()

  assert.deepEqual(publisher.states, [
    { device_feature_external_id: BUTTON, state: 1 },
    { device_feature_external_id: BUTTON, state: 1 },
  ])
})

test('a shutter ramp keeps every intermediate position in a single window', async () => {
  // The point of the whole design: watching the position progress is how the
  // user sees the command was taken into account. Coalescing here would show
  // the shutter jumping straight to its final position.
  const { publisher, states } = setup([SHUTTER])

  states.push([state(SHUTTER, 30), state(SHUTTER, 55), state(SHUTTER, 80), state(SHUTTER, 100)])
  await states.flush()

  assert.deepEqual(
    publisher.states.map((entry) => entry.state),
    [30, 55, 80, 100],
  )
})

test('a sampled feature keeps only the last value of the window', async () => {
  const { publisher, states } = setup([TEMPERATURE])

  states.push([
    state(TEMPERATURE, 21.1, { sampled: true }),
    state(TEMPERATURE, 21.3, { sampled: true }),
    state(TEMPERATURE, 21.7, { sampled: true }),
  ])
  await states.flush()

  assert.deepEqual(publisher.states, [{ device_feature_external_id: TEMPERATURE, state: 21.7 }])
})

test('coalescing a sampled feature does not disturb the order of the others', async () => {
  const { publisher, states } = setup([SHUTTER, TEMPERATURE])

  states.push([
    state(TEMPERATURE, 20, { sampled: true }),
    state(SHUTTER, 10),
    state(TEMPERATURE, 22, { sampled: true }),
    state(SHUTTER, 20),
  ])
  await states.flush()

  assert.deepEqual(publisher.states, [
    { device_feature_external_id: TEMPERATURE, state: 22 },
    { device_feature_external_id: SHUTTER, state: 10 },
    { device_feature_external_id: SHUTTER, state: 20 },
  ])
})

test('batches never exceed the 100 states the host API accepts', async () => {
  const features = Array.from({ length: 250 }, (_, index) => `ext:test:1:0:battery:level:${index}`)
  const { publisher, states } = setup(features)

  states.push(features.map((feature, index) => state(feature, index)))
  await states.flush()

  assert.deepEqual(
    publisher.batches.map((batch) => batch.length),
    [100, 100, 50],
  )
})

test('an exhausted budget holds the states back, then releases them a minute later', async () => {
  const features = Array.from({ length: 400 }, (_, index) => `ext:test:1:0:battery:level:${index}`)
  const { publisher, clock, states } = setup(features)

  states.push(features.map((feature, index) => state(feature, index)))
  await states.flush()

  // 300 states per minute is the host API limit: the rest waits.
  assert.equal(publisher.states.length, 300)

  clock.advance(61_000)
  await states.flush()

  assert.equal(publisher.states.length, 400)
})

test('a saturated queue degrades to the first and last value of each feature, and says so', async () => {
  const filler = Array.from({ length: 300 }, (_, index) => `ext:test:1:0:battery:level:${index}`)
  const { logger, publisher, clock, states } = setup([...filler, SHUTTER, TEMPERATURE])

  // Burn the whole budget first.
  states.push(filler.map((feature, index) => state(feature, index)))
  await states.flush()
  assert.equal(publisher.states.length, 300)

  // Then flood two progressive features while nothing can be sent.
  const flood: PendingState[] = []
  for (let value = 0; value < 200; value += 1) {
    flood.push(state(SHUTTER, value), state(TEMPERATURE, value))
  }
  states.push(flood)
  await states.flush()

  assert.equal(publisher.states.length, 300, 'nothing more could be sent')
  assert.match(logger.warnings.join('\n'), /State budget exhausted/)

  clock.advance(61_000)
  await states.flush()

  // The trade-off, made explicit: intermediate positions are lost, the first
  // transition and the FINAL position of each feature always survive.
  const published = publisher.states.slice(300)
  assert.deepEqual(published, [
    { device_feature_external_id: SHUTTER, state: 0 },
    { device_feature_external_id: TEMPERATURE, state: 0 },
    { device_feature_external_id: SHUTTER, state: 199 },
    { device_feature_external_id: TEMPERATURE, state: 199 },
  ])
})

test('a failed batch is requeued, unless a fresher value superseded it', async () => {
  const { publisher, states } = setup([SHUTTER])
  publisher.failNext(1)

  states.push([state(SHUTTER, 30)])
  await states.flush()
  assert.equal(publisher.states.length, 0)

  await states.flush()
  assert.deepEqual(publisher.states, [{ device_feature_external_id: SHUTTER, state: 30 }])
})

test('a failed batch is retried on its own, without waiting for another push', async () => {
  // The retry path used to arm nothing: `schedule()` refuses to set a timer
  // while a flush is running, and both retry sites ran inside the flush. The
  // queue then sat there until an unrelated state happened to arrive.
  const { publisher, states } = setup([SHUTTER])
  publisher.failNext(1)

  states.push([state(SHUTTER, 30)])
  await states.flush()
  assert.equal(publisher.states.length, 0, 'the first attempt failed')

  await setTimeout(400)

  assert.deepEqual(publisher.states, [{ device_feature_external_id: SHUTTER, state: 30 }])
})

test('a requeued button press is not swallowed by a press that arrived meanwhile', async () => {
  // The window is narrow but real: the second press has to land WHILE the
  // first is in flight, so that the queue is non-empty when the failure
  // requeues it. Requeue used to treat any queued entry for the same feature
  // as superseding — true for a value, false for an occurrence.
  const sent: number[][] = []
  const logger = createFakeLogger()
  let failed = false
  const publisher = {
    publish: async (batch: Array<{ state?: number }>) => {
      if (!failed) {
        failed = true
        // A press arrives while this batch is being published.
        states.push([state(BUTTON, 1, { event: true })])
        throw new Error('boom')
      }
      sent.push(batch.map((entry) => entry.state as number))
    },
  }
  const states = new StatePublisher({
    logger,
    publish: publisher.publish,
    knownFeatures: () => new Set([BUTTON]),
  })

  states.push([state(BUTTON, 1, { event: true })])
  await states.flush()
  await states.flush()

  assert.deepEqual(sent.flat(), [1, 1], 'both presses must reach Gladys')
})

test('degrading a saturated queue never thins out button presses', async () => {
  const filler = Array.from({ length: 300 }, (_, index) => `ext:test:1:0:battery:level:${index}`)
  const { publisher, clock, states } = setup([...filler, SHUTTER, BUTTON])

  states.push(filler.map((feature, index) => state(feature, index)))
  await states.flush()

  const flood: PendingState[] = []
  for (let value = 0; value < 200; value += 1) {
    flood.push(state(SHUTTER, value), state(BUTTON, 1, { event: true }))
  }
  states.push(flood)
  await states.flush()

  clock.advance(61_000)
  await states.flush()

  const presses = publisher.states.filter((entry) => entry.device_feature_external_id === BUTTON)
  assert.equal(presses.length, 200, 'every press survives the degradation')
})

test('stop() drains what is still queued instead of dropping it', async () => {
  const { publisher, states } = setup([SHUTTER])

  states.push([state(SHUTTER, 30)])
  await states.stop()

  assert.deepEqual(publisher.states, [{ device_feature_external_id: SHUTTER, state: 30 }])
})
