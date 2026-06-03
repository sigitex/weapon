import { describe, expect, test } from "bun:test"
import { type } from "arktype"
import { cli, executor, spec } from "@weapon/spec"
import { cliHost, command } from "../src"

function io() {
  const out: string[] = []
  const err: string[] = []
  return {
    out,
    err,
    stdout: (text: string) => {
      out.push(text)
    },
    stderr: (text: string) => {
      err.push(text)
    },
  }
}

describe("cliHost", () => {
  const Api = spec(
    { cli: cli({ name: "tasks", description: "Task tools" }) },
    {
      tasks: {
        list: {
          cli: { aliases: ["ls"], description: "List tasks" },
          input: type({ project: command.string({ arg: true }) }),
          output: type({ project: "string" }),
        },
        hidden: {
          cli: { hidden: true },
          input: type({}),
          output: type("string"),
        },
      },
      nope: {
        cli: false,
        input: type({}),
        output: type("string"),
      },
    },
  )
  const service = Api.contract.service({
    tasks: {
      list(input) {
        return input
      },
      hidden() {
        return "secret"
      },
    },
    nope() {
      return "nope"
    },
  })

  test("maps CLI operations and dispatches aliases", async () => {
    const stream = io()
    const exec = executor(Api, { middleware: {}, services: [service] })
    const app = cliHost(Api.transports.cli, exec, stream)

    expect(app.commands.map((c) => c.path.join(" "))).toEqual(["tasks hidden", "tasks list"])
    const code = await app.run(["ls", "abc"])

    expect(code).toBe(0)
    expect(stream.out).toEqual(['{"project":"abc"}\n'])
  })

  test("uses mounted path for cli true and hides hidden commands from help", () => {
    const exec = executor(Api, { middleware: {}, services: [service] })
    const app = cliHost(Api.transports.cli, exec)

    expect(app.commands.find((c) => c.path.join(" ") === "tasks hidden")).toBeDefined()
    expect(app.help()).toContain("tasks list")
    expect(app.help()).not.toContain("tasks hidden")
  })

  test("throws on command collisions", () => {
    const Bad = spec(
      { cli: cli() },
      {
        one: { cli: "same", input: type({}), output: type("string") },
        two: { cli: "same", input: type({}), output: type("string") },
      },
    )
    const service = Bad.contract.service({ one: () => "one", two: () => "two" })
    const exec = executor(Bad, { middleware: {}, services: [service] })

    expect(() => cliHost(Bad.transports.cli, exec)).toThrow("Duplicate command path")
  })
})

describe("command", () => {
  test("normalizes operations, defaults config, and returns runtime pieces", async () => {
    const stream = io()
    const app = command({
      name: "hello",
      ...stream,
      greet: {
        run() {
          return "hi"
        },
      },
    })

    expect(app.spec).toBeDefined()
    expect(app.services).toHaveLength(1)
    expect(app.executor.operations[0].path).toEqual(["greet"])
    expect(await app.run(["greet"])).toBe(0)
    expect(stream.out).toEqual(["hi\n"])
  })

  test("parses flags, clusters, negation, arrays, terminator, and positionals", async () => {
    const stream = io()
    const app = command({
      ...stream,
      run: {
        input: type({
          name: command.string({ arg: true }),
          count: command.integer({ short: "c" }),
          verbose: command.boolean({ short: "v" }),
          force: command.boolean({ short: "f" }),
          tag: type("string[]").configure({ meta: { cli: { option: true } } } as any),
        }),
        run(input: unknown) {
          return input
        },
      },
    })

    const code = await app.run([
      "run",
      "--count",
      "2",
      "-vf",
      "--no-force",
      "--tag",
      "a",
      "--tag=b",
      "--",
      "project",
    ])

    expect(code).toBe(0)
    expect(JSON.parse(stream.out[0])).toEqual({
      count: 2,
      verbose: true,
      force: false,
      tag: ["a", "b"],
      name: "project",
    })
  })

  test("returns non-zero for validation and handler errors", async () => {
    const stream = io()
    const app = command({
      ...stream,
      fail: {
        input: type({ value: command.integer() }),
        run() {
          throw new Error("boom")
        },
      },
    })

    expect(await app.run(["fail", "--value", "bad"])).toBe(1)
    expect(await app.run(["fail", "--value", "1"])).toBe(1)
    expect(stream.err.join("\n")).toContain("boom")
  })

  test("generates command help from descriptions and labels", () => {
    const app = command({
      run: {
        description: "Run job",
        input: type({
          name: command.string({ arg: true, description: "Job name" }),
          count: command.integer({ label: "Count" }),
          hidden: command.boolean({ hidden: true }),
        }),
        run(input: unknown) {
          return input
        },
      },
    })

    const help = app.help(["run"])
    expect(help).toContain("Run job")
    expect(help).toContain("Job name")
    expect(help).toContain("Count")
    expect(help).not.toContain("hidden")
    expect(() => app.help(["missing"])).toThrow("Unknown command")
  })

  test("rejects removed operations wrapper", () => {
    expect(() =>
      command({
        operations: {
          greet: {
            run() {
              return "hi"
            },
          },
        },
      }),
    ).toThrow("remove the operations wrapper")
  })
})
