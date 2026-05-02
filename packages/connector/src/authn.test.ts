import { describe, test, expect } from "bun:test"
import { type } from "arktype"
import { spec, mcp } from "@weapon/spec"
import { connector } from "./connector"
import { TokenStore } from "./stores"

type User = { id: string; name: string }

const AuthSpec = spec(
  {
    mcp: mcp({
      name: "auth-test",
      version: "1.0.0",
      authenticate: mcp.authenticate.oauth<User>(),
    }),
  },
  {
    whoami: {
      mcp: true,
      description: "Returns the authenticated user",
      input: type({}),
      output: type({ id: "string", name: "string" }),
    },
    revokeToken: {
      mcp: true,
      description: "Revokes a token via context",
      input: type({ token: "string" }),
      output: type({ revoked: "boolean" }),
    },
  },
)

// Pre-seed a token store so we can test without the full OAuth flow
const tokens = TokenStore.inMemory()
tokens.save({
  accessToken: "valid-token",
  refreshToken: "refresh-1",
  clientId: "test-client",
  scopes: ["read"],
  expiresAt: Date.now() + 60_000,
})

const users: Record<string, User> = {
  "valid-token": { id: "u1", name: "Alice" },
}

const AuthService = AuthSpec.contract.service({
  whoami(_input: {}, ctx: { identity: User }) {
    return ctx.identity
  },
  revokeToken(input: { token: string }, ctx: { tokens: TokenStore }) {
    ctx.tokens.revoke(input.token)
    return { revoked: true }
  },
})

const app = connector(
  AuthSpec,
  AuthSpec.transports.mcp,
  {
    authenticate: async (oauth) => users[oauth.token]!,
    tokens,
  },
  [AuthService],
)

function jsonRpc(method: string, params?: unknown, id: number | string = 1, token?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (token) headers.authorization = `Bearer ${token}`
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  })
}

describe("authenticated connector", () => {
  test("rejects requests without bearer token", async () => {
    const res = await app.fetch(jsonRpc("tools/call", { name: "whoami", arguments: {} }))
    expect(res.status).toBe(401)
    const body = await res.json() as any
    expect(body.error).toBe("invalid_token")
  })

  test("rejects requests with invalid token", async () => {
    const res = await app.fetch(jsonRpc("tools/call", { name: "whoami", arguments: {} }, 1, "bad-token"))
    expect(res.status).toBe(401)
  })

  test("authenticated tools/call dispatches with identity in context", async () => {
    const res = await app.fetch(jsonRpc("tools/call", { name: "whoami", arguments: {} }, 1, "valid-token"))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.result.isError).toBeUndefined()
    const output = JSON.parse(body.result.content[0].text)
    expect(output).toEqual({ id: "u1", name: "Alice" })
  })

  test("stores are accessible from handler context", async () => {
    // Save a token we can revoke
    tokens.save({
      accessToken: "to-revoke",
      clientId: "test-client",
      scopes: [],
      expiresAt: Date.now() + 60000,
    })

    const res = await app.fetch(jsonRpc("tools/call", {
      name: "revokeToken",
      arguments: { token: "to-revoke" },
    }, 1, "valid-token"))

    expect(res.status).toBe(200)
    const body = await res.json() as any
    const output = JSON.parse(body.result.content[0].text)
    expect(output).toEqual({ revoked: true })

    // Token should be revoked
    expect(tokens.getByAccessToken("to-revoke")).toBe(null)
  })

  test("OAuth metadata discovery endpoint works", async () => {
    const res = await app.fetch(new Request("http://localhost/.well-known/oauth-authorization-server"))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.authorization_endpoint).toContain("/authorize")
    expect(body.token_endpoint).toContain("/token")
    expect(body.registration_endpoint).toContain("/register")
    expect(body.code_challenge_methods_supported).toContain("S256")
  })

  test("client registration endpoint works", async () => {
    const res = await app.fetch(new Request("http://localhost/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["http://localhost/cb"],
        client_name: "Test Client",
      }),
    }))
    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.client_id).toBeTruthy()
    expect(body.redirect_uris).toEqual(["http://localhost/cb"])
  })

  test("initialize works with bearer token", async () => {
    const res = await app.fetch(jsonRpc("initialize", {}, 1, "valid-token"))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.result.serverInfo.name).toBe("auth-test")
  })

  test("tools/list works with bearer token", async () => {
    const res = await app.fetch(jsonRpc("tools/list", {}, 1, "valid-token"))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.result.tools).toHaveLength(2)
  })
})
