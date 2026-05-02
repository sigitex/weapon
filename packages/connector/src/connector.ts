// oxlint-disable typescript/no-explicit-any
import type { OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js"
import { Container } from "@sigitex/bind"
import {
  type BoundService,
  type ConfigOf,
  type DefinesProtocol,
  type Executor,
  type McpAuthFromConfig,
  type McpAuthResolverFor,
  type McpConfig,
  type McpOperationConfig,
  type MiddlewareKeysOf,
  type OAuthInfo,
  type OperationMiddleware,
  type Spec,
  type TransportConfig,
  executor,
} from "@weapon/spec"
import {
  type OAuthEngineConfig,
  createOAuthFetch,
  createProvider,
  extractBearerToken,
} from "./oauthBridge"
import { ClientStore, CodeStore, TokenStore } from "./stores"
import { type McpMountedTool, mapTools } from "./tools"

/** Config for {@link connector} — merges auth, stores, and middleware implementations. */
export type ConnectorConfig<
  Protocol extends DefinesProtocol,
  Config extends McpConfig = McpConfig,
> = {
  readonly container?: Container
  /** Identity resolver — required when spec declares `mcp.authenticate`. */
  readonly authenticate?: McpAuthResolverFor<McpAuthFromConfig<Config>>
  /** OAuth client store override. Defaults to in-memory. */
  readonly clients?: ClientStore
  /** OAuth authorization code store override. Defaults to in-memory. */
  readonly codes?: CodeStore
  /** OAuth token store override. Defaults to in-memory. */
  readonly tokens?: TokenStore
  /** OAuth engine configuration overrides. */
  readonly oauth?: OAuthEngineConfig
} & {
  [K in MiddlewareKeysOf<Protocol>]: OperationMiddleware<ConfigOf<Protocol[K]>>
}

/**
 * Creates an executor and MCP server in one call.
 * Pass the spec, the MCP transport (for server identity), a config with
 * middleware implementations (and optional auth config), and the services.
 * Returns `{ executor, tools, fetch, serve }`.
 *
 * When the transport declares `mcp.authenticate.oauth()`, the fetch handler
 * serves OAuth endpoints and requires bearer tokens for MCP requests.
 * Stores default to in-memory; override via `clients`, `codes`, `tokens` in config.
 */
export function connector<
  Protocol extends DefinesProtocol,
  const Config extends McpConfig,
>(
  spec: Spec<Protocol, any>,
  transport: TransportConfig<Config, McpOperationConfig>,
  config: ConnectorConfig<Protocol, Config>,
  services: BoundService<Protocol, any>[],
): Connector {
  const middleware = Object.fromEntries(
    Object.keys(spec.middleware).map((k) => [
      k,
      (config as Record<string, unknown>)[k],
    ]),
  ) as {
    [K in MiddlewareKeysOf<Protocol>]: OperationMiddleware<
      ConfigOf<Protocol[K]>
    >
  }

  const exec = executor(spec, { middleware, services })
  const tools = mapTools(exec.operations)
  const serverInfo = {
    name: transport.config?.name ?? "weapon-mcp",
    version: transport.config?.version ?? "0.0.0",
  }

  const hasAuth = !!(transport.config as McpConfig | undefined)?.authenticate
  let provider: OAuthServerProvider | undefined

  let stores:
    | { clients: ClientStore; codes: CodeStore; tokens: TokenStore }
    | undefined

  if (hasAuth) {
    stores = {
      clients: config.clients ?? ClientStore.inMemory(),
      codes: config.codes ?? CodeStore.inMemory(),
      tokens: config.tokens ?? TokenStore.inMemory(),
    }
    provider = createProvider(stores, config.oauth)
  }

  return {
    executor: exec,
    tools,
    fetch: createFetchHandler(
      exec,
      tools,
      serverInfo,
      config,
      provider,
      stores,
    ),
    serve: createServeHandler(exec, tools, serverInfo, config),
  }
}

export type Connector = {
  readonly executor: Executor
  readonly tools: McpMountedTool[]
  readonly fetch: (request: Request) => Promise<Response>
  readonly serve: () => Promise<void>
}

// --- Fetch Handler (Streamable HTTP) ---

type ServerInfo = { name: string; version: string }

function createFetchHandler(
  executor: Executor,
  tools: McpMountedTool[],
  serverInfo: ServerInfo,
  config: ConnectorConfig<any, any>,
  provider?: OAuthServerProvider,
  stores?: { clients: ClientStore; codes: CodeStore; tokens: TokenStore },
): (request: Request) => Promise<Response> {
  const toolsByName = new Map(tools.map((t) => [t.tool.name, t]))
  const authenticate = config.authenticate as
    | ((info: OAuthInfo) => MaybePromise<unknown>)
    | undefined

  // OAuth fetch handler — only created when auth is configured
  const oauthFetch = provider
    ? createOAuthFetch(provider, config.oauth?.issuerUrl ?? "")
    : null

  async function handle(
    request: Request,
    inherited?: Container,
  ): Promise<Response> {
    // Try OAuth routes first (metadata, authorize, token, register, revoke)
    if (oauthFetch) {
      const oauthResponse = await oauthFetch(request)
      if (oauthResponse) return oauthResponse
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 })
    }

    // When auth is configured, verify bearer token and resolve identity
    let authContainer: Container | undefined
    if (provider && authenticate) {
      const token = extractBearerToken(request)
      if (!token) {
        return new Response(
          JSON.stringify({
            error: "invalid_token",
            error_description: "Missing bearer token",
          }),
          {
            status: 401,
            headers: { "content-type": "application/json" },
          },
        )
      }

      let verified: {
        token: string
        clientId: string
        scopes: string[]
        expiresAt?: number
      }
      try {
        verified = await provider.verifyAccessToken(token)
      } catch {
        return Response.json(
          {
            error: "invalid_token",
            error_description: "Invalid or expired token",
          },
          {
            status: 401,
            headers: { "content-type": "application/json" },
          },
        )
      }

      const oauthInfo: OAuthInfo = {
        token: verified.token,
        clientId: verified.clientId,
        scopes: verified.scopes,
        expiresAt: verified.expiresAt,
      }
      const identity = await authenticate(oauthInfo)

      // Build container with identity + stores
      const source = inherited ?? config.container
      authContainer = source ? source.clone() : new Container()
      authContainer.bind({
        identity,
        clients: stores!.clients,
        codes: stores!.codes,
        tokens: stores!.tokens,
      })
    }

    const body = (await request.json()) as JsonRpcRequest
    const containerSource = authContainer ?? inherited ?? config.container
    const response = await handleJsonRpc(
      body,
      executor,
      tools,
      toolsByName,
      serverInfo,
      containerSource,
    )

    if (response === null) {
      // Notification — no response
      return new Response(null, { status: 204 })
    }

    return Response.json(response, {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    })
  }

  const fetch = (request: Request) => handle(request)
  ;(fetch as any).__mount = (request: Request, container: any) =>
    handle(request, container)
  return fetch
}

