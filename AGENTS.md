# Working on this repository

This file documents the **mechanisms** available when extending the
integration, and the rules that must hold. It is meant for anyone touching the
code — human or agent.

For what the integration _is_ and how the pieces fit together, read
[`README.md`](./README.md) first. This file does not repeat it, and neither
file lists individual command classes or devices: that is the user
documentation ([`docs/en.md`](./docs/en.md), [`docs/fr.md`](./docs/fr.md)) and
the code itself.

---

## Rules that come before everything else

**External ids are persisted and frozen.** They are what a device migration
matches on, so changing how one is built renames a feature for every installed
device — the user loses it and its history. That applies to `externalId.ts`, to
`clean.ts` (its output goes _inside_ the ids), and to any new feature exposed
where one already existed. When a Z-Wave source disappears but the feature must
survive, reuse the old id rather than mint a new one; see _Derived values_.

**The golden test is never regenerated.** `test/golden.test.ts` maps a real
`getNodes` dump and compares it, device by device, to the output of the
internal Gladys service this integration replaces. A deliberate difference is
declared in the list at the top of that file, **with its reason**, or the test
fails. Refreshing the fixture to make a test pass destroys the only proof that
the migration is one-to-one.

**Comments say why, not what.** The code is read by people deciding whether a
rule still applies. A quirk without its reason is a line nobody dares delete.

**No build step.** Node runs the TypeScript sources directly; `tsc` is only a
type checker and the image ships the sources as written. There is no `dist/`.

Before proposing a change: `npm run typecheck && npm run lint && npm test`.

---

## The command class registry

`src/zwave/commandClasses/` holds one module per command class, registered in
`index.ts`. A module gathers the three facets of each property — what it
exposes, how its values are read, how it is commanded — so they cannot drift
apart.

### Anatomy

```ts
export const example: CommandClassModule = {
  id: 49, // numeric CC id, used in MQTT command payloads
  name: 'multilevel_sensor', // cleaned CC name, first key of every lookup
  properties: {/* … */},
  byDeviceClass: {/* … */}, // optional
  refineCategory: (spec, value) => spec, // optional
}
```

### `properties`, `self` and `keys`

A property maps to a `PropertyNode` with two possible shapes:

- `self` — the variant used when the value carries no property key, or when no
  key-specific variant matches.
- `keys` — one variant per **property key**, for command classes where the key
  carries the meaning: Meter readings, Notification events, thermostat setpoint
  types.

Keys are matched through `clean()`: `Door state (simple)` becomes
`door_state_simple`.

### Resolution order

`resolveVariant()` takes the most specific match, and falls back to the
property itself when the key is unknown — which is what lets a single Central
Scene definition serve every `001`, `002`… scene of a controller:

1. `<deviceClass>.<property>.<propertyKey>`
2. `<property>.<propertyKey>`
3. `<deviceClass>.<property>`
4. `<property>`

### `byDeviceClass`

Variants selected by `<generic>-<specific>` of the node device class. This is
the only thing that tells a dimmer from a window covering motor: both speak
Multilevel Switch, and a value of `0` means OFF for one and STOP for the other.

### `expose`

One property can fan out into several Gladys features:

```ts
expose: [
  { name: 'position', spec: positionSpec },
  { name: 'state', spec: stateSpec },
]
```

- `name` — last segment of the external id. **Empty string** when the property
  maps to exactly one feature (the common case).
- `spec` — the feature template. It is shared by every node exposing that
  property, so it must never be mutated.
- `sampled` — opt-in coalescing. Only for continuous measurements where just
  the latest value of a window matters (temperature, meter, battery level). A
  shutter or dimmer position must **not** be sampled: the intermediate values
  are how the user sees the motor moving.
- `event` — the same value twice means two occurrences (a button press). Never
  deduplicated, never coalesced.

An **empty `expose`** together with a `toZwave` declares a command-only
property, such as `restorePrevious` on a non-dimmer.

### `refineCategory`

Narrows a category from the value metadata, typically `ccSpecific.sensorType` —
a Binary Sensor is a boolean whose real nature (smoke, leak, opening…) is only
known from that field. It returns a **new** spec; mutating the template would
corrupt every other node sharing it.

### `fromZwave` — reading values

A list of `StateConverter`. Each one may publish one state:

```ts
fromZwave: [{ convert: (raw) => (typeof raw === 'number' ? raw : null) }]
```

- `convert` returns `null` to publish **nothing** — unknown or meaningless raw
  value. Prefer a total mapping over a whitelist of codes: a converter that
  returns `null` on an unexpected input leaves the feature frozen on its
  previous value.
- `featureName` — which exposed feature this state feeds, `''` by default.
- `propertyName` (plus optional `propertyKeyName`) — publish onto a **sibling
  property** instead of this one. Used when a report also tells you something
  about another value: a Multilevel Switch position report also says whether
  "restore previous" is now on.
- `when(node)` — run only when this returns true. Lets a converter depend on
  the node as a whole rather than on its own value. Used by the Battery level
  to feed the low-battery flag _only_ on nodes that do not report that flag
  themselves, so the two can never contradict each other.

### `toZwave` — commanding

Command builders keyed by feature name (`''` for a single-feature property),
each returning a `ZwaveCommand` built with one of two helpers, mapped onto the
two zwave-js-ui APIs:

- `sendCommand(name, args, stateUpdates)` — invoke a command class method
  (`set`, `stopLevelChange`…).
