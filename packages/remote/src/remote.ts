/** biome-ignore-all lint/suspicious/noExplicitAny: intent */
import type {
  Contract,
  DefinesContract,
  DefinesOperation,
  DefinesProtocol,
  HttpApiKeyAuthentication,
  HttpBasicAuthentication,
  HttpBearerAuthentication,
  HttpConfig,
  HttpOperationConfig,
  Spec,
  TransportConfig,
} from "@weapon/spec"

/**
 * Creates a typed client that mirrors a spec's contract as async functions.
 *
 * @example
 * ```ts
 * const api = remote(Spec, Spec.transports.http, {
 *   base: "https://api.example.com",
 *   authenticate: () => getToken(),
 * })
 * await api.teams.create({ name: "foo" })
 * await api.teams.update({ id: "abc", name: "bar" })
 * ```
 */
export function remote<
  Protocol extends DefinesProtocol,
  ContractDef extends DefinesContract<Protocol>,
  const Config extends HttpConfig,
>(
  spec: Spec<Protocol, ContractDef>,
  transport: TransportConfig<Config, HttpOperationConfig>,
  config: RemoteConfig<Config>,
): Remote<Protocol, ContractDef> {
  const authSchemes = transport.config?.authenticate
    ? Array.isArray(transport.config.authenticate)
      ? transport.config.authenticate
      : [transport.config.authenticate]
    : []

  return createProxy(spec.contract, authSchemes, config)
}

// --- Auth Provider Types ---

/**
 * Derives the credential provider signature from an auth scheme type.
 * Mirrors {@link AuthResolverFor} on the server, but inverted:
 * instead of `(credentials) → identity`, it's `() → credentials`.
 */
export type AuthProviderFor<Auth> =
  Auth extends HttpBasicAuthentication<any>
    ? () => MaybePromise<{ username: string; password: string }>
    : Auth extends HttpBearerAuthentication<any>
      ? () => MaybePromise<string>
      : Auth extends HttpApiKeyAuthentication<any>
        ? () => MaybePromise<string>
        : never

/** Extracts the auth scheme type(s) from an HttpConfig, unwrapping arrays. */
type AuthFromConfig<Config extends HttpConfig> =
  NonNullable<Config["authenticate"]> extends infer U
    ? U extends readonly (infer A)[]
      ? A
      : U
    : never

// --- Config ---

/** Configuration for a remote client. */
export type RemoteConfig<Config extends HttpConfig = HttpConfig> = {
  /** Base URL of the gateway (e.g. `"https://api.example.com"`). */
  readonly base: string
  /** Optional headers to include on every request. */
  readonly headers?: Record<string, string> | (() => Record<string, string>)
  /** Optional custom fetch implementation. */
  readonly fetch?: typeof fetch
} & AuthenticateConfig<Config>

/** Conditionally requires `authenticate` if the transport declares an auth scheme. */
type AuthenticateConfig<Config extends HttpConfig> =
  AuthFromConfig<Config> extends never
    ? {}
    : { readonly authenticate: AuthProviderFor<AuthFromConfig<Config>> }

// --- Client Type ---

/**
 * A typed client — maps each operation to an async function,
 * and each scope to a nested client object.
 */
export type Remote<
  Protocol extends DefinesProtocol,
  ContractDef extends DefinesContract<Protocol>,
> = {
  [K in keyof ContractDef]: ContractDef[K] extends DefinesOperation<Protocol>
    ? (input: ContractDef[K]["input"]["infer"]) => Promise<ContractDef[K]["output"]["infer"]>
    : ContractDef[K] extends DefinesContract<Protocol>
      ? Remote<Protocol, ContractDef[K]>
      : never
}

/** Error thrown when the remote gateway returns a non-OK response. */
export class RemoteError extends Error {
  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly body: string,
  ) {
    super(`${status} ${statusText}`)
    this.name = "RemoteError"
  }
}

// --- Internals ---

type AuthScheme = { type: string; in?: string; name?: string }

function createProxy<
  Protocol extends DefinesProtocol,
  ContractDef extends DefinesContract<Protocol>,
