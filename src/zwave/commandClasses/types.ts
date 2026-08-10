import type { ZwaveValue } from '../../types/zwave.ts'

/**
 * A Gladys device feature template, in the standard discovered-device format.
 *
 * One instance is shared by every node exposing that property, so it must
 * never be mutated: category refinement returns a new object.
 */
export interface FeatureSpec {
  readonly category: string
  readonly type: string
  readonly unit?: string
  readonly min: number
  readonly max: number
  readonly read_only: boolean
  readonly has_feedback: boolean
  readonly keep_history: boolean
}

/**
 * One Gladys feature exposed by a Z-Wave property. A single property can fan
 * out into several features (a multilevel switch exposes both a position and
 * an on/off state).
 */
export interface ExposedFeature {
  /**
   * Feature name, last segment of the external id. Empty string when the
   * property maps to exactly one feature (the common case).
   */
  readonly name: string
  readonly spec: FeatureSpec
  /**
   * Continuous measurement: only the latest value of a publication window
   * carries meaning, so states may be coalesced. Opt-in — the default is to
   * publish every distinct value, because on a shutter or a dimmer the
   * intermediate positions ARE the information (they show the motor moving).
   */
  readonly sampled?: boolean
  /**
   * Event feature: the same value twice means two occurrences (a button
   * pressed twice). Never deduplicated, never coalesced.
   */
  readonly event?: boolean
}

/** Converts one raw Z-Wave value into one Gladys state. */
export interface StateConverter {
  /** Target feature name, '' by default. */
  readonly featureName?: string
  /** Target property, when the update lands on a sibling property. */
  readonly propertyName?: string
  /** Target property key, only honored together with `propertyName`. */
  readonly propertyKeyName?: string
  /** Returns null to publish nothing (unknown or meaningless raw value). */
  readonly convert: (raw: unknown) => number | null
}

/** A local state to apply on a sibling feature right after a command. */
export interface SiblingStateUpdate {
  readonly featureName?: string
  readonly propertyName?: string
  readonly propertyKeyName?: string
  readonly value: number
}

/**
 * What to publish on MQTT for a command, mapped onto the two zwave-js-ui APIs:
 * `sendCommand` (invoke a command class method) and `writeValue` (write a
 * value directly).
 */
export type ZwaveCommand = {
  readonly api: 'sendCommand' | 'writeValue'
  /** Method name for sendCommand, property name for writeValue. */
  readonly name: string
  /** Positional arguments for sendCommand, the single value for writeValue. */
  readonly args: readonly unknown[]
  readonly stateUpdates: readonly SiblingStateUpdate[]
}

/** Builds the MQTT command for a Gladys value. */
export type ActionBuilder = (value: number) => ZwaveCommand

/** One resolved (command class, property[, property key]) mapping. */
export interface PropertyVariant {
  readonly expose: readonly ExposedFeature[]
  readonly fromZwave?: readonly StateConverter[]
  /** Command builders keyed by feature name ('' for a single-feature property). */
  readonly toZwave?: Readonly<Record<string, ActionBuilder>>
}

/**
 * A property of a command class. `self` is the variant used when the value
 * carries no property key (or when no key-specific variant matches); `keys`
 * holds the per-property-key variants (Meter values, Notification events).
 */
export interface PropertyNode {
  readonly self?: PropertyVariant
  readonly keys?: Readonly<Record<string, PropertyVariant>>
}

/** Every property of one command class, keyed by cleaned property name. */
export type PropertyMap = Readonly<Record<string, PropertyNode>>

/**
 * One command class. The three facets of a property — what it exposes, how its
 * values are read, how it is commanded — are declared together so they cannot
 * drift apart: a feature that is discovered is a feature whose reports are
 * understood and whose commands are known.
 */
export interface CommandClassModule {
  /** Numeric command class id, used in the MQTT command payloads. */
  readonly id: number
  /** Cleaned command class name, the first key of every lookup. */
  readonly name: string
  readonly properties: PropertyMap
  /**
   * Variants selected by `<generic>-<specific>` of the node device class —
   * the only thing that tells a dimmer from a shutter motor, both of which
   * speak Multilevel Switch.
   */
  readonly byDeviceClass?: Readonly<Record<string, PropertyMap>>
  /**
   * Narrows a category from the value metadata (`ccSpecific.sensorType`).
   * Returns a NEW spec — never mutates the template.
   */
  readonly refineCategory?: (spec: FeatureSpec, value: ZwaveValue) => FeatureSpec
}

/** Builds a `sendCommand` action. */
export function sendCommand(
  name: string,
  args: readonly unknown[],
  stateUpdates: readonly SiblingStateUpdate[] = [],
): ZwaveCommand {
  return { api: 'sendCommand', name, args, stateUpdates }
}

/** Builds a `writeValue` action. */
export function writeValue(
  property: string,
  value: unknown,
  stateUpdates: readonly SiblingStateUpdate[] = [],
): ZwaveCommand {
  return { api: 'writeValue', name: property, args: [value], stateUpdates }
}
