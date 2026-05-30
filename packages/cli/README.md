# @weapon/cli

CLI adapter for Weapon contracts.

## High-Level Commands

Use `command()` for small CLIs where command definition and handler live together:

```ts
import { command } from "@weapon/cli"
import { type } from "arktype"

const app = command({
  cli: { name: "tasks", description: "Task manager" },
  operations: {
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
  },
})

await app.main()
```

`command()` normalizes into normal Weapon pieces and returns `spec`, `services`, `executor`, `commands`, `run`, `main`, and `help`.

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
