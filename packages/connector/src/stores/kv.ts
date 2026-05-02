/** biome-ignore-all lint/suspicious/noExplicitAny: intent */
import type { ClientStore, CodeStore, TokenStore, OAuthClient, AuthorizationCode, OAuthToken } from "../stores"

/**
 * Unstorage-compatible interface.
 * @see https://unstorage.unjs.io
 */
type UnstorageInstance = {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string, opts?: { ttl?: number }): Promise<void>
  removeItem(key: string): Promise<void>
}

/**
 * Keyv-compatible interface.
 * @see https://keyv.org
 */
type KeyvInstance = {
  get(key: string): Promise<unknown | undefined>
  set(key: string, value: unknown, ttl?: number): Promise<boolean>
  delete(key: string): Promise<boolean>
}

/** Unified KV adapter — abstracts over unstorage and keyv. */
type KVAdapter = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlMs?: number): Promise<void>
  del(key: string): Promise<void>
}

/**
 * Creates all three OAuth stores backed by a generic KV instance.
 * Auto-detects unstorage (has `getItem`) vs keyv (has `get`).
 *
 * @example unstorage:
 * ```ts
 * ...kv(storage)
 * ```
 *
 * @example keyv:
 * ```ts
 * ...kv(keyvInstance)
 * ```
 */
export function kv(instance: UnstorageInstance | KeyvInstance): {
  clients: ClientStore
  codes: CodeStore
  tokens: TokenStore
} {
  const adapter = createAdapter(instance)
  return {
    clients: kv.clients(instance),
    codes: kv.codes(instance),
    tokens: kv.tokens(instance),
  }
}

export namespace kv {
  /** Creates a KV-backed ClientStore. */
  export function clients(instance: UnstorageInstance | KeyvInstance, prefix = "oauth:clients:"): ClientStore {
    const adapter = createAdapter(instance)
    return {
      async get(clientId) {
        const raw = await adapter.get(`${prefix}${clientId}`)
        if (!raw) return null
        const client = JSON.parse(raw) as OAuthClient
        if (client.secretExpiresAt && client.secretExpiresAt < Date.now()) {
          await adapter.del(`${prefix}${clientId}`)
          return null
        }
        return client
      },
      async register(client) {
        await adapter.set(`${prefix}${client.clientId}`, JSON.stringify(client))
      },
    }
  }

  /** Creates a KV-backed CodeStore. */
  export function codes(instance: UnstorageInstance | KeyvInstance, prefix = "oauth:codes:"): CodeStore {
    const adapter = createAdapter(instance)
    return {
      async save(code) {
        const ttlMs = Math.max(1000, code.expiresAt - Date.now())
        await adapter.set(`${prefix}${code.code}`, JSON.stringify(code), ttlMs)
      },
      async consume(code) {
        const raw = await adapter.get(`${prefix}${code}`)
        if (!raw) return null
        await adapter.del(`${prefix}${code}`)
        const entry = JSON.parse(raw) as AuthorizationCode
        if (entry.expiresAt < Date.now()) return null
        return entry
      },
    }
  }

  /** Creates a KV-backed TokenStore. Dual-key entries for access + refresh token lookup. */
  export function tokens(instance: UnstorageInstance | KeyvInstance, prefix = "oauth:tokens:"): TokenStore {
    const adapter = createAdapter(instance)
    return {
      async save(token) {
        const ttlMs = Math.max(1000, token.expiresAt - Date.now())
        const data = JSON.stringify(token)
        await adapter.set(`${prefix}access:${token.accessToken}`, data, ttlMs)
        if (token.refreshToken) {
          await adapter.set(`${prefix}refresh:${token.refreshToken}`, data)
        }
      },
      async getByAccessToken(token) {
        const raw = await adapter.get(`${prefix}access:${token}`)
        if (!raw) return null
        const entry = JSON.parse(raw) as OAuthToken
        if (entry.expiresAt < Date.now()) {
          await adapter.del(`${prefix}access:${token}`)
          if (entry.refreshToken) await adapter.del(`${prefix}refresh:${entry.refreshToken}`)
          return null
        }
        return entry
      },
      async getByRefreshToken(token) {
        const raw = await adapter.get(`${prefix}refresh:${token}`)
        if (!raw) return null
        return JSON.parse(raw) as OAuthToken
      },
      async revoke(token) {
        const byAccess = await adapter.get(`${prefix}access:${token}`)
        if (byAccess) {
          const entry = JSON.parse(byAccess) as OAuthToken
          await adapter.del(`${prefix}access:${token}`)
          if (entry.refreshToken) await adapter.del(`${prefix}refresh:${entry.refreshToken}`)
          return
        }
        const byRefresh = await adapter.get(`${prefix}refresh:${token}`)
        if (byRefresh) {
          const entry = JSON.parse(byRefresh) as OAuthToken
          await adapter.del(`${prefix}refresh:${token}`)
          await adapter.del(`${prefix}access:${entry.accessToken}`)
        }
      },
    }
  }
}

// --- Adapter ---

function createAdapter(instance: UnstorageInstance | KeyvInstance): KVAdapter {
  if ("getItem" in instance) {
    // Unstorage
    const s = instance as UnstorageInstance
    return {
      async get(key) {
        return s.getItem(key)
      },
      async set(key, value, ttlMs) {
        await s.setItem(key, value, ttlMs ? { ttl: Math.ceil(ttlMs / 1000) } : undefined)
      },
      async del(key) {
        await s.removeItem(key)
      },
    }
  }
  // Keyv
  const k = instance as KeyvInstance
  return {
    async get(key) {
      const val = await k.get(key)
      if (val === undefined || val === null) return null
      return typeof val === "string" ? val : JSON.stringify(val)
    },
    async set(key, value, ttlMs) {
      await k.set(key, value, ttlMs)
    },
    async del(key) {
      await k.delete(key)
    },
  }
}
