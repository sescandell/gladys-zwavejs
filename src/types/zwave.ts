/**
 * Shapes of the zwave-js-ui MQTT payloads.
 *
 * These mirror what zwave-js-ui actually publishes, not the full zwave-js
 * model: we only describe the fields the integration reads. Everything else
 * travels untouched and is deliberately absent here — this integration wires
 * zwave-js-ui into Gladys, it does not reimplement zwave-js.
 */

/** Z-Wave device class of a node, driving the variant selection (see command classes). */
export interface ZwaveDeviceClass {
  basic: number
  generic: number
  specific: number
}

/**
 * One value of a node, as published by zwave-js-ui. The key in `ZwaveNode.values`
 * is `<nodeId>-<commandClass>-<endpoint>-<property>[-<propertyKey>]`.
 */
export interface ZwaveValue {
  /** `<nodeId>-<commandClass>-<endpoint>-<property>[-<propertyKey>]`. */
  id: string
  nodeId: number
  commandClass: number
  commandClassName: string
  commandClassVersion?: number
  endpoint?: number
  property: string | number
  propertyName: string
  propertyKey?: string | number | null
  propertyKeyName?: string | null
  type?: string
  readable?: boolean
  writeable?: boolean
  label?: string | null
  /** Command-class specific metadata; `sensorType` refines a sensor category. */
  ccSpecific?: { sensorType?: number; [key: string]: unknown } | null
  /**
   * Current value, present in the getNodes snapshot.
   *
   * `unknown` rather than a union: we walk EVERY value of every node,
   * including the command classes we do not handle, and zwave-js types a value
   * as number, boolean, string, array, duration, color, buffer or `any`
   * depending on the command class. Any union would be a lie the day an
   * unhandled class reports something else — and it would remove no check,
   * since the converters narrow with `typeof` either way.
   */
  value?: unknown
  /** The updated value, present in a node_value_updated event. */
  newValue?: unknown
  lastUpdate?: number
  [key: string]: unknown
}

/** A node of the Z-Wave network, as published by zwave-js-ui. */
export interface ZwaveNode {
  id: number
  /** User-defined name, empty string when never set. */
  name?: string
  /** User-defined location, mapped to the Gladys `location` device param. */
  loc?: string
  /** `<manufacturerId>-<productType>-<productId>`, used by the device quirks. */
  deviceId?: string
  /** Readable model description, e.g. `Fibaro Door Window Sensor 2`. */
  productDescription?: string
  /** Model reference, e.g. `FGDW002`. */
  productLabel?: string
  deviceClass?: ZwaveDeviceClass
  /** The broadcast/multicast pseudo-nodes, never exposed as Gladys devices. */
  virtual?: boolean
  ready?: boolean
  available?: boolean
  failed?: boolean
  status?: string
  values?: Record<string, ZwaveValue>
  [key: string]: unknown
}

/** Payload of `<prefix>/_CLIENTS/<gateway>/api/getNodes`. */
export interface GetNodesResponse {
  success: boolean
  message?: string
  result?: ZwaveNode[]
}

/**
 * Payload of `<prefix>/_EVENTS/<gateway>/node/node_value_updated`:
 * `data` is the positional `[node, updatedValue]` tuple emitted by zwave-js.
 */
export interface NodeValueUpdatedEvent {
  data?: [ZwaveNode, ZwaveValue]
}

/** Payload of the node lifecycle events used to keep the node cache warm. */
export interface NodeEvent {
  data?: [ZwaveNode, ...unknown[]]
}
