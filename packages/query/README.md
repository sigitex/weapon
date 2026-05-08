# @weapon/query

TanStack React Query bindings [weapon](https://github.com/sigitex/weapon).

> 🚧 Experimental

> **Note:** This package currently exports TypeScript sources directly. A TypeScript-compatible runtime or bundler (Bun, etc.) is required.

Wraps a [`@weapon/remote`](../remote) client with `useQuery` and `useMutation` hooks, options factories, and query key helpers. GET operations automatically become queries; non-GET operations become mutations.

## Installation

```sh
bun add @weapon/query
```

Peer dependency: `@tanstack/react-query` 5.x.

## API

### `query(spec, client, options?)`

Creates a query proxy from an existing remote client.

```ts
import { remote } from "@weapon/remote"
import { query } from "@weapon/query"

const api = remote(Spec, Spec.transports.http, {
  base: "/api",
  authenticate: () => getToken(),
})

const Q = query(Spec, api)
```

### `query(spec, transport, remoteConfig, options?)`

Creates the remote client and query proxy in one call.

```ts
import { query } from "@weapon/query"

const Q = query(Spec, Spec.transports.http, {
  base: "/api",
  authenticate: () => getToken(),
})
```

**Parameters:**

| Name | Type | Description |
|---|---|---|
| `spec` | `Spec<Protocol, ContractDef>` | The spec instance |
| `client` | `Remote<Protocol, ContractDef>` | A remote client (first overload) |
| `transport` | `TransportConfig<Config, HttpOperationConfig>` | HTTP transport (second overload) |
| `config` | `RemoteConfig<Config>` | Remote client config (second overload) |
| `options` | `QueryOptions?` | Optional TanStack QueryClient instance |

**Returns:** `QueryProxy<Protocol, ContractDef>`

### `QueryOptions`

| Field | Type | Description |
|---|---|---|
| `queryClient` | `QueryClient?` | TanStack QueryClient to use (defaults to the context provider) |

## Usage

The query proxy exposes three patterns for each operation:

### Direct Hooks

Hook names are derived from operation keys with a `use` prefix: `list` becomes `useList`, `create` becomes `useCreate`.

```ts
function TaskList() {
  // GET operations → useQuery
  const { data, isLoading } = Q.tasks.useList({})

  // Non-GET operations → useMutation
  const create = Q.tasks.useCreate()

  return (
    <button onClick={() => create.mutate({ title: "New task" })}>
      Add Task
    </button>
  )
}
```

### Options Factories

For use with `useQuery`/`useMutation` directly, or for prefetching and advanced patterns:

```ts
// Query options
const opts = Q.tasks.list.queryOptions({ status: "active" })
// → { queryKey: ["tasks", "list", { status: "active" }], queryFn: () => ... }

useQuery(opts)
await queryClient.prefetchQuery(opts)

// Mutation options
const mutOpts = Q.tasks.create.mutationOptions()
// → { mutationKey: ["tasks", "create"], mutationFn: (input) => ... }

useMutation(mutOpts)
```

### Query Keys

For cache invalidation and matching:

```ts
// Operation-level key (includes input)
Q.tasks.list.queryKey({ status: "active" })
// → ["tasks", "list", { status: "active" }]

// Mutation key (no input)
Q.tasks.create.mutationKey()
// → ["tasks", "create"]

// Scope-level key (matches all operations in scope)
Q.tasks.queryKey()
// → ["tasks"]

// Invalidate all task queries
queryClient.invalidateQueries({ queryKey: Q.tasks.queryKey() })

// Invalidate a specific query
queryClient.invalidateQueries({ queryKey: Q.tasks.list.queryKey({ status: "active" }) })
```

## GET Detection

The query proxy automatically determines whether an operation is a query or mutation based on its HTTP method:

- `GET` and `HEAD` operations use `useQuery`
- All other methods (`POST`, `PUT`, `PATCH`, `DELETE`) use `useMutation`

This affects only the direct hooks (`useList`, `useCreate`, etc.). Options factories (`queryOptions`, `mutationOptions`) are always available for all operations regardless of method.

## Scopes

Nested contracts (scopes) become nested objects on the query proxy, each with their own `queryKey()` for scope-level invalidation:

```ts
const Q = query(Spec, api)

// Nested hook
const { data } = Q.users.settings.useGet({ id: "123" })

// Scope-level invalidation
queryClient.invalidateQueries({ queryKey: Q.users.queryKey() })       // all user queries
queryClient.invalidateQueries({ queryKey: Q.users.settings.queryKey() }) // all settings queries
```

## Types

| Type | Description |
|---|---|
| `QueryProxy<Protocol, ContractDef>` | Typed proxy — hooks, options factories, and query keys |
| `OperationOptions<Input, Output>` | `{ queryOptions, queryKey, mutationOptions, mutationKey }` for one operation |
| `QueryOptions` | `{ queryClient? }` |

## License

MIT
