# @weapon/spec

Core package for [weapon](../../README.md).

> **Note:** This package currently exports TypeScript sources directly. A TypeScript-compatible runtime or bundler (Bun, etc.) is required.

Defines specs, contracts, operations, transports, middleware declarations, and the executor engine. Shared between client and server — contains no server-side runtime code (except the executor).

## Installation

```sh
bun add @weapon/spec
```

## API

### `spec(protocol, contractDef?)`

Creates a spec — the shared definition of transports, middleware, and operations.

```ts
import { spec, http, mcp, type OperationMiddlewareConfig } from "@weapon/spec"
import { type } from "arktype"

const Spec = spec(
  {
    http: http({ authenticate: http.authenticate.bearer<User>() }),
    mcp: mcp({ name: "my-api", version: "1.0.0" }),
    authorize: authorize(),
  },
  {
    ping: {
      http: "GET /ping",
      input: type({}),
      output: type({ ok: "boolean" }),
    },
  },
)
```

**Parameters:**

| Name | Type | Description |
|---|---|---|
| `protocol` | `DefinesProtocol` | Map of transport and middleware declarations |
| `contractDef` | `DefinesContract<Protocol>` | Operation and scope definitions (optional) |

**Returns:** `Spec<Protocol, ContractDef>`

The returned spec exposes:

- `spec.transports` — only the transport members (filtered by `kind: "transport"`)
- `spec.middleware` — only the middleware members (filtered by `kind: "middleware"`)
- `spec.contract` — the contract instance

### `http(config?)`

Creates a declarative HTTP transport. The `const` generic preserves the exact auth scheme type for downstream type inference.

```ts
http({ authenticate: http.authenticate.cookie<User>("session") })
```

**Config (`HttpConfig`):**

| Field | Type | Description |
|---|---|---|
| `authenticate` | `HttpAuthentication<Identity>` or array | Auth scheme declaration(s) |

**Per-operation config (`HttpOperationConfig`):**

A route string or structured object:

```ts
// String form
"GET /tasks"
"POST /tasks/{id}"

// Object form
{ method: "GET", path: "/tasks" }
```

Supported methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`.

Path parameters use `{param}` syntax.

#### `http.authenticate`

Declarative auth scheme helpers. These describe *what* auth is used, not *how* to resolve it. Resolution happens in [`@weapon/gateway`](../gateway).

| Helper | Scheme | Resolver receives |
|---|---|---|
| `http.authenticate.basic<I>()` | HTTP Basic | `(username, password)` |
| `http.authenticate.bearer<I>()` | Bearer token | `(token)` |
| `http.authenticate.header<I>(name)` | API key in header | `(value)` |
| `http.authenticate.cookie<I>(name)` | API key in cookie | `(value)` |
| `http.authenticate.query<I>(name)` | API key in query param | `(value)` |

### `mcp(config?)`

Creates a declarative MCP transport.

```ts
mcp({ name: "my-server", version: "1.0.0" })
mcp({ name: "my-server", version: "1.0.0", authenticate: mcp.authenticate.oauth<User>() })
```

**Config (`McpConfig`):**

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Server name (default: `"weapon-mcp"`) |
| `version` | `string` | Server version (default: `"0.0.0"`) |
| `authenticate` | `McpAuthentication<Identity>` | Auth scheme declaration |

**Per-operation config (`McpOperationConfig`):**

```ts
// Expose as tool (minimal)
mcp: true

// Expose with description
mcp: "List all tasks"

// Expose with hints
mcp: { name: "list_tasks", readOnly: true, idempotent: true }
```

**`McpToolHints`:**

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Override the tool name (defaults to operation key) |
| `readOnly` | `boolean` | Tool does not modify state |
| `destructive` | `boolean` | Tool may destroy data |
| `idempotent` | `boolean` | Repeated calls have the same effect |
| `openWorld` | `boolean` | Tool interacts with external systems |

#### `mcp.authenticate`

| Helper | Scheme | Resolver receives |
|---|---|---|
| `mcp.authenticate.oauth<I>()` | OAuth 2.1 | `(info: OAuthInfo)` |

**`OAuthInfo`:**

| Field | Type | Description |
|---|---|---|
| `token` | `string` | The access token |
| `clientId` | `string` | The OAuth client ID |
| `scopes` | `string[]` | Granted scopes |
| `expiresAt` | `number?` | Token expiration timestamp |

### `executor(spec, config)`

Creates the protocol engine. Server-side only.

```ts
import { executor } from "@weapon/spec"

