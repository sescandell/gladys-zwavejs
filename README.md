# Z-Wave JS UI — Gladys Assistant integration

External integration bringing a [Z-Wave JS UI](https://zwave-js.github.io/zwave-js-ui/)
network into [Gladys Assistant](https://gladysassistant.com), over MQTT.

It is a port of the `zwavejs-ui` service that used to live inside the Gladys
core, moved out so it can ship on its own cadence. **Same behaviour, same
devices, same identifiers** — see [ISO functional](#iso-functional) below.

User documentation: [`docs/en.md`](./docs/en.md) · [`docs/fr.md`](./docs/fr.md)

## How it works

```
Z-Wave stick ── Z-Wave JS UI ── MQTT broker ── this container ── Gladys
```

Z-Wave JS UI owns the radio and the network management (inclusion, exclusion,
healing, firmware). This integration only maps what it publishes onto Gladys
devices, and Gladys commands back onto Z-Wave commands. It deliberately does
not reimplement any part of zwave-js.

## Project layout

```
index.ts                        SDK bootstrap + callback wiring, no logic
src/
  config.ts                     defaults, broker and topic resolution
  types/zwave.ts                shapes of the Z-Wave JS UI payloads
  zwave/
    ZwaveJsUiClient.ts          MQTT link (idempotent reconnection)
    NodeRegistry.ts             in-memory view of the network
    topics.ts                   topic tree + subscriptions
    stateValues.ts              Gladys state enums the SDK does not export
    commandClasses/             ONE MODULE PER COMMAND CLASS
                                (switches, sensors, meters, scenes, thermostat)
  mapping/
    DeviceMapper.ts             nodes -> devices, values -> states
    externalId.ts               build/parse of the external ids
    featureName.ts              human-readable feature names
    quirks.ts                   per-device fixes, each with its reason
    clean.ts                    name normalization
  runtime/
    ZwaveIntegration.ts         the integration itself
    StatePublisher.ts           dedup, batching, coalescing, budget
    CommandDispatcher.ts        Gladys command -> MQTT message
```

### One module per command class

A command class module gathers the three facets of each property in one place:
what it **exposes** as Gladys features, how its values are **read**
(`fromZwave`), and how it is **commanded** (`toZwave`). The internal service
kept those in three parallel trees indexed by the same keys, which had to be
edited in lockstep.

Variants selected by the Z-Wave device class live in `byDeviceClass`: a dimmer
(`17-1`) and a window covering motor (`17-5/6/7`) both speak Multilevel Switch
but mean entirely different things — including a value of `0`, which is OFF for
one and STOP for the other.

Adding support for a command class is adding one file and one line in
`commandClasses/index.ts`.

## Beyond the built-in service: thermostats

The built-in `zwavejs-ui` service does not handle thermostats. This integration
does, through Thermostat Mode (0x40), Operating State (0x42) and Setpoint
(0x43) — the work of the abandoned
[Gladys PR #2730](https://github.com/GladysAssistant/Gladys/pull/2730), ported
onto the feature types the Gladys core has gained since.

Two adjustments were needed rather than a straight port:

- that PR added `AC_MODE.OFF` and `AC_MODE.ENERGY_HEAT` to the core and mapped
  the mode onto an air-conditioning feature. Those enum values were never
  merged, so the mode maps onto `THERMOSTAT.MODE` and the `THERMOSTAT_MODE`
  values the core does have (off / heat / cool / auto). The Z-Wave "Energy Save
  Heat" mode is consequently reported as heating — see the user docs;
- writing a setpoint carries its `propertyKey`: a thermostat exposes several
  setpoints under the same `setpoint` property, and without the key the write
  lands on whichever one zwave-js resolves first.

## ISO functional

`test/golden.test.ts` runs the mapper over a real `getNodes` dump and compares
the result to `test/fixtures/golden-devices.json` — which is **the output of
the internal Gladys service**, not a hand-written expectation. Any drift in a
category, type, unit, bound, name or feature order fails the build.

That is what makes the per-device migration a one-to-one match: the external
ids keep the exact same structure, only prefixed with the mandatory
`ext:<selector>:`.

## Notable differences from the internal service

Behaviour is identical; the plumbing is not, because an external integration
lives under different constraints.

- **States are filtered, deduplicated and batched.** The core accepts 300
  states/minute per integration. States for devices the user never created are
  dropped first, identical values are deduplicated, and batches are capped at 100. Coalescing is **opt-in per feature** (`sampled`): a shutter or dimmer
  keeps every intermediate position, because watching the position progress is
  how the user sees the command was taken into account.
- **Commands need no node cache.** Everything is derived from the feature
  external id, the command class module and the Gladys feature category. The
  internal service refused commands for nodes missing from the last scan.
- **Reconnection is idempotent.** Re-opening always closes the previous client;
  the internal `/connect` route leaked one per call.
- **Subscriptions are targeted.** The node event branch of the configured
  gateway, instead of `zwave/#`.
- **The gateway name and topic prefix are configurable**, instead of hardcoded
  in four places.
- **Sensor category refinement no longer mutates shared templates** (it used to
  leak a refined category from one node to another).
- **A valueless node keeps its location param** (it used to be lost).

## Development

Node ≥ 22.18 runs the TypeScript sources directly through native type
stripping: there is **no build step** and no `dist/`. `tsc` is only ever a type
checker, and the image ships the sources as written.

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run lint        # oxlint
npm run format      # oxfmt
npm test            # node --test, including the golden test
```

Run it against a local Gladys:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="ext-dev-gladys-zwavejs" \
LOG_LEVEL=debug \
npm start
```

Before publishing, run the store validator:

```bash
npx github:GladysAssistant/integration-store .
```

## Roadmap

Running Mosquitto and Z-Wave JS UI as companion sub-containers (manifest
`containers`) is the natural next step. The MQTT connection is already isolated
behind `resolveBroker()` for that reason. The Mosquitto half works with Gladys
as it stands; the Z-Wave JS UI half needs a serial hardware class
(`/dev/ttyACM*`, `/dev/ttyUSB*`) to be added to the core's `HARDWARE_CLASSES`
allow-list, which today only covers Coral, GPU and video devices.

## License

Apache-2.0
