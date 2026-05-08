# @weapon/gateway

Server-side HTTP host [weapon](https://github.com/sigitex/weapon).

> 🚧 Experimental

> **Note:** This package currently exports TypeScript sources directly. A TypeScript-compatible runtime or bundler (Bun, etc.) is required.

Takes a spec, resolves authentication, matches routes, runs the executor, and returns HTTP responses. Built on the standard `Request`/`Response` API.

## Installation

```sh
bun add @weapon/gateway
```

## API

### `gateway(spec, transport, config, services)`

Creates an executor and HTTP host in one call. This is the primary entry point for most server setups.

```ts
import { gateway } from "@weapon/gateway"

const api = gateway(
  Spec,
  Spec.transports.http,
  {
    authenticate: async (token) => verifyJwt(token),
    authorize: {
      onRequest(config, container) {
        if (config.user && !container.resolve("identity")) {
          throw new Error("Unauthorized")
        }
      },
    },
  },
  [TaskService, UserService],
)

Bun.serve({ fetch: api.fetch })
```

**Parameters:**

| Name | Type | Description |
|---|---|---|
| `spec` | `Spec<Protocol>` | The spec instance |
| `transport` | `TransportConfig<Config, HttpOperationConfig>` | The HTTP transport from `Spec.transports.http` |
| `config` | `GatewayConfig<Protocol, Config>` | Auth resolver + middleware implementations |
| `services` | `BoundService[]` | Array of bound services |

**Returns:** `{ executor: Executor, fetch: (request: Request) => Promise<Response> }`

The `fetch` function is a standard `Request -> Response` handler compatible with Bun, Cloudflare Workers, Deno, and any framework that accepts the Fetch API signature.

### `httpHost(transport, executor, config)`

Lower-level API. Creates just the HTTP host, given an executor you've already built. Use this when you need direct control over executor creation.

```ts
import { executor } from "@weapon/spec"
import { httpHost } from "@weapon/gateway"

const exec = executor(Spec, { middleware: { authorize: myAuthMiddleware }, services })

const host = httpHost(Spec.transports.http, exec, {
  authenticate: async (token) => verifyJwt(token),
})

Bun.serve({ fetch: host.fetch })
```

**Parameters:**

| Name | Type | Description |
|---|---|---|
| `transport` | `TransportConfig<Config, HttpOperationConfig>` | The HTTP transport (carries auth type info) |
| `executor` | `Executor` | A pre-built executor |
| `config` | `HttpHostConfig<Config>` | Auth resolver and optional base container |

**Returns:** `{ fetch(request: Request, inherited?: Container): Promise<Response> }`

## Config

### `GatewayConfig<Protocol, Config>`

A flat config merging the HTTP host config and all middleware implementations:

```ts
{
  // Required: auth resolver matching the declared scheme
  authenticate: (credentials) => identity | undefined,

  // Optional: base DI container
  container: myContainer,

  // One key per middleware declared in the spec
  authorize: { onRequest(config, container) { ... } },
  rateLimit: { onRequest(config, container) { ... } },
}
```

### `HttpHostConfig<Config>`

| Field | Type | Description |
|---|---|---|
| `authenticate` | `AuthResolverFor<AuthFromConfig<Config>>` | Auth resolver (signature derived from auth scheme) |
| `container` | `Container?` | Optional base DI container (cloned per request) |

## Route Matching

The HTTP host matches requests by method and path. Path parameters use `{param}` syntax in operation definitions and are extracted automatically:

```ts
// Definition
{ http: "GET /users/{id}", input: type({ id: "string" }), ... }

// Request: GET /users/abc
// → input: { id: "abc" }
```

Route matching uses [regexparam](https://github.com/lukeed/regexparam). Operations without `http` config are skipped.

## Request Lifecycle

1. **Match** — find the operation whose method + path matches the request
2. **Container** — clone the base container (or create a new one)
3. **Authenticate** — extract credentials from the request and call the resolver; bind the resolved identity into the container
4. **Parse input** — for `GET`/`HEAD`/`OPTIONS`: query params + path params; for others: JSON body + path params
5. **Execute** — call `executor.handle()` (validates input, runs middleware, calls handler)
6. **Respond** — serialize the output:
   - `Response` instance returned as-is
   - `undefined` returns `204 No Content`
   - Anything else returns `200` with `application/json`
   - No match returns `404`

## Auth Resolution

The resolver signature is derived from the auth scheme declared in the spec:

| Scheme | Resolver signature |
|---|---|
| `http.authenticate.basic<I>()` | `(username: string, password: string) => I \| undefined` |
| `http.authenticate.bearer<I>()` | `(token: string) => I \| undefined` |
| `http.authenticate.cookie<I>(name)` | `(value: string) => I \| undefined` |
| `http.authenticate.header<I>(name)` | `(value: string) => I \| undefined` |
| `http.authenticate.query<I>(name)` | `(value: string) => I \| undefined` |

All resolvers may return a `Promise`. Return `undefined` to indicate auth failure (the identity simply won't be bound).

When multiple auth schemes are declared (as an array), they are tried in order; the first to return a non-`undefined` identity wins.

## Types

| Type | Description |
|---|---|
| `GatewayConfig<Protocol, Config>` | Flat config — auth resolver + middleware implementations |
| `HttpHostConfig<Config>` | Auth resolver + optional container |
| `AuthResolverFor<Auth>` | Maps an auth scheme type to its resolver function signature |
| `AuthFromConfig<Config>` | Extracts auth scheme type(s) from `HttpConfig`, unwrapping arrays |

## License

MIT
