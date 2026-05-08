# Weapon

Contract-driven APIs for TypeScript.

Define your API once — serve it over HTTP and MCP, consume it with typed clients and React Query hooks.

Weapon is a collection of packages that share a single, declarative **spec**. The spec describes your operations, transports, and middleware. Server packages wire it to protocol engines. Client packages generate typed callers from it. Nothing is duplicated.

## Packages

| Package | Description |
|---|---|
| [`@weapon/spec`](packages/spec) | Core definitions — specs, contracts, operations, executor, transport declarations |
| [`@weapon/gateway`](packages/gateway) | Server-side HTTP host — route matching, auth resolution, request/response lifecycle |
| [`@weapon/connector`](packages/connector) | Server-side MCP host — JSON-RPC (Streamable HTTP) and stdio transports with OAuth |
| [`@weapon/remote`](packages/remote) | Typed HTTP client — mirrors a contract as async functions |
| [`@weapon/query`](packages/query) | TanStack React Query bindings — `useQuery`/`useMutation` hooks from a spec |
| [`@weapon/redact`](packages/redact) | Sensitive field redaction using arktype metadata |

## Core Concepts

### Spec

A **spec** is the single source of truth for your API. It declares:

- **Transports** — how operations are exposed (HTTP routes, MCP tools)
- **Middleware** — cross-cutting concerns (authorization, rate limiting)
- **Contract** — the operations themselves (input/output types, per-transport config)

Specs carry no server-side implementation. They are safe to import on both client and server.

```ts
import { spec, http, mcp, type OperationMiddlewareConfig } from "@weapon/spec"
import { type } from "arktype"

type AuthorizeConfig = { user?: boolean; role?: string }

function authorize(): OperationMiddlewareConfig<void, AuthorizeConfig> {
  return { kind: "middleware" }
}

export const Spec = spec(
  {
    http: http({ authenticate: http.authenticate.cookie<User>("session") }),
    mcp: mcp({ name: "my-api", version: "1.0.0" }),
    authorize: authorize(),
  },
  {
    tasks: {
      list: {
        http: "GET /tasks",
        mcp: { readOnly: true },
        authorize: { user: true },
        description: "List all tasks",
        input: type({}),
        output: type({ id: "string", title: "string", done: "boolean" }).array(),
      },
      create: {
        http: "POST /tasks",
        mcp: true,
        authorize: { user: true },
        input: type({ title: "string" }),
        output: type({ id: "string", title: "string", done: "boolean" }),
      },
      get: {
        http: "GET /tasks/{id}",
        mcp: { readOnly: true },
        authorize: { user: true },
        input: type({ id: "string" }),
        output: type({ id: "string", title: "string", done: "boolean" }),
      },
    },
  },
)
```

### Contract

