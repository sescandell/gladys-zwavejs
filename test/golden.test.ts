import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { DeviceMapper } from '../src/mapping/DeviceMapper.ts'
import type { ZwaveNode } from '../src/types/zwave.ts'

/**
 * THE ISO-FUNCTIONAL PROOF.
 *
 * `golden-devices.json` is not hand-written: it is the output of the INTERNAL
 * Gladys service (`server/services/zwavejs-ui/utils/convertToGladysDevice.js`)
 * run over a real `getNodes` dump. If this test passes, the external
 * integration maps a Z-Wave network into exactly the same devices, features,
 * categories, types, units, bounds, names and order as the service it
 * replaces — which is what makes the per-device migration a one-to-one match.
 *
 * Two differences are expected and normalized here:
 *   - the `zwavejs-ui:` prefix becomes the `ext:<selector>:` prefix the core
 *     enforces on every external integration;
 *   - the internal service carried extra in-memory fields on each feature
 *     (command_class, endpoint, property_name...) that were never persisted;
 *     the external integration resolves commands without them.
 *
 * On top of that, a SHORT and EXPLICIT list of deliberate divergences is
 * declared below. The reference fixture is never regenerated: a divergence has
 * to be written down here, with its reason, or the test fails. That is what
 * keeps "we changed this on purpose" from decaying into "we broke this and
 * refreshed the expectations".
 */

const SELECTOR = 'ext-sescandell-gladys-zwavejs'

const readFixture = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as T

/** Fields the internal service kept in memory only, absent from the DB shape. */
const IN_MEMORY_ONLY = new Set([
  'selector',
  'node_id',
  'command_class_version',
  'command_class_name',
  'command_class',
  'endpoint',
  'property_name',
  'property_key_name',
  'feature_name',
])

interface GoldenFeature {
  external_id: string
  [key: string]: unknown
}
interface GoldenDevice {
  name: string
  external_id: string
  features: GoldenFeature[]
  params: Array<{ name: string; value: string }>
  [key: string]: unknown
}

/**
 * Deliberate departures from the internal service. Anything not listed here
 * must match it exactly.
 */
/** Deliberate departures on the device itself. */
const INTENTIONAL_DEVICE_DIVERGENCES: Array<{
  reason: string
  applies: (device: GoldenDevice) => boolean
  override: (device: GoldenDevice) => Record<string, unknown>
}> = [
  {
    reason:
      'A Z-Wave node has no name until someone types one in Z-Wave JS UI, and the ' +
      'reference output kept it empty. The Gladys host API rejects a nameless ' +
      'device — and the whole batch with it — so the model description is used ' +
      'as a fallback (node 1 is the controller stick).',
    applies: (device) => device.name === '',
    override: () => ({ name: 'Z‐Stick Gen5 USB Controller' }),
  },
]

const INTENTIONAL_DIVERGENCES: Array<{
  reason: string
  applies: (feature: GoldenFeature) => boolean
  override: Record<string, unknown>
}> = [
  {
    reason:
      'The internal service declared max 4, the raw Z-Wave scene value, while the ' +
      'converter publishes BUTTON_STATUS codes (hold 5, triple 18, release 20). ' +
      '84 is the bound the Matter integration uses for a click feature.',
    applies: (feature) => feature.category === 'button' && feature.type === 'click',
    override: { max: 84 },
  },
  {
    reason:
      'The internal service declared min 0 while COVER_STATE.CLOSE is -1, so closing ' +
      'a shutter sent a value below the feature bounds. -1 is what the Zigbee2mqtt ' +
      'integration declares.',
    applies: (feature) => feature.category === 'shutter' && feature.type === 'state',
    override: { min: -1 },
  },
]

/** Bring a golden device to the shape an external integration publishes. */
function normalizeGolden(device: GoldenDevice) {
  const rewrite = (id: string) => id.replace(/^zwavejs-ui:/, `ext:${SELECTOR}:`)
  const deviceOverrides = INTENTIONAL_DEVICE_DIVERGENCES.filter((divergence) =>
    divergence.applies(device),
  ).reduce((accumulator, divergence) => Object.assign(accumulator, divergence.override(device)), {})

  return {
    name: device.name,
    ...deviceOverrides,
    external_id: rewrite(device.external_id),
    params: device.params,
    features: device.features.map((feature) => {
      const kept: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(feature)) {
        if (!IN_MEMORY_ONLY.has(key)) {
          kept[key] = key === 'external_id' ? rewrite(value as string) : value
        }
      }
      for (const divergence of INTENTIONAL_DIVERGENCES) {
        if (divergence.applies(feature)) {
          Object.assign(kept, divergence.override)
        }
      }
      return kept
    }),
  }
}

test('the mapper reproduces the internal service device by device', () => {
  const { result } = readFixture<{ result: ZwaveNode[] }>('exampleNodes.json')
  const golden = readFixture<GoldenDevice[]>('golden-devices.json')

  const mapper = new DeviceMapper((suffix) => `ext:${SELECTOR}:${suffix}`)
  const devices = mapper.toDiscoveredDevices(result)

  assert.equal(devices.length, golden.length, 'device count')

  for (const [index, expected] of golden.entries()) {
    const actual = devices[index]
    assert.deepEqual(actual, normalizeGolden(expected), `device ${expected.external_id}`)
  }
})

test('every declared divergence is actually exercised by the fixture', () => {
  // A divergence nobody applies is a divergence nobody notices going stale:
  // it would silently mask a future regression on that feature.
  const golden = readFixture<GoldenDevice[]>('golden-devices.json')
  const features = golden.flatMap((device) => device.features)

  for (const divergence of INTENTIONAL_DIVERGENCES) {
    assert.ok(
      features.some((feature) => divergence.applies(feature)),
      `no fixture feature matches: ${divergence.reason}`,
    )
  }
  for (const divergence of INTENTIONAL_DEVICE_DIVERGENCES) {
    assert.ok(
      golden.some((device) => divergence.applies(device)),
      `no fixture device matches: ${divergence.reason}`,
    )
  }
})

test('every published device carries a name, whatever the node reports', () => {
  // The host API rejects the whole batch over a single nameless device, so
  // this is not cosmetic: one unnamed node blanks the Discovery screen.
  const { result } = readFixture<{ result: ZwaveNode[] }>('exampleNodes.json')
  const mapper = new DeviceMapper((suffix) => `ext:${SELECTOR}:${suffix}`)

  for (const device of mapper.toDiscoveredDevices(result)) {
    assert.ok(
      typeof device.name === 'string' && device.name.length > 0,
      `${device.external_id} has no name`,
    )
  }
})

test('the broadcast pseudo-node never becomes a device', () => {
  const { result } = readFixture<{ result: ZwaveNode[] }>('exampleNodes.json')
  const mapper = new DeviceMapper((suffix) => `ext:${SELECTOR}:${suffix}`)

  assert.ok(
    result.some((node) => node.virtual === true),
    'the fixture must contain a virtual node for this test to mean anything',
  )
  assert.equal(
    mapper.toDiscoveredDevices(result).some((device) => device.external_id.endsWith(':255')),
    false,
  )
})
