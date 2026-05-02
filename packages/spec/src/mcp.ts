import type { TransportConfig } from "./spec"

/**
 * Creates a declarative MCP transport for a spec.
 *
 * @example
 * ```ts
 * const Spec = spec({
 *   mcp: mcp({ name: "my-server", version: "1.0.0" }),
 * })
 * ```
 *
 * @example With OAuth authentication:
 * ```ts
 * const Spec = spec({
 *   mcp: mcp({
 *     name: "my-server",
 *     version: "1.0.0",
 *     authenticate: mcp.authenticate.oauth(),
 *   }),
 * })
 * ```
 */
export function mcp<const Config extends McpConfig = McpConfig>(
  config: Config = {} as Config,
): TransportConfig<Config, McpOperationConfig> {
  return {
    kind: "transport",
    config,
  }
}

/** Spec-level config for the MCP transport — declares server identity and authentication. */
export type McpConfig<Identity = unknown> = {
  readonly name?: string
  readonly version?: string
  readonly authenticate?: McpAuthentication<Identity>
}

/** Union of supported MCP authentication schemes. Generic over the identity type they resolve to. */
export type McpAuthentication<Identity> = McpOAuthAuthentication<Identity>

/** OAuth 2.1 authentication scheme declaration — carries the identity type as a phantom generic. */
export type McpOAuthAuthentication<_Identity> = {
  readonly type: "oauth"
}

/** OAuth context passed to the identity resolver — weapon's own type, not SDK types. */
export type OAuthInfo = {
  readonly token: string
  readonly clientId: string
  readonly scopes: string[]
  readonly expiresAt?: number
}

/** Extracts the auth scheme type from an McpConfig. */
export type McpAuthFromConfig<Config extends McpConfig> =
  NonNullable<Config["authenticate"]>

/**
 * Derives the identity resolver function signature from an MCP auth scheme type.
 * OAuth → `(info: OAuthInfo) => MaybePromise<Identity>`.
 */
export type McpAuthResolverFor<Auth> =
  Auth extends McpOAuthAuthentication<infer I>
    ? (info: OAuthInfo) => MaybePromise<I>
    : never

export type McpToolHints = {
  readonly name?: string
  readonly readOnly?: boolean
  readonly destructive?: boolean
  readonly idempotent?: boolean
  readonly openWorld?: boolean
}

/** Per-operation MCP config — `true` to expose, a description string, or detailed hints. */
export type McpOperationConfig = true | string | McpToolHints

export namespace mcp {
  /** Declarative auth scheme helpers — specify *what* auth is used, not *how* to resolve it. */
  export const authenticate = {
    /** OAuth 2.1 authentication (bearer token via OAuth flow). */
    oauth<Identity>(): McpOAuthAuthentication<Identity> {
      return { type: "oauth" }
    },
  } as const
}
