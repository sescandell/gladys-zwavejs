import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveBroker, sameBroker, TOPIC_SETTINGS } from '../src/config.ts'

const SELECTOR = 'ext-dev-test'

test('an empty broker URL means "not configured", not a broken connection', () => {
  assert.equal(resolveBroker({}, SELECTOR), undefined)
  assert.equal(resolveBroker({ mqtt_url: '   ' }, SELECTOR), undefined)
})

test('surrounding whitespace is forgiven on the URL and the username', () => {
  const broker = resolveBroker(
    { mqtt_url: '  mqtt://host:1884 ', mqtt_username: ' gladys ' },
    SELECTOR,
  )
  assert.equal(broker?.url, 'mqtt://host:1884')
  assert.equal(broker?.username, 'gladys')
})

test('the password is passed through verbatim, spaces included', () => {
  // Trimming a password turns a valid credential into an authentication
  // failure the user cannot diagnose: the field is a secret, so they cannot
  // even look at what was stored.
  const broker = resolveBroker(
    { mqtt_url: 'mqtt://host:1884', mqtt_password: '  s3cr3t  ' },
    SELECTOR,
  )
  assert.equal(broker?.password, '  s3cr3t  ')
})

test('empty credentials are omitted rather than sent as empty strings', () => {
  const broker = resolveBroker(
    { mqtt_url: 'mqtt://host:1884', mqtt_username: '', mqtt_password: '' },
    SELECTOR,
  )
  assert.equal(broker?.username, undefined)
  assert.equal(broker?.password, undefined)
})

test('the client id is stable across reconnections', () => {
  const first = resolveBroker({ mqtt_url: 'mqtt://host:1884' }, SELECTOR)
  const second = resolveBroker({ mqtt_url: 'mqtt://host:1884' }, SELECTOR)
  assert.equal(first?.clientId, second?.clientId)
})

test('sameBroker only ignores what does not affect the connection', () => {
  const base = resolveBroker({ mqtt_url: 'mqtt://host:1884', mqtt_password: 'a' }, SELECTOR)
  const samePassword = resolveBroker({ mqtt_url: 'mqtt://host:1884', mqtt_password: 'a' }, SELECTOR)
  const otherPassword = resolveBroker(
    { mqtt_url: 'mqtt://host:1884', mqtt_password: 'b' },
    SELECTOR,
  )

  assert.equal(sameBroker(base, samePassword), true)
  assert.equal(sameBroker(base, otherPassword), false)
  assert.equal(sameBroker(base, undefined), false)
  assert.equal(sameBroker(undefined, undefined), true)
})

test('the topic coordinates are the ones the user is told to set in Z-Wave JS UI', () => {
  // Fixed, not configurable: the setup instructions and these values are one
  // and the same contract, and they must not drift apart.
  assert.deepEqual(TOPIC_SETTINGS, {
    prefix: 'zwave',
    gateway: 'ZWAVE_GATEWAY-zwave-js-ui',
  })
})
