import type { TransportConfig } from "./spec"

/**
 * Creates a declarative HTTP transport for a spec.
 * The `const` generic preserves the exact auth scheme type through inference,
 * so that `httpGateway()` can derive the correct resolver signature.
 *
 * @example
 * ```ts
 * const Spec = spec({
 *   http: http({ authenticate: http.authenticate.cookie<User>("session") }),
 * })
 * ```
 */
export function http<const Config extends HttpConfig = HttpConfig>(
  config: Config = {} as Config,
): TransportConfig<Config, HttpOperationConfig> {
  return {
    kind: "transport",
    config,
  }
}

/** Spec-level config for the HTTP transport — declares authentication scheme(s). */
export type HttpConfig<Identity = unknown> = {
  readonly authenticate?:
    | HttpAuthentication<Identity>
    | HttpAuthentication<Identity>[]
}

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS"

export type HttpPath = `/${string}` | "/"

export type HttpRoute = { method: HttpMethod; path: HttpPath }

/** Per-operation HTTP config — a route string like `"POST /teams"` or a structured route object. */
export type HttpOperationConfig = `${HttpMethod} ${HttpPath}` | HttpRoute

/** Union of supported HTTP authentication schemes. Generic over the identity type they resolve to. */
export type HttpAuthentication<Identity> =
  | HttpBasicAuthentication<Identity>
  | HttpBearerAuthentication<Identity>
  | HttpApiKeyAuthentication<Identity>

export type HttpBasicAuthentication<_Identity> = {
  readonly type: "basic"
}

export type HttpBearerAuthentication<_Identity> = {
  readonly type: "bearer"
}

export type HttpApiKeyAuthentication<_Identity> = {
  readonly type: "apiKey"
  readonly in: "header" | "query" | "cookie"
  readonly name: string
}


export namespace http {
  /** Declarative auth scheme helpers — specify *what* auth is used, not *how* to resolve it. */
  export const authenticate = {
    /** HTTP Basic authentication (username + password via Authorization header). */
    basic<Identity>(): HttpBasicAuthentication<Identity> {
      return { type: "basic" }
    },
    /** Bearer token authentication (token via Authorization header). */
    bearer<Identity>(): HttpBearerAuthentication<Identity> {
      return { type: "bearer" }
    },
    /** API key via a named HTTP header. */
    header<Identity>(name: string): HttpApiKeyAuthentication<Identity> {
      return { type: "apiKey", in: "header", name }
    },
    /** API key via a named cookie. */
    cookie<Identity>(name: string): HttpApiKeyAuthentication<Identity> {
      return { type: "apiKey", in: "cookie", name }
    },
    /** API key via a named query parameter. */
    query<Identity>(name: string): HttpApiKeyAuthentication<Identity> {
      return { type: "apiKey", in: "query", name }
    },
  } as const
}