A **contract** is the set of operations (and nested scopes) created from a spec. Operations declare `input` and `output` as [arktype](https://arktype.io) types, plus per-transport configuration.

Contracts can nest. In the example above, `tasks` is a **scope** containing three operations. Scopes are recursive — you can nest scopes inside scopes.

```ts
Spec.contract.operations       // top-level operations (none in this example)
Spec.contract.scopes           // { tasks: Contract }
Spec.contract.tasks.operations // { list, create, get }
```

### Service

A **service** is the protocol-agnostic implementation of a contract. Each operation maps to a handler function that receives validated input and a dependency injector.

```ts
const TaskService = Spec.contract.tasks.service({
  async list(input, ctx) {
    const tasks = await ctx.db.query("SELECT * FROM tasks")
    return tasks
  },

  async create(input, ctx) {
    const task = { id: crypto.randomUUID(), ...input, done: false }
    await ctx.db.insert("tasks", task)
    return task
  },

  async get(input, ctx) {
    return await ctx.db.queryOne("SELECT * FROM tasks WHERE id = ?", [input.id])
  },
})
```

Services are bound to their contract via `contract.service(impl)`, producing a `BoundService` that the executor can mount.

### Executor

The **executor** is the protocol engine. It takes a spec, middleware implementations, and services, then runs the request lifecycle:

1. **Validate input** (arktype)
2. **Middleware `onRequest`** hooks (declaration order)
3. **Service handler** (with dependency injection)
4. **Middleware `onResponse`** hooks (reverse order)
5. **Return result**

The executor has no opinion about protocols — transports (gateway, connector) sit outside it and translate between their native format and `OperationRequest`/`OperationResponse`.

### Gateway (HTTP)

The **gateway** wires a spec to an HTTP server. It matches incoming requests to operations by method + path, resolves authentication, parses input from the body/query/path params, calls the executor, and serializes the response.

```ts
import { gateway } from "@weapon/gateway"

const api = gateway(
  Spec,
  Spec.transports.http,
  {
    authenticate: async (sessionId) => {
      return await lookupSession(sessionId)
    },
    authorize: {
      onRequest(config, container) {
        if (config.user) {
          const identity = container.resolve("identity")
          if (!identity) throw new Error("Unauthorized")
        }
      },
    },
  },
  [TaskService],
)

// api.fetch is a standard Request → Response handler
Bun.serve({ fetch: api.fetch })
```

### Connector (MCP)

The **connector** wires a spec to an MCP server. Operations with `mcp` config become tools. Supports both Streamable HTTP (JSON-RPC over fetch) and stdio transports.

```ts
import { connector } from "@weapon/connector"

const mcp = connector(
  Spec,
  Spec.transports.mcp,
  {
    authorize: {
      onRequest(config, container) {
        // MCP authorization logic
      },
    },
  },
  [TaskService],
)

// Streamable HTTP
Bun.serve({ fetch: mcp.fetch })

// Or stdio
await mcp.serve()
```

### Remote (HTTP Client)

The **remote** client mirrors a contract as typed async functions. It reads the HTTP route config from each operation to build requests automatically.

```ts
import { remote } from "@weapon/remote"

const api = remote(Spec, Spec.transports.http, {
  base: "https://api.example.com",
  authenticate: () => getSessionToken(),
})

const tasks = await api.tasks.list({})
const task = await api.tasks.create({ title: "Buy milk" })
const found = await api.tasks.get({ id: task.id })
```

### Query (React Query)

The **query** package wraps a remote client with TanStack React Query hooks. GET operations become queries; non-GET operations become mutations.

```ts
import { query } from "@weapon/query"

const Q = query(Spec, api)

// Direct hooks
function TaskList() {
  const { data } = Q.tasks.useList({})
  const create = Q.tasks.useCreate()
  // ...
}

// Options factories (for prefetching, invalidation, etc.)
useQuery(Q.tasks.list.queryOptions({}))
useMutation(Q.tasks.create.mutationOptions())

// Query keys (for cache invalidation)
queryClient.invalidateQueries({ queryKey: Q.tasks.list.queryKey({}) })
queryClient.invalidateQueries({ queryKey: Q.tasks.queryKey() }) // all tasks
```

## Architecture

```
                        Spec (shared)
                   ┌──────────────────┐
                   │  Transports      │
                   │  ├─ http         │
                   │  └─ mcp          │
                   │  Middleware       │
                   │  └─ authorize    │
                   │  Contract        │
                   │  └─ operations   │
                   │     └─ scopes    │
                   └────────┬─────────┘
                            │
            ┌───────────────┼───────────────┐
            │               │               │
       Server-side     Server-side      Client-side
            │               │               │
   ┌────────┴────┐   ┌──────┴──────┐   ┌───┴──────┐
   │   Gateway   │   │  Connector  │   │  Remote  │
   │   (HTTP)    │   │   (MCP)     │   │  (HTTP)  │
   └────────┬────┘   └──────┬──────┘   └───┬──────┘
            │               │               │
            └───────┬───────┘          ┌────┴─────┐
                    │                  │  Query   │
              ┌─────┴──────┐           │  (React) │
              │  Executor  │           └──────────┘
              │            │
              │ Middleware │
              │  Service   │
              │            │
              └────────────┘
```

## Authentication

Weapon separates auth **declaration** (in the spec) from auth **resolution** (in the gateway/connector).

### Declaring Auth Schemes

```ts
// Cookie-based session
http({ authenticate: http.authenticate.cookie<User>("session") })

// Bearer token
http({ authenticate: http.authenticate.bearer<User>() })

// API key via header
http({ authenticate: http.authenticate.header<User>("X-API-Key") })

// HTTP Basic
http({ authenticate: http.authenticate.basic<User>() })

// MCP OAuth 2.1
mcp({ authenticate: mcp.authenticate.oauth<User>() })
```

The generic parameter (`<User>`) is the identity type your resolver returns. It flows through to the gateway/connector config, ensuring the resolver signature matches.

### Resolving Auth

On the server, you provide a resolver that matches the declared scheme:

```ts
// Cookie → resolver receives the cookie value
gateway(Spec, Spec.transports.http, {
  authenticate: (sessionId: string) => lookupUser(sessionId),
  // ...
})

// Bearer → resolver receives the token
gateway(Spec, Spec.transports.http, {
  authenticate: (token: string) => verifyJwt(token),
  // ...
})

// Basic → resolver receives username + password
gateway(Spec, Spec.transports.http, {
  authenticate: (username: string, password: string) => verifyCredentials(username, password),
  // ...
})
```

The resolved identity is bound into the DI container as `identity` and is available to middleware and service handlers.

## Middleware

Middleware is declared in the spec and configured per-operation:

```ts
// Declaration (spec-level)
type RateLimitConfig = { requests: number; window: number }

function rateLimit(): OperationMiddlewareConfig<void, RateLimitConfig> {
  return { kind: "middleware" }
}

const Spec = spec({
  http: http({ ... }),
  rateLimit: rateLimit(),
}, {
  heavyOperation: {
    http: "POST /heavy",
    rateLimit: { requests: 10, window: 60 },  // per-operation config
    input: type({}),
    output: type({}),
  },
})
```

On the server, you provide the middleware implementation:

```ts
gateway(Spec, Spec.transports.http, {
  authenticate: ...,
  rateLimit: {
    onRequest(config, container) {
      // config = { requests: 10, window: 60 }
      // check rate limit, throw to reject
    },
    onResponse(config, container) {
      // runs after handler, in reverse declaration order
    },
  },
}, services)
```

`onRequest` runs before the handler (use for authorization, rate limiting, validation). `onResponse` runs after (use for audit logging, response transforms). Both are optional.

## Scopes

Contracts can nest arbitrarily via scopes:

```ts
const Spec = spec({ http: http() }, {
  users: {
    list: { http: "GET /users", input: type({}), output: type({}).array() },
    get: { http: "GET /users/{id}", input: type({ id: "string" }), output: type({}) },
    settings: {
      get: { http: "GET /users/{id}/settings", input: type({ id: "string" }), output: type({}) },
      update: { http: "PUT /users/{id}/settings", input: type({ id: "string" }), output: type({}) },
    },
  },
})

// Services mirror the structure
const UserService = Spec.contract.users.service({
  list: async (input, ctx) => { ... },
  get: async (input, ctx) => { ... },
  settings: {
    get: async (input, ctx) => { ... },
    update: async (input, ctx) => { ... },
  },
})
```

Scopes are also reflected in clients:

```ts
await api.users.list({})
await api.users.settings.get({ id: "123" })
```

## Tech Stack

- **Runtime:** [Bun](https://bun.sh)
- **Validation:** [arktype](https://arktype.io) 2.x
- **MCP SDK:** [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk)
- **Route matching:** [regexparam](https://github.com/lukeed/regexparam)
- **React Query:** [@tanstack/react-query](https://tanstack.com/query) 5.x

## License

MIT
