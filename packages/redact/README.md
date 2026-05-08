# @weapon/redact

Sensitive field redaction [weapon](https://github.com/sigitex/weapon).

> 🚧 Experimental

> **Note:** This package currently exports TypeScript sources directly. A TypeScript-compatible runtime or bundler (Bun, etc.) is required.

Walks an arktype type's structure, finds fields annotated with `{ sensitive: true }` in their metadata, and replaces their values using a pluggable strategy (mask or hash).


## Installation

```sh
bun add @weapon/redact
```

## API

### `redact(type, value, options?)`

Redacts sensitive fields in a value, guided by its arktype type definition.

```ts
import { redact } from "@weapon/redact"
import { type } from "arktype"

const User = type({
  id: "string",
  name: "string",
  email: type("string").configure({ meta: { sensitive: true } }),
  ssn: type("string").configure({ meta: { sensitive: true } }),
})

const user = { id: "1", name: "Alice", email: "alice@example.com", ssn: "123-45-6789" }

redact(User, user)
// → { id: "1", name: "Alice", email: "*****************", ssn: "***********" }
```

**Parameters:**

| Name | Type | Description |
|---|---|---|
| `type` | `Type<T>` | The arktype type describing the value's structure |
| `value` | `T` | The value to redact |
| `options` | `{ redactValue? }` | Optional redaction strategy |

**Returns:** A copy of `value` with sensitive fields redacted. The original value is not mutated.

### `redact.mask(value)`

The default redaction strategy. Replaces values based on their type:

| Input type | Result |
|---|---|
| `string` | `"*"` repeated to match length |
| `number` | `0` |
| `bigint` | `0n` |
| `Date` | `new Date(0)` (epoch) |
| `boolean`, `null`, `undefined` | returned as-is |

```ts
redact(User, user)
// uses redact.mask by default
```

### `redact.hash(salt?)`

Deterministic redaction using FNV-1a hashing. Produces consistent output for the same input + salt, useful for audit logs where you need to correlate redacted values without exposing originals.

```ts
redact(User, user, { redactValue: redact.hash("my-salt") })
// → { id: "1", name: "Alice", email: "a8f2c1...", ssn: "b3d4e5..." }

// Same input + salt always produces the same hash
redact(User, user, { redactValue: redact.hash("my-salt") })
// → identical output
```

If no salt is provided, a random one is generated at module load time (consistent within a process, different across restarts).

| Input type | Result |
|---|---|
| `string` | FNV-1a hash as base-36 string |
| `number` | FNV-1a hash as number |
| `bigint` | FNV-1a hash as bigint |
| `Date` | `new Date(hash)` |
| `boolean`, `null`, `undefined` | returned as-is |

## Marking Fields as Sensitive

Sensitive fields are marked using arktype's `configure` with `meta.sensitive`:

```ts
import { type } from "arktype"

const CreditCard = type({
  last4: "string",
  number: type("string").configure({ meta: { sensitive: true } }),
  cvv: type("string").configure({ meta: { sensitive: true } }),
  expiry: "string",
})
```

Redaction is recursive — it walks through objects, arrays, unions, and morphs:

```ts
const Order = type({
  id: "string",
  cards: CreditCard.array(),
})

const order = {
  id: "ord-1",
  cards: [
    { last4: "4242", number: "4242424242424242", cvv: "123", expiry: "12/25" },
  ],
}

redact(Order, order)
// → { id: "ord-1", cards: [{ last4: "4242", number: "****************", cvv: "***", expiry: "12/25" }] }
```

## Custom Redaction Strategies

Provide any function matching the `RedactValue` signature:

```ts
type RedactValue = <Value extends RedactValueType>(value: Value) => Value
```

Where `RedactValueType` is `string | number | bigint | boolean | null | undefined | Date`.

The function must return the same type it receives:

```ts
const truncate: RedactValue = (value) => {
  if (typeof value === "string") return value.slice(0, 2) + "***" as typeof value
  return value
}

redact(User, user, { redactValue: truncate })
// → { id: "1", name: "Alice", email: "al***", ssn: "12***" }
```

## Types

| Type | Description |
|---|---|
| `RedactValue` | `<Value extends RedactValueType>(value: Value) => Value` — redaction function |
| `RedactValueType` | `string \| number \| bigint \| boolean \| null \| undefined \| Date` |

## License

MIT