// --- Stdio Handler ---

function createServeHandler(
  executor: Executor,
  tools: McpMountedTool[],
  serverInfo: ServerInfo,
  config: { container?: Container },
): () => Promise<void> {
  const toolsByName = new Map(tools.map((t) => [t.tool.name, t]))

  return async () => {
    const { Server } = await import("@modelcontextprotocol/sdk/server/index.js")
    const { StdioServerTransport } =
      await import("@modelcontextprotocol/sdk/server/stdio.js")
    const { ListToolsRequestSchema, CallToolRequestSchema } =
      await import("@modelcontextprotocol/sdk/types.js")

    const server = new Server(serverInfo, {
      capabilities: { tools: {} },
    })

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: tools.map((t) => t.tool),
    }))

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params
      const entry = toolsByName.get(name)
      if (!entry) {
        return {
          content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
          isError: true,
        }
      }

      const container = config.container
        ? config.container.clone()
        : new Container()

      const response = await executor.handle(
        { mounted: entry.mounted, input: args ?? {} },
        container,
      )

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(response.output) },
        ],
      }
    })

    const transport = new StdioServerTransport()
    await server.connect(transport)
  }
}

// --- JSON-RPC Protocol (for fetch handler) ---

type JsonRpcRequest = {
  readonly jsonrpc: "2.0"
  readonly id?: string | number
  readonly method: string
  readonly params?: Record<string, unknown>
}

type JsonRpcResponse = {
  readonly jsonrpc: "2.0"
  readonly id: string | number
  readonly result?: unknown
  readonly error?: { code: number; message: string; data?: unknown }
}

const PROTOCOL_VERSION = "2025-03-26"

async function handleJsonRpc(
  request: JsonRpcRequest,
  executor: Executor,
  tools: McpMountedTool[],
  toolsByName: Map<string, McpMountedTool>,
  serverInfo: ServerInfo,
  containerSource: Container | undefined,
): Promise<JsonRpcResponse | null> {
  // Notifications have no id — no response expected
  if (request.id === undefined) return null

  switch (request.method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo,
        },
      }

    case "tools/list":
      return {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          tools: tools.map((t) => t.tool),
        },
      }

    case "tools/call": {
      const params = request.params as
        | { name: string; arguments?: Record<string, unknown> }
        | undefined
      if (!params?.name) {
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32602, message: "Missing tool name" },
        }
      }

      const entry = toolsByName.get(params.name)
      if (!entry) {
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            content: [{ type: "text", text: `Unknown tool: ${params.name}` }],
            isError: true,
          },
        }
      }

      try {
        const container = containerSource
          ? containerSource.clone()
          : new Container()

        const response = await executor.handle(
          { mounted: entry.mounted, input: params.arguments ?? {} },
          container,
        )

        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            content: [{ type: "text", text: JSON.stringify(response.output) }],
          },
        }
      } catch (error) {
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            content: [
              {
                type: "text",
                text: error instanceof Error ? error.message : String(error),
              },
            ],
            isError: true,
          },
        }
      }
    }

    default:
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32601, message: `Method not found: ${request.method}` },
      }
  }
}