>(
  contract: Contract<Protocol, ContractDef>,
  authSchemes: AuthScheme[],
  config: RemoteConfig<any>,
): Remote<Protocol, ContractDef> {
  const proxy: Record<string, unknown> = {}

  for (const [key, definition] of Object.entries(contract.operations)) {
    const def = definition as DefinesOperation<DefinesProtocol>
    const route = parseHttpRoute(def.http as HttpOperationConfig | undefined)
    proxy[key] = (input: unknown) => call(route, input, authSchemes, config)
  }

  for (const [key, scope] of Object.entries(contract.scopes)) {
    proxy[key] = createProxy(scope as Contract<any, any>, authSchemes, config)
  }

  return proxy as Remote<Protocol, ContractDef>
}

type ResolvedRoute = { method: string; path: string }

function parseHttpRoute(config: HttpOperationConfig | undefined): ResolvedRoute {
  if (!config) return { method: "POST", path: "/" }
  if (typeof config === "string") {
    const spaceIdx = config.indexOf(" ")
    return { method: config.slice(0, spaceIdx), path: config.slice(spaceIdx + 1) }
  }
  return { method: config.method, path: config.path }
}

async function call(
  route: ResolvedRoute,
  input: unknown,
  authSchemes: AuthScheme[],
  config: RemoteConfig<any>,
): Promise<unknown> {
  const fetchFn = config.fetch ?? fetch

  const { method, url } = buildRequest(route, input, config.base)

  const headers: Record<string, string> = {
    ...(typeof config.headers === "function" ? config.headers() : config.headers),
  }

  // Apply auth credentials
  const authenticate = (config as { authenticate?: () => MaybePromise<unknown> }).authenticate
  if (authenticate && authSchemes.length > 0) {
    const credentials = await authenticate()
    applyCredentials(headers, authSchemes[0], credentials)
  }

  const hasBody = method !== "GET" && method !== "HEAD" && method !== "OPTIONS"
  if (hasBody && input !== undefined) {
    headers["content-type"] = "application/json"
  }

  const response = await fetchFn(url, {
    method,
    headers,
    body: hasBody && input !== undefined ? JSON.stringify(input) : undefined,
  })

  if (!response.ok) {
    throw new RemoteError(response.status, response.statusText, await response.text())
  }

  if (response.status === 204) return undefined

  const contentType = response.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    return response.json()
  }
  return response.text()
}

function applyCredentials(
  headers: Record<string, string>,
  scheme: AuthScheme,
  credentials: unknown,
) {
  switch (scheme.type) {
    case "basic": {
      const { username, password } = credentials as { username: string; password: string }
      headers.authorization = `Basic ${btoa(`${username}:${password}`)}`
      break
    }
    case "bearer": {
      headers.authorization = `Bearer ${credentials as string}`
      break
    }
    case "apiKey": {
      const value = credentials as string
      switch (scheme.in) {
        case "header":
          headers[scheme.name!] = value
          break
        case "cookie":
          headers.cookie = `${scheme.name}=${value}`
          break
        case "query":
          // Query params handled elsewhere if needed
          break
      }
      break
    }
  }
}

function buildRequest(
  route: ResolvedRoute,
  input: unknown,
  base: string,
): { method: string; url: string } {
  let path = route.path
  let remaining = input && typeof input === "object" ? { ...input as Record<string, unknown> } : {}

  // Substitute path params: /teams/{id} → /teams/abc
  path = path.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = remaining[key]
    delete remaining[key]
    return encodeURIComponent(String(value ?? ""))
  })

  const method = route.method
  let url = `${base.replace(/\/$/, "")}${path}`

  // For GET/HEAD/OPTIONS, remaining params go to query string
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    const entries = Object.entries(remaining).filter(([, v]) => v !== undefined)
    if (entries.length > 0) {
      const params = new URLSearchParams(
        entries.map(([k, v]): [string, string] => [k, String(v)]),
      )
      url += `?${params}`
    }
    remaining = {}
  }

  return { method, url }
}