const exec = executor(Spec, {
  middleware: {
    authorize: {
      onRequest(config, container) { /* ... */ },
    },
  },
  services: [TaskService],
})
```

**Parameters:**

| Name | Type | Description |
|---|---|---|
| `spec` | `Spec<Protocol>` | The spec instance |
| `config` | `ExecutorConfig<Protocol>` | Middleware implementations + services |

**`ExecutorConfig<Protocol>`:**

| Field | Type | Description |
|---|---|---|
| `middleware` | `{ [K]: OperationMiddleware<ConfigOf<Protocol[K]>> }` | One middleware implementation per declared middleware key |
| `services` | `BoundService[]` | Array of bound services |

**Returns:** `Executor`

| Field | Type | Description |
|---|---|---|
| `operations` | `MountedOperation[]` | Flat list of all mounted operations |
| `handle` | `(request, container) => Promise<OperationResponse>` | Runs the full lifecycle |

**Lifecycle:**

1. Validate input against the operation's arktype `input` type
2. Run `onRequest` hooks for each middleware that has config on this operation (declaration order)
3. Call the service handler with validated input and a DI injector
4. Run `onResponse` hooks (reverse declaration order)
5. Return `{ output }`

### `fromRow(type, row)` / `fromRow(type)`

Maps a snake_case database row to a camelCase object, validated by an arktype type.

```ts
import { fromRow } from "@weapon/spec"
import { type } from "arktype"

const User = type({ id: "string", firstName: "string", createdAt: "Date" })

// Direct call
const user = fromRow(User, { id: "1", first_name: "Alice", created_at: new Date() })

// Curried (useful with .map)
const users = rows.map(fromRow(User))
```

## Types

### Spec-level

| Type | Description |
|---|---|
| `Spec<Protocol, ContractDef>` | A spec instance — transports, middleware, and contract |
| `DefinesProtocol` | Constraint for the protocol map — `{ [key]: TransportConfig \| OperationMiddlewareConfig }` |
| `TransportConfig<SpecConfig, OpConfig>` | Declarative transport (has `kind: "transport"`) |
| `OperationMiddlewareConfig<SpecConfig, OpConfig>` | Declarative middleware (has `kind: "middleware"`) |
| `ProtocolMember` | Union of `TransportConfig` and `OperationMiddlewareConfig` |

### Contract-level

| Type | Description |
|---|---|
| `Contract<Protocol, ContractDef>` | Set of operations and nested scopes |
| `DefinesContract<Protocol>` | Constraint — `{ [key]: DefinesOperation \| DefinesContract }` |
| `DefinesOperation<Protocol>` | Operation definition — `{ input: Type, output: Type, description? }` + per-protocol config |
| `BoundService<Protocol, ContractDef>` | A service bound to its contract via `contract.service()` |
| `Service<Protocol, ContractDef>` | Handler map — operations as functions, scopes as nested objects |

### Executor-level

| Type | Description |
|---|---|
| `Executor` | `{ operations, handle }` |
| `ExecutorConfig<Protocol>` | `{ middleware, services }` |
| `OperationRequest` | `{ mounted: MountedOperation, input: unknown }` |
| `OperationResponse` | `{ output: unknown }` |
| `MountedOperation` | `{ key, definition, handler }` — flattened operation + handler pair |
| `OperationMiddleware<OpConfig>` | `{ onRequest?, onResponse? }` — server-side middleware hooks |

### Utility types

| Type | Description |
|---|---|
| `ConfigOf<P>` | Extracts per-operation config from a transport or middleware |
| `SpecConfigOf<P>` | Extracts spec-level config from a transport or middleware |
| `TransportKeysOf<Protocol>` | Filters protocol keys to transports only |
| `MiddlewareKeysOf<Protocol>` | Filters protocol keys to middleware only |
| `InferInput<Op>` | Extracts the inferred input type from an operation |
| `InferOutput<Op>` | Extracts the inferred output type from an operation |
| `SnakeKeyed<T>` | Maps camelCase keys to snake_case (for `fromRow`) |

## License

MIT
