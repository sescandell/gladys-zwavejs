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
  let name = `${value.id}${exposedName === '' ? '' : `:${exposedName}`}`

  if (
    propertyKey &&
    propertyKeyName &&
    propertyKeyName !== propertyKey &&
    name.includes(String(propertyKey))
  ) {
    name = name.replace(String(propertyKey), String(propertyKeyName))
  }

  return name
}
