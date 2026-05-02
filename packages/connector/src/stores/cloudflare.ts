/** biome-ignore-all lint/suspicious/noExplicitAny: intent */
import type { ClientStore, CodeStore, TokenStore, OAuthClient, AuthorizationCode, OAuthToken } from "../stores"

/**
 * KVNamespace shape from Cloudflare Workers.
 * Using a structural type to avoid hard dependency on @cloudflare/workers-types at runtime.
 */
type KVNamespace = {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
}

type CloudflareStoreConfig = {
  readonly clients: KVNamespace
  readonly codes: KVNamespace
  readonly tokens: KVNamespace
}

/**
 * Creates all three OAuth stores backed by Cloudflare KV.
 *
 * @example Single namespace (key-prefixed):
 * ```ts
 * ...cloudflare(env.OAUTH_KV)
 * ```
 *
 * @example Separate namespaces:
 * ```ts
 * ...cloudflare({ clients: env.CLIENTS, codes: env.CODES, tokens: env.TOKENS })
 * ```
 */
export function cloudflare(kvOrConfig: KVNamespace | CloudflareStoreConfig): {
  clients: ClientStore
  codes: CodeStore
  tokens: TokenStore
} {
  // Discriminate: KVNamespace has `get`, config object has `clients`
  if ("get" in kvOrConfig) {
    return {
      clients: cloudflare.clients(kvOrConfig, "clients:"),
      codes: cloudflare.codes(kvOrConfig, "codes:"),
      tokens: cloudflare.tokens(kvOrConfig, "tokens:"),
    }
  }
  return {
    clients: cloudflare.clients(kvOrConfig.clients),
    codes: cloudflare.codes(kvOrConfig.codes),
    tokens: cloudflare.tokens(kvOrConfig.tokens),
  }
}

export namespace cloudflare {
  /** Creates a KV-backed ClientStore. */
  export function clients(kv: KVNamespace, prefix = ""): ClientStore {
    return {
      async get(clientId) {
        const raw = await kv.get(`${prefix}${clientId}`)
        if (!raw) return null
        const client = JSON.parse(raw) as OAuthClient
        if (client.secretExpiresAt && client.secretExpiresAt < Date.now()) {
          await kv.delete(`${prefix}${clientId}`)
          return null
        }
        return client
      },
      async register(client) {
        await kv.put(`${prefix}${client.clientId}`, JSON.stringify(client))
      },
    }
  }

  /** Creates a KV-backed CodeStore. TTL-based expiration. */
  export function codes(kv: KVNamespace, prefix = ""): CodeStore {
    return {
      async save(code) {
        const ttl = Math.max(1, Math.ceil((code.expiresAt - Date.now()) / 1000))
        await kv.put(`${prefix}${code.code}`, JSON.stringify(code), { expirationTtl: ttl })
      },
      async consume(code) {
        const raw = await kv.get(`${prefix}${code}`)
        if (!raw) return null
        await kv.delete(`${prefix}${code}`)
        const entry = JSON.parse(raw) as AuthorizationCode
        if (entry.expiresAt < Date.now()) return null
        return entry
      },
    }
  }

  /** Creates a KV-backed TokenStore. Dual-key entries for access + refresh token lookup. */
  export function tokens(kv: KVNamespace, prefix = ""): TokenStore {
    return {
      async save(token) {
        const ttl = Math.max(1, Math.ceil((token.expiresAt - Date.now()) / 1000))
        const data = JSON.stringify(token)
        await kv.put(`${prefix}access:${token.accessToken}`, data, { expirationTtl: ttl })
        if (token.refreshToken) {
          await kv.put(`${prefix}refresh:${token.refreshToken}`, data)
        }
      },
      async getByAccessToken(token) {
        const raw = await kv.get(`${prefix}access:${token}`)
        if (!raw) return null
        const entry = JSON.parse(raw) as OAuthToken
        if (entry.expiresAt < Date.now()) {
          await kv.delete(`${prefix}access:${token}`)
          if (entry.refreshToken) await kv.delete(`${prefix}refresh:${entry.refreshToken}`)
          return null
        }
        return entry
      },
      async getByRefreshToken(token) {
        const raw = await kv.get(`${prefix}refresh:${token}`)
        if (!raw) return null
        return JSON.parse(raw) as OAuthToken
      },
      async revoke(token) {
        // Try as access token first
        const byAccess = await kv.get(`${prefix}access:${token}`)
        if (byAccess) {
          const entry = JSON.parse(byAccess) as OAuthToken
          await kv.delete(`${prefix}access:${token}`)
          if (entry.refreshToken) await kv.delete(`${prefix}refresh:${entry.refreshToken}`)
          return
        }
        // Try as refresh token
        const byRefresh = await kv.get(`${prefix}refresh:${token}`)
        if (byRefresh) {
          const entry = JSON.parse(byRefresh) as OAuthToken
          await kv.delete(`${prefix}refresh:${token}`)
          await kv.delete(`${prefix}access:${entry.accessToken}`)
        }
      },
    }
  }
}