- `writeValue(property, value, stateUpdates, propertyKey)` — write a value
  directly. `propertyKey` disambiguates a property that exists several times on
  the same command class (one `setpoint` per setpoint type); without it the
  write lands on whichever one zwave-js picks.

`stateUpdates` are sibling states applied locally right after the command, so
the UI reflects the action without waiting for the device to report back:

```ts
sendCommand(
  'set',
  [99],
  [
    { featureName: 'position', value: 99 },
    { propertyName: 'restoreprevious', value: STATE.ON },
  ],
)
```

### Resolving a command back from a feature

`resolveCommand()` works from the external id and the Gladys feature
**category** alone — never from the node cache — so a command works on a cold
cache, right after a restart. The category is what disambiguates two variants
of the same command class, and it was itself produced by the mapping, so the
lookup is the exact inverse of the discovery decision.

The trailing segments of an external id are **ambiguous on purpose**: one
trailing segment can be a property key (`central_scene:scene:001`) or a feature
name (`multilevel_switch:currentvalue:position`), and nothing in the string
says which. The resolver tries both interpretations, in two passes: first
requiring a variant that exposes a feature of that category under that name,
then accepting a command-only variant.

### State values

Gladys state enums are not exported by the SDK. They are mirrored in
`src/zwave/stateValues.ts`, deliberately limited to what this integration
actually produces or consumes — copying the whole enums would create a second
source of truth to keep in sync. Watch two traps: `COVER_STATE.STOP` (0)
collides with `STATE.OFF` (0), and `OPENING_SENSOR_STATE` is inverted compared
to `STATE`.

---

## Derived values

`derivedValues(node)` returns values a node _should_ expose but no longer
publishes. They are synthetic: they carry no value of their own, and exist so
that discovery keeps producing the same external id.

This exists because upstream can remove a value. zwave-js 15.10.0 dropped the
Battery CC `isLow` value — turning the warning into a notification event — and
cleaned the stale ones up on startup, which would otherwise make the feature,
and the user's history, disappear.

The pattern, when you need it:

1. detect that the node does not publish the value itself — never assume, both
   worlds have to keep working;
2. emit a synthetic value carrying the **historical** property name, so the
   external id is unchanged;
3. feed the feature from whatever source is still available, with a `fromZwave`
   converter using `propertyName` and `when`.

---

## Quirks

`src/mapping/quirks.ts` runs on the mapped features of one node, with the node
at hand. It is the only place with a **whole-node view**, so it handles rules a
single property cannot express — typically two command classes reporting the
same physical event.

It currently only **removes** features. This is the file that silently deletes
things the user would otherwise see, so every rule carries the reason it
exists, and devices are matched on `deviceId`
(`<manufacturerId>-<productType>-<productId>`).

Prefer a nominative quirk over a general rule unless the general rule is
provably safe: the mapping is global, so anything added there applies to every
node on every network.

---

## The network cache

`NodeRegistry` holds the view of the network that discovery is computed from.
Two entry points, and one rule.

- `replace(nodes)` — a full `getNodes` answer, the source of truth.
- `upsert(node)` — one node event.

**A node event does not always carry the node's full state.** zwave-js-ui emits
`node_added` before the interview, and re-announces every node when it
restarts, with `values` still empty or partial. Taking that at face value drops
features that are perfectly alive — and since the discovery payload _replaces_
the Gladys device list, the user's devices come back with no feature at all.

So the registry reconciles instead of overwriting: a node reported `ready` is
authoritative and may legitimately drop a value; anything else only ever adds.
Both methods return a `degraded` boolean saying the incoming node carried less
than the cache already held, which the runtime turns into a debounced
`getNodes` resynchronization.

---

## Publishing states

The four stages — drop unknown features, deduplicate with a TTL, batch and
coalesce, respect the budget — are described in the README. What matters when
writing a module is choosing `sampled` and `event` correctly (see _`expose`_
above): those two flags are the only thing the publisher knows about the nature
of a feature.

Note also that a full `getNodes` republishes the states of known devices. A
value that never changes is only reported at interview time, so without that, a
feature added to an **already existing** device would stay empty until the node
happened to change — months, on a sleeping sensor.

---

## Diagnostics

An integration has no diagnostics page of its own yet, so the journal is the
only thing a user can copy out of. On the first `getNodes` of each start, the
integration logs one line per node (id, name, `ready`, status, value count) and
one line per device (external id, name, feature categories). That pair is what
separates "the node was not interviewed" from "the mapping did not produce the
feature".

The `dump_devices` manifest action writes the full discovery payload — what
Gladys is actually sent. Keep it that way: it is the answer to "why is this
feature missing?", and it is small enough to paste into a bug report.

---

## Tests

`npm test` runs `node --test` over `test/**/*.test.ts`. No framework, no mocks
beyond `test/helpers/fakes.ts`.

**Fixtures are real dumps** captured from live networks, in `test/fixtures/`.
When a user reports a problem, the fix starts by adding their `getNodes` output
as a fixture: it is what turns a report into a regression test. The
`dump_devices` action exists to make that dump easy to obtain.

A new test must **fail without the fix**. Check it — `git stash` the source
change and run the test — or it proves nothing.

Adding support for a device usually means:

1. add its dump to `test/fixtures/`;
2. add or extend the command class module;
3. assert the features it produces, and the states its values convert to;
4. run the golden test — it must stay green, or the difference is declared with
   its reason.
