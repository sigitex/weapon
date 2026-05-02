import { describe, test, expect } from "bun:test"
import { type } from "arktype"
import { spec, mcp } from "@weapon/spec"
import { connector } from "../src/connector"

const TestSpec = spec(
  {
    mcp: mcp({ name: "test-server", version: "1.0.0" }),
  },
  {
    status: {
      mcp: true,
      description: "Get server status",
      input: type.object,
      output: type.object,
    },
    greet: {
      mcp: { name: "say-hello", readOnly: true },
      description: "Greet a user",
      input: type({ name: "string" }),
      output: type({ message: "string" }),
    },
    internal: {
      description: "No MCP config — should not be exposed",
      input: type.object,
      output: type.object,
    },
  },
)

const RootService = TestSpec.contract.service({
  status() {
    return { ok: true }
  },
  greet(input: { name: string }) {
    return { message: `Hello, ${input.name}!` }
  },
  internal() {
    return { secret: true }
  },
})

const app = connector(
  TestSpec,
  TestSpec.transports.mcp,
  {},
  [RootService],
)

describe("connector", () => {
  test("maps only mcp-configured operations to tools", () => {
    expect(app.tools).toHaveLength(2)
    const names = app.tools.map((t) => t.tool.name)
    expect(names).toContain("status")
    expect(names).toContain("say-hello")
    expect(names).not.toContain("internal")
  })

  test("tool has correct description", () => {
    const status = app.tools.find((t) => t.tool.name === "status")!
    expect(status.tool.description).toBe("Get server status")
  })

  test("tool has annotations from hints", () => {
    const greet = app.tools.find((t) => t.tool.name === "say-hello")!
    expect(greet.tool.annotations?.readOnlyHint).toBe(true)
  })

  test("tool has input schema from arktype", () => {
    const greet = app.tools.find((t) => t.tool.name === "say-hello")!
    expect(greet.tool.inputSchema).toEqual({
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    })
  })
})

describe("fetch handler", () => {
  function jsonRpc(method: string, params?: unknown, id: number | string = 1) {
    return new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    })
  }

  test("initialize returns server info and capabilities", async () => {
    const res = await app.fetch(jsonRpc("initialize"))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.result.serverInfo.name).toBe("test-server")
    expect(body.result.capabilities.tools).toEqual({})
  })

  test("tools/list returns mapped tools", async () => {
    const res = await app.fetch(jsonRpc("tools/list"))
    const body = await res.json() as any
    expect(body.result.tools).toHaveLength(2)
  })

  test("tools/call dispatches to handler", async () => {
    const res = await app.fetch(jsonRpc("tools/call", {
      name: "say-hello",
      arguments: { name: "World" },
    }))
    const body = await res.json() as any
    expect(body.result.isError).toBeUndefined()
    const content = body.result.content[0]
    expect(content.type).toBe("text")
    expect(JSON.parse(content.text)).toEqual({ message: "Hello, World!" })
  })

  test("tools/call with unknown tool returns error", async () => {
    const res = await app.fetch(jsonRpc("tools/call", { name: "nope" }))
    const body = await res.json() as any
    expect(body.result.isError).toBe(true)
  })

  test("notification (no id) returns 204", async () => {
    const res = await app.fetch(new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    }))
    expect(res.status).toBe(204)
  })

  test("unknown method returns method not found", async () => {
    const res = await app.fetch(jsonRpc("unknown/method"))
    const body = await res.json() as any
    expect(body.error.code).toBe(-32_601)
  })

  test("GET returns 405", async () => {
    const res = await app.fetch(new Request("http://localhost/mcp"))
    expect(res.status).toBe(405)
  })
})
