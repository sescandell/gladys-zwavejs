# Z-Wave JS UI — Gladys Assistant integration

External integration bringing a [Z-Wave JS UI](https://zwave-js.github.io/zwave-js-ui/)
network into [Gladys Assistant](https://gladysassistant.com), over MQTT.

User documentation: [`docs/en.md`](./docs/en.md) · [`docs/fr.md`](./docs/fr.md)

## How it works

```
Z-Wave stick ── Z-Wave JS UI ── MQTT broker ── this container ── Gladys
```

Z-Wave JS UI owns the radio and the network management (inclusion, exclusion,
healing, firmware). This integration maps what it publishes onto Gladys
devices, and Gladys commands back onto Z-Wave commands. It deliberately does
not reimplement any part of zwave-js.

The devices it can build, command class by command class, are listed in the
user documentation.

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
(`fromZwave`), and how it is **commanded** (`toZwave`). Declaring them together
is what keeps them from drifting apart.

Variants selected by the Z-Wave device class live in `byDeviceClass`: a dimmer
(`17-1`) and a window covering motor (`17-5/6/7`) both speak Multilevel Switch
but mean entirely different things — including a value of `0`, which is OFF for
one and STOP for the other.

Adding support for a command class is adding one file and one line in
`commandClasses/index.ts`.

### Publishing states

Gladys accepts 300 states per minute per integration, 100 per request. A Z-Wave
network reports faster than that, so `StatePublisher` puts four stages between
the network and the host API:

1. states for devices the user has not created are dropped;
2. a value identical to the last published one is dropped, unless the feature
   is an **event** (a button press counts every time, even repeated);
3. states are batched, and **coalesced only where coalescing is wanted**
   (`sampled`: temperatures, meters, battery levels). A shutter or a dimmer
   keeps every intermediate position — watching the position progress is how
   the user sees the command was taken into account;
4. a sliding budget holds the queue back rather than overrunning the limit.

### Commanding devices

Everything a command needs is derived from the feature external id, the command
class module and the Gladys feature category — no node cache lookup — so a
command works right after a restart, before the first scan has answered.

External ids are structured, and persisted:

```
device  : ext:<selector>:<nodeId>
feature : ext:<selector>:<nodeId>:<endpoint>:<cc>:<property>[:<propertyKey>][:<featureName>]
```

## Development

Node ≥ 22.18 runs the TypeScript sources directly through native type
stripping: there is **no build step** and no `dist/`. `tsc` is only ever a type
checker, and the image ships the sources as written.

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run lint        # oxlint
npm run format      # oxfmt
npm test            # node --test
```

Tests run against real `getNodes` payloads captured from live networks
(`test/fixtures/`). `test/golden.test.ts` maps the whole dump and compares it to
a stored reference, so any drift in a category, type, unit, bound, name or
feature order fails the build.

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

## License

Apache-2.0
