import { Container } from "@weapon/bind"
import type {
  Executor,
  HttpApiKeyAuthentication,
  HttpAuthentication,
  HttpBasicAuthentication,
  HttpBearerAuthentication,
  HttpConfig,
  HttpOperationConfig,
  MountedOperation,
  TransportConfig,
} from "@weapon/spec"
import * as RegexParam from "regexparam"

/**
 * Derives the resolver function signature from an auth scheme type.
 * Each scheme dictates what arguments the resolver receives:
 * - basic → `(username, password)`
 * - bearer → `(token)`
 * - apiKey (cookie/header/query) → `(value)`
 */
export type AuthResolverFor<Auth> =
  Auth extends HttpBasicAuthentication<infer I>
    ? (username: string, password: string) => MaybePromise<I | undefined>
    : Auth extends HttpBearerAuthentication<infer I>
      ? (token: string) => MaybePromise<I | undefined>
      : Auth extends HttpApiKeyAuthentication<infer I>
        ? (value: string) => MaybePromise<I | undefined>
        : never

/** Extracts the auth scheme type(s) from an HttpConfig, unwrapping arrays via distributive conditional. */
export type AuthFromConfig<Config extends HttpConfig> =
  NonNullable<Config["authenticate"]> extends infer U
    ? U extends readonly (infer A)[]
      ? A
      : U
    : never

/** Server-side config for the HTTP host — requires an auth resolver matching the spec's declared scheme. */
export type HttpHostConfig<Config extends HttpConfig> = {
  readonly authenticate: AuthResolverFor<AuthFromConfig<Config>>
  readonly container?: Container
}

/**
 * Creates a server-side HTTP host.
 * Takes the HTTP transport from the spec (for type inference), the executor
 * (for its operations list and handle method), and a host config
 * with the auth resolver. Returns `{ fetch }` which handles the full
 * HTTP request lifecycle.
 *
 * @param transport - The HTTP transport from `Spec.transports.http` — carries type info.
 * @param executor - The protocol executor — provides operations and handle.
 * @param config - Server-side config with the `authenticate` resolver.
 */
export function httpHost<Config extends HttpConfig>(
  transport: TransportConfig<Config, HttpOperationConfig>,
  executor: Executor,
  config: HttpHostConfig<Config>,
): { fetch(request: Request, inherited?: Container): Promise<Response> } {
  const routeCache = new WeakMap<MountedOperation, ParsedRoute>()

  function matchOperation(
    request: Request,
    url: URL,
  ): { mounted: MountedOperation; params: Record<string, string> } | undefined {
    for (const mounted of executor.operations) {
      const httpConfig = mounted.definition.http as
        | HttpOperationConfig
        | undefined
      if (!httpConfig) continue

      let route = routeCache.get(mounted)
      if (!route) {
        route = parseRoute(httpConfig)
        routeCache.set(mounted, route)
      }

      if (request.method !== route.method) continue

      const match = route.pattern.exec(url.pathname)
      if (!match) continue

      const params: Record<string, string> = {}
      for (let i = 0; i < route.keys.length; i++) {
        params[route.keys[i]] = match[i + 1]
      }

      return { mounted, params }
    }
    return undefined
  }

  return {
    async fetch(request: Request, inherited?: Container): Promise<Response> {
      const url = new URL(request.url)

      const matched = matchOperation(request, url)
      if (!matched) return new Response("Not Found", { status: 404 })

      const { mounted, params } = matched

      const container = inherited
        ? inherited.clone()
        : config.container
          ? config.container.clone()
          : new Container()

      // Resolve authentication
      const authSchemes = transport.config?.authenticate
        ? Array.isArray(transport.config.authenticate)
          ? transport.config.authenticate
          : [transport.config.authenticate]
        : []

      for (const scheme of authSchemes) {
        const identity = await resolveIdentity(
          request,
          scheme,
          config.authenticate as (...args: any[]) => MaybePromise<unknown>,
        )
        if (identity !== undefined) {
          container.bind({ identity })
          break
        }
      }

      // Parse input from body or query + path params
      let input: unknown
      if (
        request.method !== "GET" &&
        request.method !== "HEAD" &&
        request.method !== "OPTIONS"
      ) {
        const contentType = request.headers.get("content-type") ?? ""
        if (contentType.includes("application/json")) {
          const body = (await request.json()) as Record<string, unknown>
          input = { ...params, ...body }
        } else {
          input = { ...Object.fromEntries(url.searchParams), ...params }
        }
      } else {
        input = { ...Object.fromEntries(url.searchParams), ...params }
      }

      const response = await executor.handle({ mounted, input }, container)

      // Convert output → Response
      const { output } = response
      if (output instanceof Response) return output
      if (output === undefined) return new Response(null, { status: 204 })
      return new Response(JSON.stringify(output), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    },
  }
}

// --- Internal Helpers ---

type ParsedRoute = {
  method: string
  pattern: RegExp
  keys: string[]
}

function parseRoute(config: HttpOperationConfig): ParsedRoute {
  let method: string
  let path: string

  if (typeof config === "string") {
    const spaceIdx = config.indexOf(" ")
    method = config.slice(0, spaceIdx)
    path = config.slice(spaceIdx + 1)
  } else {
    method = config.method
    path = config.path
  }

  // Convert {param} to :param for regexparam
  path = path.replace(/\{(\w+)\}/g, ":$1")

  const { pattern, keys } = RegexParam.parse(path)
  return { method, pattern, keys }
}

function resolveIdentity(
  request: Request,
  scheme: HttpAuthentication<unknown>,
  authenticate: (...args: any[]) => MaybePromise<unknown>,
): MaybePromise<unknown> {
  switch (scheme.type) {
    case "basic": {
      const header = request.headers.get("authorization")
      if (!header?.startsWith("Basic ")) return undefined
      const decoded = atob(header.slice(6))
      const colon = decoded.indexOf(":")
      if (colon === -1) return undefined
      return authenticate(decoded.slice(0, colon), decoded.slice(colon + 1))
    }
    case "bearer": {
      const header = request.headers.get("authorization")
      if (!header?.startsWith("Bearer ")) return undefined
      return authenticate(header.slice(7))
    }
    case "apiKey": {
      const value = extractApiKey(request, scheme)
      if (value === undefined) return undefined
      return authenticate(value)
    }
  }
}

function extractApiKey(
  request: Request,
  scheme: HttpApiKeyAuthentication<unknown>,
): string | undefined {
  switch (scheme.in) {
    case "header":
      return request.headers.get(scheme.name) ?? undefined
    case "query": {
      const url = new URL(request.url)
      return url.searchParams.get(scheme.name) ?? undefined
    }
    case "cookie": {
      const cookies = request.headers.get("cookie")
      if (!cookies) return undefined
      const match = cookies.match(
        new RegExp(`(?:^|;\\s*)${scheme.name}=([^;]*)`),
      )
      return match?.[1]
    }
  }
}
