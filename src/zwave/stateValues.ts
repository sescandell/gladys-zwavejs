/**
 * Gladys state values used by the converters.
 *
 * These are NOT exported by the SDK (which only ships categories, types and
 * units), so they are mirrored here from `server/utils/constants.js`. Only the
 * values this integration actually produces or consumes are listed — copying
 * the whole enums would create a second source of truth to keep in sync for
 * no benefit.
 */

/** Binary state of a switch, a sensor or a battery-low flag. */
export const STATE = {
  ON: 1,
  OFF: 0,
} as const

/** Button events of the Central Scene command class. */
export const BUTTON_STATUS = {
  CLICK: 1,
  DOUBLE_CLICK: 2,
  HOLD_CLICK: 5,
  TRIPLE: 18,
  RELEASE: 20,
} as const

/** Shutter command values. Note STOP (0) collides with STATE.OFF (0). */
export const COVER_STATE = {
  STOP: 0,
  OPEN: 1,
  CLOSE: -1,
} as const

/** Opening sensor state — inverted compared to STATE: OPEN is 0. */
export const OPENING_SENSOR_STATE = {
  OPEN: 0,
  CLOSE: 1,
} as const
