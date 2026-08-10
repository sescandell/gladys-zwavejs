import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { DEFAULT_CONFIG } from '../src/config.ts'

/**
 * The manifest is the whole user interface of an external integration: there
 * is no front-end code to keep in sync, only this file. These tests assert the
 * invariants the store validator cannot check — that the form the user fills
 * in and the configuration the code reads describe the same thing.
 */

interface ConfigField {
  key: string
  type: string
  label?: Record<string, string>
  description?: Record<string, string>
  default?: unknown
  required?: boolean
  placeholder?: unknown
  links?: Array<{ url: string; label: Record<string, string> }>
}

const manifest = JSON.parse(
  readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
) as {
  version: string
  docker_image: string
  config_schema: ConfigField[]
  actions: Array<{ key: string; label: Record<string, string>; timeout_seconds?: number }>
}

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string }

const fields = manifest.config_schema
const valueFields = fields.filter((field) => field.type !== 'section')

test('every configuration key the code reads exists in the manifest', () => {
  const declared = new Set(valueFields.map((field) => field.key))
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    assert.ok(declared.has(key), `${key} is read by the code but absent from config_schema`)
  }
})

test('every configuration key the manifest declares is known to the code', () => {
  for (const field of valueFields) {
    assert.ok(field.key in DEFAULT_CONFIG, `${field.key} is in the form but ignored by the code`)
  }
})

test('the manifest defaults are the defaults the code falls back to', () => {
  // A mismatch here means the form shows one value and the integration uses
  // another — the kind of bug that only surfaces on someone else's setup.
  for (const field of valueFields) {
    const codeDefault = DEFAULT_CONFIG[field.key as keyof typeof DEFAULT_CONFIG]
    if (field.default === undefined) {
      assert.equal(
        codeDefault,
        '',
        `${field.key} has no manifest default, the code must fall back to ''`,
      )
    } else {
      assert.equal(field.default, codeDefault, `${field.key} default`)
    }
  }
})

test('the MQTT password is a secret, never a plain string', () => {
  // `secret` is what keeps the value out of every response served to the
  // frontend; a plain string would be readable by any admin session.
  const password = fields.find((field) => field.key === 'mqtt_password')
  assert.equal(password?.type, 'secret')
})

test('section blocks stay presentational', () => {
  for (const field of fields.filter((entry) => entry.type === 'section')) {
    assert.equal(field.required, undefined, `${field.key} must not be required`)
    assert.equal(field.default, undefined, `${field.key} must not have a default`)
    assert.ok(field.label?.en, `${field.key} needs an English label`)
    assert.ok(!(field.key in DEFAULT_CONFIG), `${field.key} stores no value`)
    for (const link of field.links ?? []) {
      assert.ok(link.url.startsWith('https://'), `${link.url} must be https`)
    }
  }
})

test('every field and action is translated in English and French', () => {
  for (const field of fields) {
    assert.ok(field.label?.en && field.label?.fr, `${field.key} label`)
  }
  for (const action of manifest.actions) {
    assert.ok(action.label.en && action.label.fr, `${action.key} label`)
  }
})

test('every declared action has a handler wired in the entry point', () => {
  const entryPoint = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
  for (const action of manifest.actions) {
    assert.match(
      entryPoint,
      new RegExp(`onAction\\('${action.key}'`),
      `${action.key} has no handler`,
    )
  }
})

test('the manifest version and the package version stay in lockstep', () => {
  // The release workflow bumps both; the indexer serves the manifest one.
  assert.equal(manifest.version, packageJson.version)
  assert.ok(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    'docker_image must be tagged with the manifest version',
  )
})
