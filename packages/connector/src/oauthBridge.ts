// oxlint-disable typescript/no-explicit-any
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js"
import type { OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js"
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js"
import type { ClientStore, CodeStore, TokenStore } from "./stores"

// --- OAuth Engine Config ---

/** Optional overrides for the OAuth engine defaults. */
export type OAuthEngineConfig = {
  /** Access token lifetime in seconds. Default: 3600 (1 hour). */
  readonly accessTokenTTL?: number
  /** Supported scopes. If set, advertised in metadata. */
  readonly scopes?: string[]
  /** Issuer URL for metadata discovery. */
  readonly issuerUrl?: string
}

// --- OAuth Provider (bridges weapon stores → SDK interface) ---

/** Creates an OAuthServerProvider backed by weapon's stores. */
export function createProvider(
  stores: { clients: ClientStore; codes: CodeStore; tokens: TokenStore },
  config: OAuthEngineConfig = {},
): OAuthServerProvider {
  const accessTokenTTL = (config.accessTokenTTL ?? 3600) * 1000

  const clientsStore: OAuthRegisteredClientsStore = {
    async getClient(clientId) {
      const client = await stores.clients.get(clientId)
      if (!client) {
        return undefined
      }
      return toSdkClient(client)
    },
    async registerClient(metadata) {
      const clientId = crypto.randomUUID()
      const clientSecret = generateSecret()
      const now = Date.now()

      const weaponClient = {
        clientId,
        clientSecret,
        redirectUris: (metadata.redirect_uris ?? []).map((u: any) =>
          u.toString(),
        ),
        name: metadata.client_name,
        registeredAt: now,
      }
      await stores.clients.register(weaponClient)

      return {
        ...metadata,
        client_id: clientId,
        client_secret: clientSecret,
        client_id_issued_at: Math.floor(now / 1000),
        client_secret_expires_at: 0,
      } as unknown as OAuthClientInformationFull
    },
  }

  return {
    get clientsStore() {
      return clientsStore
    },

    async authorize(client, params, res) {
      const code = crypto.randomUUID()
      await stores.codes.save({
        code,
        clientId: client.client_id,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        codeChallengeMethod: "S256",
        expiresAt: Date.now() + 10 * 60 * 1000,
        scopes: params.scopes ?? [],
      })

      const url = new URL(params.redirectUri)
      url.searchParams.set("code", code)
      if (params.state) url.searchParams.set("state", params.state)
      res.redirect(url.toString())
    },

    async challengeForAuthorizationCode(_client, authorizationCode) {
      // The SDK calls this to get the stored challenge for PKCE validation
      // We peek at the code without consuming it
      const entry = await stores.codes.consume(authorizationCode)
      if (!entry) throw new Error("Invalid authorization code")
      // Re-save it since consume deletes it — the SDK will call exchangeAuthorizationCode next
      await stores.codes.save(entry)
      return entry.codeChallenge
    },

    async exchangeAuthorizationCode(
      client,
      authorizationCode,
      _codeVerifier,
      _redirectUri,
    ) {
      const entry = await stores.codes.consume(authorizationCode)
      if (!entry) throw new Error("Invalid authorization code")

      const accessToken = crypto.randomUUID()
      const refreshToken = crypto.randomUUID()
      const expiresAt = Date.now() + accessTokenTTL

      await stores.tokens.save({
        accessToken,
        refreshToken,
        clientId: client.client_id,
        scopes: entry.scopes,
        expiresAt,
      })

      return {
        access_token: accessToken,
        token_type: "bearer",
        expires_in: Math.floor(accessTokenTTL / 1000),
        refresh_token: refreshToken,
        scope: entry.scopes.join(" "),
      }
    },

    async exchangeRefreshToken(client, refreshToken, scopes) {
      const existing = await stores.tokens.getByRefreshToken(refreshToken)
      if (!existing) throw new Error("Invalid refresh token")
      if (existing.clientId !== client.client_id)
        throw new Error("Client mismatch")

      // Revoke old tokens (rotation)
      await stores.tokens.revoke(existing.accessToken)

      const effectiveScopes = scopes?.length ? scopes : existing.scopes
      const accessToken = crypto.randomUUID()
      const newRefreshToken = crypto.randomUUID()
      const expiresAt = Date.now() + accessTokenTTL

      await stores.tokens.save({
        accessToken,
        refreshToken: newRefreshToken,
        clientId: client.client_id,
        scopes: effectiveScopes,
        expiresAt,
      })

      return {
        access_token: accessToken,
        token_type: "bearer",
        expires_in: Math.floor(accessTokenTTL / 1000),
        refresh_token: newRefreshToken,
        scope: effectiveScopes.join(" "),
      }
    },

    async verifyAccessToken(token) {
      const stored = await stores.tokens.getByAccessToken(token)
      if (!stored) throw new Error("Invalid token")

      return {
        token: stored.accessToken,
        clientId: stored.clientId,
        scopes: stored.scopes,
        expiresAt: stored.expiresAt,
      }
    },

    async revokeToken(_client, request) {
      await stores.tokens.revoke(request.token)
    },
  }
}

// --- OAuth Fetch (proxies to internal Express server running mcpAuthRouter) ---

/** Known OAuth endpoint paths served by the SDK's mcpAuthRouter. */
const OAUTH_PATHS = new Set([
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-protected-resource",
  "/authorize",
  "/token",
  "/register",
  "/revoke",
])

/**
 * Creates a Fetch-compatible handler for OAuth endpoints using the SDK's mcpAuthRouter.
 * Spins up an internal Express server on a random port and proxies matching requests to it.
 * Returns `Response | null` — null means the request is not an OAuth route.
 */
export function createOAuthFetch(
  provider: OAuthServerProvider,
  issuerUrl: string,
): (request: Request) => Promise<Response | null> {
  let baseUrl: string | null = null
  let startPromise: Promise<void> | null = null

  async function ensureServer() {
    if (baseUrl) return
    if (startPromise) {
      await startPromise
      return
    }
    startPromise = (async () => {
      const express = (await import("express")).default
      const { mcpAuthRouter } =
        await import("@modelcontextprotocol/sdk/server/auth/router.js")
      const app = express()
      const resolvedIssuer = issuerUrl || "http://localhost"
      app.use(
        mcpAuthRouter({
          provider,
          issuerUrl: new URL(resolvedIssuer),
        }),
      )
      const server = app.listen(0)
      const addr = server.address() as { port: number }
      baseUrl = `http://127.0.0.1:${addr.port}`
    })()
    await startPromise
  }

  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url)
    if (!OAUTH_PATHS.has(url.pathname)) return null

    await ensureServer()

    // Proxy the request to the internal Express server
    const proxyUrl = `${baseUrl}${url.pathname}${url.search}`
    const proxyResponse = await fetch(proxyUrl, {
      method: request.method,
      headers: request.headers,
      body:
        request.method !== "GET" && request.method !== "HEAD"
          ? request.body
          : undefined,
      redirect: "manual",
    })

    // Convert the proxy response back (strip hop-by-hop headers)
    const headers = new Headers()
    proxyResponse.headers.forEach((value, key) => {
      if (key !== "transfer-encoding" && key !== "connection") {
        headers.set(key, value)
      }
    })

    return new Response(proxyResponse.body, {
      status: proxyResponse.status,
      statusText: proxyResponse.statusText,
      headers,
    })
  }
}

/**
 * Extracts a bearer token from a request's Authorization header.
 * Returns null if no bearer token is present.
 */
export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization")
  if (!header?.startsWith("Bearer ")) return null
  return header.slice(7)
}

// --- Helpers ---

function toSdkClient(client: {
  clientId: string
  clientSecret?: string
  redirectUris: string[]
  name?: string
  registeredAt: number
  secretExpiresAt?: number
}): OAuthClientInformationFull {
  return {
    client_id: client.clientId,
    client_secret: client.clientSecret,
    redirect_uris: client.redirectUris,
    client_name: client.name,
    client_id_issued_at: Math.floor(client.registeredAt / 1000),
    client_secret_expires_at: client.secretExpiresAt
      ? Math.floor(client.secretExpiresAt / 1000)
      : 0,
  } as unknown as OAuthClientInformationFull
}

function generateSecret(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}
