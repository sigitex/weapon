import { describe, test, expect, beforeEach } from "bun:test"
import { ClientStore, CodeStore, TokenStore } from "./stores"
import type { OAuthClient, AuthorizationCode, OAuthToken } from "./stores"

describe("ClientStore.inMemory", () => {
  let store: ClientStore

  beforeEach(() => {
    store = ClientStore.inMemory()
  })

  test("returns null for unknown client", () => {
    expect(store.get("unknown")).toBe(null)
  })

  test("registers and retrieves a client", () => {
    const client: OAuthClient = {
      clientId: "c1",
      redirectUris: ["http://localhost/cb"],
      registeredAt: Date.now(),
    }
    store.register(client)
    expect(store.get("c1")).toEqual(client)
  })

  test("returns null for expired client secret", () => {
    const client: OAuthClient = {
      clientId: "c2",
      clientSecret: "secret",
      redirectUris: ["http://localhost/cb"],
      registeredAt: Date.now(),
      secretExpiresAt: Date.now() - 1000,
    }
    store.register(client)
    expect(store.get("c2")).toBe(null)
  })
})

describe("CodeStore.inMemory", () => {
  let store: CodeStore

  beforeEach(() => {
    store = CodeStore.inMemory()
  })

  test("returns null for unknown code", () => {
    expect(store.consume("unknown")).toBe(null)
  })

  test("saves and consumes a code (single-use)", () => {
    const code: AuthorizationCode = {
      code: "abc123",
      clientId: "c1",
      redirectUri: "http://localhost/cb",
      codeChallenge: "challenge",
      codeChallengeMethod: "S256",
      expiresAt: Date.now() + 60000,
      scopes: ["read"],
    }
    store.save(code)
    expect(store.consume("abc123")).toEqual(code)
    // Second consume returns null
    expect(store.consume("abc123")).toBe(null)
  })

  test("returns null for expired code", () => {
    const code: AuthorizationCode = {
      code: "expired",
      clientId: "c1",
      redirectUri: "http://localhost/cb",
      codeChallenge: "challenge",
      codeChallengeMethod: "S256",
      expiresAt: Date.now() - 1000,
      scopes: [],
    }
    store.save(code)
    expect(store.consume("expired")).toBe(null)
  })
})

describe("TokenStore.inMemory", () => {
  let store: TokenStore

  beforeEach(() => {
    store = TokenStore.inMemory()
  })

  const makeToken = (overrides?: Partial<OAuthToken>): OAuthToken => ({
    accessToken: "access-1",
    refreshToken: "refresh-1",
    clientId: "c1",
    scopes: ["read"],
    expiresAt: Date.now() + 60000,
    ...overrides,
  })

  test("returns null for unknown tokens", () => {
    expect(store.getByAccessToken("unknown")).toBe(null)
    expect(store.getByRefreshToken("unknown")).toBe(null)
  })

  test("saves and retrieves by access token", () => {
    const token = makeToken()
    store.save(token)
    expect(store.getByAccessToken("access-1")).toEqual(token)
  })

  test("saves and retrieves by refresh token", () => {
    const token = makeToken()
    store.save(token)
    expect(store.getByRefreshToken("refresh-1")).toEqual(token)
  })

  test("returns null for expired access token", () => {
    const token = makeToken({ expiresAt: Date.now() - 1000 })
    store.save(token)
    expect(store.getByAccessToken("access-1")).toBe(null)
  })

  test("revokes by access token (removes both keys)", () => {
    const token = makeToken()
    store.save(token)
    store.revoke("access-1")
    expect(store.getByAccessToken("access-1")).toBe(null)
    expect(store.getByRefreshToken("refresh-1")).toBe(null)
  })

  test("revokes by refresh token (removes both keys)", () => {
    const token = makeToken()
    store.save(token)
    store.revoke("refresh-1")
    expect(store.getByAccessToken("access-1")).toBe(null)
    expect(store.getByRefreshToken("refresh-1")).toBe(null)
  })
})
