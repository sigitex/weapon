# @weapon/cli

CLI adapter for Weapon contracts.

## High-Level Commands

Use `command()` for small CLIs where command definition and handler live together:

```ts
import { command } from "@weapon/cli"
import { type } from "arktype"

const app = command({
  name: "tasks",
  description: "Task manager",
  options: type({
    profile: command.string({ short: "p", description: "Config profile" }),
  }),
  list: {
    description: "List tasks",
    input: type({
      project: command.string({ arg: true, description: "Project id" }),
      limit: command.integer({ short: "l", label: "Limit" }),
      done: command.boolean({ short: "d" }),
    }),
    run(input) {
      return input
    },
  },
})

await app.main()
```

`command()` normalizes into normal Weapon pieces and returns `spec`, `services`, `executor`, `commands`, `run`, `main`, and `help`.
Top-level `options` are global options, parse before or after the command path, and are available to handlers as `context.cli.options`.

Top-level `run` defines a root command:

```ts
const app = command({
  name: "cat",
  input: type({ file: command.string({ arg: true }) }),
  run({ file }) {
    return file
  },
})
```

## Low-Level Host

Use `cliHost()` when you already have a spec, executor, and services:

```ts
import { cliHost } from "@weapon/cli"

const host = cliHost(Spec.transports.cli, exec, {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
})

await host.run(["tasks", "list", "project-a", "--limit", "10"])
```

Commands use operation paths by default with `cli: true`; use strings or structured config to override paths, aliases, help visibility, and formatting.
