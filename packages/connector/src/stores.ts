// --- Record Types (weapon types, not SDK types) ---

/** A registered OAuth client. */
export type OAuthClient = {
  readonly clientId: string
  readonly clientSecret?: string
  readonly redirectUris: string[]
  readonly name?: string
  readonly registeredAt: number
  readonly secretExpiresAt?: number
}

/** A short-lived, single-use authorization code. */
export type AuthorizationCode = {
  readonly code: string
  readonly clientId: string
  readonly redirectUri: string
  readonly codeChallenge: string
  readonly codeChallengeMethod: string
  readonly expiresAt: number
  readonly scopes: string[]
}

/** An access + refresh token pair. */
export type OAuthToken = {
  readonly accessToken: string
  readonly refreshToken?: string
  readonly clientId: string
  readonly scopes: string[]
  readonly expiresAt: number
}

// --- Store Interfaces ---

/** Registered OAuth client store. */
export type ClientStore = {
  get(clientId: string): MaybePromise<OAuthClient | null>
  register(client: OAuthClient): MaybePromise<void>
}

export namespace ClientStore {
  /** Creates an in-memory client store backed by a Map. */
  export function inMemory(): ClientStore {
    const clients = new Map<string, OAuthClient>()
    return {
      get(clientId) {
        const client = clients.get(clientId) ?? null
        if (client?.secretExpiresAt && client.secretExpiresAt < Date.now()) {
          clients.delete(clientId)
          return null
        }
        return client
      },
      register(client) {
        clients.set(client.clientId, client)
      },
    }
  }
}

/** Short-lived authorization code store. */
export type CodeStore = {
  save(code: AuthorizationCode): MaybePromise<void>
  consume(code: string): MaybePromise<AuthorizationCode | null>
}

export namespace CodeStore {
  /** Creates an in-memory code store backed by a Map. Consume is atomic (read + delete). */
  export function inMemory(): CodeStore {
    const codes = new Map<string, AuthorizationCode>()
    return {
      save(code) {
        codes.set(code.code, code)
      },
      consume(code) {
        const entry = codes.get(code) ?? null
        if (!entry) return null
        codes.delete(code)
        if (entry.expiresAt < Date.now()) return null
        return entry
      },
    }
  }
}

/** Access + refresh token store. */
export type TokenStore = {
  save(token: OAuthToken): MaybePromise<void>
  getByAccessToken(token: string): MaybePromise<OAuthToken | null>
  getByRefreshToken(token: string): MaybePromise<OAuthToken | null>
  revoke(token: string): MaybePromise<void>
}

export namespace TokenStore {
  /** Creates an in-memory token store backed by Maps. Expired tokens are filtered on read. */
  export function inMemory(): TokenStore {
    const byAccessToken = new Map<string, OAuthToken>()
    const byRefreshToken = new Map<string, OAuthToken>()

    return {
      save(token) {
        byAccessToken.set(token.accessToken, token)
        if (token.refreshToken) {
          byRefreshToken.set(token.refreshToken, token)
        }
      },
      getByAccessToken(token) {
        const entry = byAccessToken.get(token) ?? null
        if (entry && entry.expiresAt < Date.now()) {
          byAccessToken.delete(token)
          if (entry.refreshToken) byRefreshToken.delete(entry.refreshToken)
          return null
        }
        return entry
      },
      getByRefreshToken(token) {
        const entry = byRefreshToken.get(token) ?? null
        if (!entry) return null
        return entry
      },
      revoke(token) {
        const byAccess = byAccessToken.get(token)
        if (byAccess) {
          byAccessToken.delete(token)
          if (byAccess.refreshToken) byRefreshToken.delete(byAccess.refreshToken)
          return
        }
        const byRefresh = byRefreshToken.get(token)
        if (byRefresh) {
          byRefreshToken.delete(token)
          byAccessToken.delete(byRefresh.accessToken)
        }
      },
    }
  }
}
