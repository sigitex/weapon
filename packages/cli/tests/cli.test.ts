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

    expect(() => cliHost(Bad.transports.cli, exec)).toThrow(
      "Duplicate command path",
    )
  })

  test("throws on duplicate root command paths", () => {
    const Bad = spec(
      { cli: cli() },
      {
        one: { cli: "", input: type({}), output: type("string") },
        two: { cli: { command: "" }, input: type({}), output: type("string") },
      },
    )
    const service = Bad.contract.service({ one: () => "one", two: () => "two" })
    const exec = executor(Bad, { middleware: {}, services: [service] })

    expect(() => cliHost(Bad.transports.cli, exec)).toThrow("Duplicate command path")
  })

  test("rejects empty aliases", () => {
    const Bad = spec(
      { cli: cli() },
      {
        one: {
          cli: { aliases: [""] },
          input: type({}),
          output: type("string"),
        },
      },
    )
    const service = Bad.contract.service({ one: () => "one" })
    const exec = executor(Bad, { middleware: {}, services: [service] })

    expect(() => cliHost(Bad.transports.cli, exec)).toThrow(
      "Command path cannot be empty",
    )
  })

  test("rejects fields that collide with built-in help options", () => {
    const Bad = spec(
      { cli: cli() },
      {
        one: {
          cli: true,
          input: type({ help: command.boolean() }),
          output: type("string"),
        },
      },
    )
    const service = Bad.contract.service({ one: () => "one" })
    const exec = executor(Bad, { middleware: {}, services: [service] })
    const Good = spec(
      { cli: cli() },
      {
        one: {
          cli: true,
          input: type({}),
          output: type("string"),
        },
      },
    )
    const goodService = Good.contract.service({ one: () => "one" })
    const goodExec = executor(Good, {
      middleware: {},
      services: [goodService],
    })

    expect(() => cliHost(Bad.transports.cli, exec)).toThrow(
      "CLI option is reserved for help: help",
    )
    expect(() =>
      cliHost(Good.transports.cli, goodExec, {
        options: type({ halt: command.boolean({ short: "h" }) }),
      }),
    ).toThrow("CLI option is reserved for help: halt")
    expect(() =>
      cliHost(Good.transports.cli, goodExec, {
        options: type({ help: command.boolean() }),
      }),
    ).toThrow("CLI option is reserved for help: help")
  })

  test("rejects duplicate option metadata and invalid positional indexes", () => {
    const DuplicateLong = spec(
      { cli: cli() },
      {
        one: {
          cli: true,
          input: type({
            first: command.string({ option: "value" }),
            second: command.string({ option: "value" }),
          }),
          output: type("string"),
        },
      },
    )
    const DuplicateShort = spec(
      { cli: cli() },
      {
        one: {
          cli: true,
          input: type({
            first: command.string({ short: "v" }),
            second: command.string({ short: "v" }),
          }),
          output: type("string"),
        },
      },
    )
    const InvalidPosition = spec(
      { cli: cli() },
      {
        one: {
          cli: true,
          input: type({ bad: command.string({ arg: { index: -1 } }) }),
          output: type("string"),
        },
      },
    )

    expect(() =>
      cliHost(
        DuplicateLong.transports.cli,
        executor(DuplicateLong, {
          middleware: {},
          services: [DuplicateLong.contract.service({ one: () => "one" })],
        }),
      ),
    ).toThrow("Duplicate CLI option")
    expect(() =>
      cliHost(
        DuplicateShort.transports.cli,
        executor(DuplicateShort, {
          middleware: {},
          services: [DuplicateShort.contract.service({ one: () => "one" })],
        }),
      ),
    ).toThrow("Duplicate CLI short option")
    expect(() =>
      cliHost(
        InvalidPosition.transports.cli,
        executor(InvalidPosition, {
          middleware: {},
          services: [InvalidPosition.contract.service({ one: () => "one" })],
        }),
      ),
    ).toThrow("Invalid positional index")
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

  test("rejects option syntax for positional fields", async () => {
    const stream = io()
    const app = command({
      ...stream,
      run: {
        input: type({ name: command.string({ arg: true, short: "n" }) }),
        run(input: unknown) {
          return input
        },
      },
    })

    expect(await app.run(["run", "--name", "project"])).toBe(1)
    expect(await app.run(["run", "-n", "project"])).toBe(1)
    expect(stream.err.join("\n")).toContain("Unknown option: --name")
    expect(stream.err.join("\n")).toContain("Unknown short option: -n")
  })

  test("allows sparse explicit positional indexes", async () => {
    const stream = io()
    const app = command({
      ...stream,
      run: {
        input: type({ third: command.string({ arg: { index: 2 } }) }),
        run(input: unknown) {
          return input
        },
      },
    })

    expect(await app.run(["run", "ignored", "also-ignored", "value"])).toBe(0)
    expect(JSON.parse(stream.out[0])).toEqual({ third: "value" })
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

  test("prints command help when executor validation fails", async () => {
    const stream = io()
    const app = command({
      ...stream,
      fail: {
        description: "Needs number",
        input: type({ value: command.integer({ description: "Number" }) }),
        run(input: unknown) {
          return input
        },
      },
    })

    expect(await app.run(["fail", "--value", "bad"])).toBe(1)
    expect(stream.err.join("\n")).toContain("Needs number")
    expect(stream.err.join("\n")).toContain("Number")
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

  test("parses global options anywhere and binds them to cli context", async () => {
    const stream = io()
    const app = command({
      ...stream,
      options: type({
        profile: command.string({ short: "p", description: "Profile" }),
        verbose: command.boolean({ short: "v" }),
      }),
      tasks: {
        list: {
          input: type({ project: command.string({ arg: true }) }),
          run(input: { project: string }, context: { cli: { options: { profile: string; verbose: boolean } } }) {
            return { ...input, ...context.cli.options }
          },
        },
      },
    })

    expect(await app.run(["--profile", "dev", "tasks", "list", "core", "-v"])).toBe(0)
    expect(JSON.parse(stream.out[0])).toEqual({
      project: "core",
      profile: "dev",
      verbose: true,
    })
    expect(app.help(["tasks", "list"])).toContain("Global Options")
    expect(app.help(["tasks", "list"])).toContain("Profile")
  })

  test("supports root command with positional input", async () => {
    const stream = io()
    const app = command({
      ...stream,
      input: type({ file: command.string({ arg: true }) }),
      run(input: { file: string }) {
        return input.file
      },
    })

    expect(await app.run(["README.md"])).toBe(0)
    expect(stream.out).toEqual(["README.md\n"])
    expect(app.help()).toContain("<file>")
    expect(app.help()).not.toContain("<command>")
    expect(await app.run(["--help"])).toBe(0)
    expect(stream.out[1]).toContain("<file>")
  })

  test("preserves root operation description and protocol config", async () => {
    const stream = io()
    let authorized = false
    const app = command({
      ...stream,
      description: "Read file",
      protocol: { authorize: { kind: "middleware" } },
      middleware: {
        authorize: {
          onRequest() {
            authorized = true
          },
        },
      },
      authorize: { user: true },
      run() {
        return "ok"
      },
    })

    expect(app.help()).toContain("Read file")
    expect(await app.run([])).toBe(0)
    expect(authorized).toBe(true)
  })

  test("rejects global positional args and option collisions", () => {
    expect(() =>
      command({
        options: type({ file: command.string({ arg: true }) }),
        run() {
          return "root"
        },
      }),
    ).toThrow("Global options cannot be positional")

    expect(() =>
      command({
        options: type({ profile: command.string({ short: "p" }) }),
        tasks: {
          input: type({ profile: command.string({ short: "p" }) }),
          run() {
            return "tasks"
          },
        },
      }),
    ).toThrow("Global option collides with command option")
  })

  test("allows global options to share names with command positionals", async () => {
    const stream = io()
    const app = command({
      ...stream,
      options: type({ profile: command.string() }),
      tasks: {
        input: type({ profile: command.string({ arg: true }) }),
        run(
          input: { profile: string },
          context: { cli: { options: { profile: string } } },
        ) {
          return { command: input.profile, global: context.cli.options.profile }
        },
      },
    })

    expect(await app.run(["--profile", "dev", "tasks", "prod"])).toBe(0)
    expect(JSON.parse(stream.out[0])).toEqual({
      command: "prod",
      global: "dev",
    })
  })

  test("rejects protocol operation config without run", () => {
    expect(() =>
      command({
        protocol: { authorize: { kind: "middleware" } },
        secure: { authorize: { user: true } },
      }),
    ).toThrow("Command operation requires run: secure")
  })

  test("rejects missing middleware implementation", () => {
    expect(() =>
      command({
        protocol: { authorize: { kind: "middleware" } },
        secure: {
          authorize: { user: true },
          run() {
            return "secure"
          },
        },
      }),
    ).toThrow("Missing middleware implementation: authorize")
  })
})
