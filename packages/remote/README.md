# @weapon/remote

Typed HTTP client for [weapon](../../README.md).

> 🚧 Experimental

> **Note:** This package currently exports TypeScript sources directly. A TypeScript-compatible runtime or bundler (Bun, etc.) is required.

Mirrors a spec's contract as async functions — operations become callable methods, scopes become nested objects. Reads HTTP route config from operation definitions to build requests automatically.

## Installation

```sh
bun add @weapon/remote
```

## API

### `remote(spec, transport, config)`

Creates a typed client from a spec.

```ts
import { remote } from "@weapon/remote"

const api = remote(Spec, Spec.transports.http, {
  base: "https://api.example.com",
  authenticate: () => getSessionToken(),
})

// Operations are typed async functions
const tasks = await api.tasks.list({})
const task = await api.tasks.create({ title: "Buy milk" })
const found = await api.tasks.get({ id: task.id })
```

**Parameters:**

| Name | Type | Description |
|---|---|---|
| `spec` | `Spec<Protocol, ContractDef>` | The spec instance |
| `transport` | `TransportConfig<Config, HttpOperationConfig>` | The HTTP transport from `Spec.transports.http` |
| `config` | `RemoteConfig<Config>` | Base URL, auth provider, and options |

**Returns:** `Remote<Protocol, ContractDef>`

The returned object mirrors the contract structure:
- Operations become `(input) => Promise<output>` functions
- Scopes become nested objects with the same structure

## Config

### `RemoteConfig<Config>`

| Field | Type | Description |
|---|---|---|
| `base` | `string` | Base URL of the gateway (e.g. `"https://api.example.com"`) |
| `authenticate` | `AuthProviderFor<...>` | Credential provider (required when the spec declares auth) |
| `headers` | `Record<string, string>` or `() => Record<string, string>` | Optional headers included on every request |
| `fetch` | `typeof fetch` | Optional custom fetch implementation |

### Auth Providers

The `authenticate` function is the inverse of the gateway's resolver — instead of `(credentials) -> identity`, it's `() -> credentials`:

| Scheme | Provider signature |
|---|---|
| `http.authenticate.basic<I>()` | `() => { username: string, password: string }` |
| `http.authenticate.bearer<I>()` | `() => string` |
| `http.authenticate.cookie<I>(name)` | `() => string` |
| `http.authenticate.header<I>(name)` | `() => string` |
| `http.authenticate.query<I>(name)` | `() => string` |

All providers may return a `Promise`.

If the spec declares no auth scheme, the `authenticate` field is not required.

## Request Building

### Path Parameters

Path parameters (`{param}` syntax) are substituted from the input object. Matched keys are consumed; remaining keys go to the body or query string.

```ts
// Definition: "GET /tasks/{id}"
// Call:
await api.tasks.get({ id: "abc" })
// Request: GET /tasks/abc
```

### Body vs Query

- **GET / HEAD / OPTIONS** — remaining input (after path param substitution) is serialized as query parameters
- **All other methods** — remaining input is sent as a JSON body with `content-type: application/json`

### Operations Without HTTP Config

Operations that don't declare an `http` route default to `POST /`.

## Error Handling

Non-OK responses throw a `RemoteError`:

```ts
import { RemoteError } from "@weapon/remote"

try {
  await api.tasks.get({ id: "missing" })
} catch (error) {
  if (error instanceof RemoteError) {
    console.log(error.status)     // 404
    console.log(error.statusText) // "Not Found"
    console.log(error.body)       // response body as string
  }
}
```

### Response Handling

- `204` responses return `undefined`
- `application/json` responses are parsed with `response.json()`
- All other responses are returned as `response.text()`

## Scopes

Nested contracts (scopes) become nested objects on the client:

```ts
const Spec = spec({ http: http() }, {
  users: {
    list: { http: "GET /users", ... },
    settings: {
      get: { http: "GET /users/{id}/settings", ... },
      update: { http: "PUT /users/{id}/settings", ... },
    },
  },
})

const api = remote(Spec, Spec.transports.http, { base: "/api" })

await api.users.list({})
await api.users.settings.get({ id: "123" })
await api.users.settings.update({ id: "123", theme: "dark" })
```

## Types

| Type | Description |
|---|---|
| `Remote<Protocol, ContractDef>` | Typed client — operations as async functions, scopes as nested objects |
| `RemoteConfig<Config>` | Base URL + auth provider + options |
| `RemoteError` | Error with `status`, `statusText`, and `body` |
| `AuthProviderFor<Auth>` | Maps an auth scheme type to its credential provider signature |

## License

MIT
