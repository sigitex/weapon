# Weapon

Contract-driven APIs for TypeScript, powered by [ArkType](https://arktype.io).

Define your API contract with runtime-validated types, serve it over multiple transports (HTTP, MCP, and CLI), and consume it with fully typed clients.

## Define a Contract

A contract is a set of operations with validated inputs and outputs. Use `spec()` to declare your contract along with the transports and middleware it supports:

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

Every `input` and `output` is an [ArkType](https://arktype.io) type. ArkType gives you concise type syntax with full runtime validation -- your contract types are enforced at the boundary, not just at compile time.

## Implement It

A **service** is the protocol-agnostic implementation of a contract. Each operation maps to a handler function that receives validated input and a dependency injector.

```ts
const TaskService = Spec.contract.tasks.service({
  async list(_, { db }: { db: Database }) {
    const tasks = await db.query("SELECT * FROM tasks")
    return tasks
  },

  async create({ title }, { db }) {
    const task = { id: crypto.randomUUID(), title, done: false }
    await db.insert("tasks", task)
    return task
  },

  async get({ id }, { db }) {
    return await db.queryOne("SELECT * FROM tasks WHERE id = ?", [id])
  },
})
```

Services are bound to their contract via `contract.service(impl)`, producing a `BoundService` that can be mounted on any transport.

## Serve It

### Gateway (HTTP)

The **gateway** wires your contract to an HTTP server. It matches incoming requests to operations by method + path, resolves authentication, parses input from the body/query/path params, and serializes the response.

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

// api.fetch is a standard Request -> Response handler
Bun.serve({ fetch: api.fetch })
```

### Connector (MCP)

The **connector** wires your contract to an MCP server. Operations with `mcp` config become tools. Supports both Streamable HTTP (JSON-RPC over fetch) and stdio transports.

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

### CLI

The **CLI adapter** can expose contract operations as commands, or define small CLIs with the high-level `command()` API.

```ts
import { command } from "@weapon/cli"
import { type } from "arktype"

const app = command({
  name: "tasks",
  description: "Task manager",
  options: type({
    profile: command.string({ short: "p", description: "Config profile" }),
  }),
  list: {
    description: "List tasks",
    input: type({
      project: command.string({ arg: true, description: "Project id" }),
      limit: command.integer({ short: "l", label: "Limit" }),
      done: command.boolean({ short: "d" }),
    }),
    run(input) {
      return input
    },
  },
})

await app.main()
```

`command()` returns the normalized `spec`, `services`, `executor`, `commands`, `run`, `main`, and `help`, so lower-level adapters can still compose with the same Weapon model.
Top-level `options` are global options available to handlers as `context.cli.options`; top-level `run` defines a root command.

## Call It

### Remote (HTTP Client)

The **remote** client mirrors your contract as typed async functions. It reads the HTTP route config from each operation to build requests automatically.

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

There is also an [experimental `query` package](https://github.com/sigitex/weapon/tree/main/packages/query) integrating with [TanStack Query](https://tanstack.com/query/latest).

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

## Authentication

Weapon separates auth **declaration** (in the contract) from auth **resolution** (in the gateway/connector).

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
// Cookie -> resolver receives the cookie value
gateway(Spec, Spec.transports.http, {
  authenticate: (sessionId: string) => lookupUser(sessionId),
  // ...
})

// Bearer -> resolver receives the token
gateway(Spec, Spec.transports.http, {
  authenticate: (token: string) => verifyJwt(token),
  // ...
})

// Basic -> resolver receives username + password
gateway(Spec, Spec.transports.http, {
  authenticate: (username: string, password: string) => verifyCredentials(username, password),
  // ...
})
```

The resolved identity is bound into the DI container as `identity` and is available to middleware and service handlers.

## Middleware

Middleware is declared in the contract and configured per-operation:

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

## Tech Stack

- **Runtime:** [Bun](https://bun.sh)
- **Validation:** [arktype](https://arktype.io) 2.x
- **MCP SDK:** [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk)
- **Route matching:** [regexparam](https://github.com/lukeed/regexparam)

## License

MIT
