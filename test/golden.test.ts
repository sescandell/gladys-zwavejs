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

/** Bring a golden device to the shape an external integration publishes. */
function normalizeGolden(device: GoldenDevice) {
  const rewrite = (id: string) => id.replace(/^zwavejs-ui:/, `ext:${SELECTOR}:`)
  return {
    name: device.name,
    external_id: rewrite(device.external_id),
    params: device.params,
    features: device.features.map((feature) => {
      const kept: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(feature)) {
        if (!IN_MEMORY_ONLY.has(key)) {
          kept[key] = key === 'external_id' ? rewrite(value as string) : value
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
