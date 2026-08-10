import type { ZwaveValue } from '../types/zwave.ts'

/**
 * Human-readable feature name. It is what the user reads to tell apart two
 * otherwise identical features — two energy readings, two endpoints of the
 * same shutter — so it has to carry the endpoint and the reading.
 *
 * zwave-js ids a value by its raw property key, which is often a number:
 * `6-50-1-65537` becomes `6-50-1-Electric_kWh_Consumed`.
 */
export function buildFeatureName(value: ZwaveValue, exposedName: string): string {
  const { propertyKey, propertyKeyName } = value
  let base = String(value.id)

  // The property key is always the LAST segment of the id, so the substitution
  // is anchored there. Searching for the first occurrence instead would match
  // digits appearing earlier: on `255-67-1-setpoint-1` the key `1` is also the
  // endpoint, and a naive replace produces `255-67-Heating-setpoint-1`.
  const key = propertyKey === undefined || propertyKey === null ? '' : String(propertyKey)
  if (key !== '' && propertyKeyName && propertyKeyName !== propertyKey && base.endsWith(key)) {
    base = `${base.slice(0, -key.length)}${propertyKeyName}`
  }

  return `${base}${exposedName === '' ? '' : `:${exposedName}`}`
}
