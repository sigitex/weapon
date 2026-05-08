# @weapon/connector

Server-side MCP (Model Context Protocol) host for [weapon](https://github.com/sigitex/weapon).

> 🚧 Experimental

> **Note:** This package currently exports TypeScript sources directly. A TypeScript-compatible runtime or bundler (Bun, etc.) is required.

Exposes spec operations as MCP tools over Streamable HTTP (JSON-RPC) or stdio. Includes a built-in OAuth 2.1 server with pluggable token stores.

## Installation

```sh
bun add @weapon/connector
```

## API

### `connector(spec, transport, config, services)`

Creates an executor and MCP server in one call.

```ts
import { connector } from "@weapon/connector"

const mcp = connector(
  Spec,
  Spec.transports.mcp,
  {
    authorize: {
      onRequest(config, container) {
        // authorization logic
      },
    },
  },
  [TaskService],
)

// Streamable HTTP (JSON-RPC over fetch)
Bun.serve({ fetch: mcp.fetch })

// Or stdio (for CLI-based MCP clients)
await mcp.serve()
```

**Parameters:**

| Name | Type | Description |
|---|---|---|
| `spec` | `Spec<Protocol>` | The spec instance |
| `transport` | `TransportConfig<Config, McpOperationConfig>` | The MCP transport from `Spec.transports.mcp` |
| `config` | `ConnectorConfig<Protocol, Config>` | Middleware implementations + optional auth/store config |
| `services` | `BoundService[]` | Array of bound services |

**Returns:** `Connector`

| Field | Type | Description |
|---|---|---|
| `executor` | `Executor` | The underlying executor |
| `tools` | `McpMountedTool[]` | MCP tool definitions mapped from operations |
| `fetch` | `(request: Request) => Promise<Response>` | Streamable HTTP handler (JSON-RPC) |
| `serve` | `() => Promise<void>` | Stdio transport handler |

## Config

### `ConnectorConfig<Protocol, Config>`

```ts
{
  // Optional: base DI container
  container: myContainer,

  // Required when spec declares mcp.authenticate.oauth()
  authenticate: (info: OAuthInfo) => identity,

  // Optional: override default in-memory stores
  clients: myClientStore,
  codes: myCodeStore,
  tokens: myTokenStore,

  // Optional: OAuth engine config
  oauth: { accessTokenTTL: 7200, scopes: ["read", "write"], issuerUrl: "https://auth.example.com" },

  // One key per middleware declared in the spec
  authorize: { onRequest(config, container) { ... } },
}
```

| Field | Type | Description |
|---|---|---|
| `container` | `Container?` | Base DI container (cloned per request) |
| `authenticate` | `McpAuthResolverFor<...>?` | Identity resolver (required when OAuth is declared) |
| `clients` | `ClientStore?` | OAuth client store (default: in-memory) |
| `codes` | `CodeStore?` | Authorization code store (default: in-memory) |
| `tokens` | `TokenStore?` | Access/refresh token store (default: in-memory) |
| `oauth` | `OAuthEngineConfig?` | OAuth engine overrides |

### `OAuthEngineConfig`

| Field | Type | Default | Description |
|---|---|---|---|
| `accessTokenTTL` | `number` | `3600` | Token lifetime in seconds |
| `scopes` | `string[]` | — | Supported OAuth scopes |
| `issuerUrl` | `string` | — | Issuer URL for metadata discovery |

## Tool Mapping

Operations with `mcp` config are automatically mapped to MCP tools:

```ts
// In the spec
{
  listTasks: {
    mcp: { readOnly: true },
    description: "List all tasks",
    input: type({ status: "'active' | 'done'" }),
    output: type({ id: "string", title: "string" }).array(),
  },
}
```

Produces an MCP tool with:
- **name** — the operation key (`listTasks`), or `hints.name` if provided
- **description** — from `mcp` config (if string) or `definition.description`
- **inputSchema** — generated from the arktype `input` type via `toJsonSchema()`
- **annotations** — mapped from `McpToolHints` (`readOnly` -> `readOnlyHint`, etc.)

Operations without `mcp` config are not exposed as tools.

## Transports

### Streamable HTTP (fetch)

The `fetch` handler implements the MCP Streamable HTTP transport using JSON-RPC 2.0:

- `POST /` — JSON-RPC requests (`initialize`, `tools/list`, `tools/call`)
- Notifications (no `id`) return `204 No Content`

When OAuth is configured, the handler also serves OAuth endpoints:
- `/.well-known/oauth-authorization-server` — metadata discovery
- `/.well-known/oauth-protected-resource` — protected resource metadata
- `/authorize` — authorization endpoint
- `/token` — token endpoint
- `/register` — dynamic client registration
- `/revoke` — token revocation

### Stdio (serve)

The `serve` handler uses the MCP SDK's `StdioServerTransport` for CLI-based clients. It registers `tools/list` and `tools/call` handlers on the SDK `Server` and connects via stdin/stdout.

## OAuth

When the spec declares `mcp.authenticate.oauth()`, the connector sets up a full OAuth 2.1 server:

```ts
const Spec = spec({
  mcp: mcp({
    name: "my-server",
    version: "1.0.0",
    authenticate: mcp.authenticate.oauth<User>(),
  }),
}, { ... })

const mcp = connector(Spec, Spec.transports.mcp, {
  authenticate: async (info) => {
    // info: { token, clientId, scopes, expiresAt? }
    return await lookupUser(info.token)
  },
  // ...
}, services)
```

The OAuth flow supports:
- Dynamic client registration
- Authorization code grant with PKCE
- Token refresh with rotation
- Token revocation

### Token Stores

Stores default to in-memory. For production, use a persistent backend:

#### Cloudflare KV

```ts
import { cloudflare } from "@weapon/connector/cloudflare"

connector(Spec, Spec.transports.mcp, {
  // Single KV namespace (key-prefixed)
  ...cloudflare(env.OAUTH_KV),

  // Or separate namespaces
  ...cloudflare({ clients: env.CLIENTS, codes: env.CODES, tokens: env.TOKENS }),
}, services)
```

#### Generic KV (unstorage / keyv)

```ts
import { kv } from "@weapon/connector/kv"

// unstorage
connector(Spec, Spec.transports.mcp, {
  ...kv(storage),
}, services)

// keyv
connector(Spec, Spec.transports.mcp, {
  ...kv(keyvInstance),
}, services)
```

### Store Interfaces

All stores are simple async interfaces. Implement them directly for custom backends:

**`ClientStore`** — registered OAuth clients

```ts
type ClientStore = {
  get(clientId: string): MaybePromise<OAuthClient | null>
  register(client: OAuthClient): MaybePromise<void>
}
```

**`CodeStore`** — short-lived authorization codes

```ts
type CodeStore = {
  save(code: AuthorizationCode): MaybePromise<void>
  consume(code: string): MaybePromise<AuthorizationCode | null>
}
```

**`TokenStore`** — access + refresh tokens

```ts
type TokenStore = {
  save(token: OAuthToken): MaybePromise<void>
  getByAccessToken(token: string): MaybePromise<OAuthToken | null>
  getByRefreshToken(token: string): MaybePromise<OAuthToken | null>
  revoke(token: string): MaybePromise<void>
}
```

## Types

| Type | Description |
|---|---|
| `Connector` | `{ executor, tools, fetch, serve }` |
| `ConnectorConfig<Protocol, Config>` | Auth + stores + middleware implementations |
| `OAuthEngineConfig` | Token TTL, scopes, issuer URL |
| `McpMountedTool` | `{ mounted: MountedOperation, tool: McpTool }` |
| `McpTool` | `{ name, description?, inputSchema, annotations? }` |
| `ClientStore` | OAuth client store interface |
| `CodeStore` | Authorization code store interface |
| `TokenStore` | Access/refresh token store interface |
| `OAuthClient` | `{ clientId, clientSecret?, redirectUris, name?, registeredAt, secretExpiresAt? }` |
| `AuthorizationCode` | `{ code, clientId, redirectUri, codeChallenge, codeChallengeMethod, expiresAt, scopes }` |
| `OAuthToken` | `{ accessToken, refreshToken?, clientId, scopes, expiresAt }` |

## License

MIT
