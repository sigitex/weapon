import type {
  CliConfig,
  CliOperationConfig,
  MountedOperation,
} from "@weapon/spec"
import { Field } from "./Field"

export type MountedCommand = {
  readonly mounted: MountedOperation
  readonly path: readonly string[]
  readonly aliases: readonly (readonly string[])[]
  readonly description?: string
  readonly hidden: boolean
  readonly format?: "json" | "text" | "silent"
  readonly fields: readonly Field[]
}

export namespace MountedCommand {
  export type Match = {
    readonly command: MountedCommand
    readonly rest: readonly string[]
  }

  export function fromOperations(
    operations: readonly MountedOperation[],
  ): MountedCommand[] {
    const commands: MountedCommand[] = []
    const claimed = new Map<string, string>()

    for (const mounted of operations) {
      const cli = (mounted.definition as Record<string, unknown>).cli as
        | CliOperationConfig
        | undefined
      if (cli === undefined || cli === false) {
        continue
      }

      const config = typeof cli === "object" ? cli : undefined
      const path = splitPath(
        cli === true
          ? mounted.path.join(" ")
          : typeof cli === "string"
            ? cli
            : (config?.command ?? mounted.path.join(" ")),
      )
      const aliases = (config?.aliases ?? []).map(splitPath)
      const fields = Field.fromType(mounted.definition.input)
      const command: MountedCommand = {
        mounted,
        path,
        aliases,
        description: config?.description ?? mounted.definition.description,
        hidden: config?.hidden === true,
        format: config?.format,
        fields,
      }

      assertClaim(claimed, path, path.join(" "))
      for (const alias of aliases) {
        assertClaim(claimed, alias, path.join(" "))
      }
      Field.validatePositionals(fields)
      commands.push(command)
    }

    return commands.toSorted((a, b) =>
      a.path.join(" ").localeCompare(b.path.join(" ")),
    )
  }

  export function match(
    commands: readonly MountedCommand[],
    argv: readonly string[],
  ): Match | undefined {
    const candidates = commands
      .flatMap((command) =>
        [command.path, ...command.aliases].map((path) => ({ command, path })),
      )
      .toSorted((a, b) => b.path.length - a.path.length)

    for (const candidate of candidates) {
      if (candidate.path.every((part, index) => argv[index] === part)) {
        return {
          command: candidate.command,
          rest: argv.slice(candidate.path.length),
        }
      }
    }
  }

  export function guess(argv: readonly string[]): string {
    return argv.find((arg) => !arg.startsWith("-")) ?? ""
  }

  // oxlint-disable-next-line complexity
  export function parseInput(
    command: MountedCommand,
    argv: readonly string[],
  ): Record<string, unknown> {
    const byOption = new Map(
      command.fields.map((field) => [field.option, field]),
    )
    const byShort = new Map(
      command.fields
        .filter((field) => field.short)
        .map((field) => [field.short, field]),
    )
    const input: Record<string, unknown> = {}
    const positionals: string[] = []
    let options = true

    for (let i = 0; i < argv.length; i++) {
      const token = argv[i]
      if (options && token === "--") {
        options = false
        continue
      }
      if (options && token.startsWith("--")) {
        const raw = token.slice(2)
        const negated = raw.startsWith("no-")
        const [name, inline] = (negated ? raw.slice(3) : raw).split(
          /[=](.*)/s,
          2,
        )
        const field = byOption.get(name)
        if (!field) {
          throw new Error(`Unknown option: --${name}`)
        }
        if (negated) {
          if (!field.boolean) {
            throw new Error(`Cannot negate non-boolean option: --${name}`)
          }
          setField(input, field, false)
        } else if (field.boolean && inline === undefined) {
          setField(input, field, true)
        } else {
          const value = inline ?? argv[++i]
          if (value === undefined) {
            throw new Error(`Missing value for --${name}`)
          }
          setField(input, field, value)
        }
        continue
      }
      if (options && token.startsWith("-") && token !== "-") {
        const raw = token.slice(1)
        if (raw.length > 1) {
          const fields = [...raw].map((short) => byShort.get(short))
          if (fields.some((field) => !field)) {
            throw new Error(`Unknown short option: -${raw}`)
          }
          if (fields.some((field) => !field!.boolean)) {
            throw new Error(
              `Short option clusters only support boolean flags: -${raw}`,
            )
          }
          for (const field of fields) {
            setField(input, field!, true)
          }
        } else {
          const field = byShort.get(raw)
          if (!field) {
            throw new Error(`Unknown short option: -${raw}`)
          }
          if (field.boolean) {
            setField(input, field, true)
          } else {
            const value = argv[++i]
            if (value === undefined) {
              throw new Error(`Missing value for -${raw}`)
            }

            setField(input, field, value)
          }
        }
        continue
      }
      positionals.push(token)
    }

    const positionalFields = command.fields.filter(
      (field) => field.arg !== undefined,
    )
    if (positionalFields.length === 1 && positionalFields[0].arg === true) {
      if (positionals[0] !== undefined) {
        input[positionalFields[0].key] = positionals[0]
      }
    } else {
      for (const field of positionalFields) {
        const index = Field.positionalIndex(field)
        if (positionals[index] !== undefined) {
          input[field.key] = positionals[index]
        }
      }
    }

    if (positionals.length > positionalFields.length) {
      throw new Error(
        `Unexpected positional argument: ${positionals[positionalFields.length]}`,
      )
    }

    return input
  }

  export function rootHelp(
    config: CliConfig | undefined,
    commands: readonly MountedCommand[],
    globalFields: readonly Field[] = [],
  ): string {
    const lines = [config?.name ?? "Commands"]
    if (config?.description) {
      lines.push("", config.description)
    }
    lines.push(
      "",
      "Usage:",
      `  ${config?.name ?? "command"} <command> [options]`,
      "",
      "Commands:",
    )
    const visible = commands.filter((command) => !command.hidden)
    for (const command of visible) {
      lines.push(
        `  ${pad(command.path.join(" "), 24)}${command.description ?? ""}`.trimEnd(),
      )
    }
    lines.push(`  ${pad("help", 24)}Show help`.trimEnd())
    addFields(
      lines,
      "Global Options:",
      globalFields.filter((field) => !field.hidden),
    )
    return lines.join("\n")
  }

  export function help(
    command: MountedCommand,
    globalFields: readonly Field[] = [],
  ): string {
    const commandPath = command.path.join(" ")
    const lines = [commandPath || "root"]
    if (command.description) {
      lines.push("", command.description)
    }
    lines.push(
      "",
      "Usage:",
      `  ${commandPath} ${usageFields(command, globalFields)}`.trimEnd(),
    )
    const args = command.fields.filter(
      (field) => field.arg !== undefined && !field.hidden,
    )
    const opts = command.fields.filter(
      (field) => field.arg === undefined && !field.hidden,
    )
    if (args.length > 0) {
      lines.push("", "Arguments:")
      for (const field of args) {
        lines.push(
          `  ${pad(argName(field), 24)}${field.description ?? field.key}`.trimEnd(),
        )
      }
    }
    addFields(lines, "Options:", opts)
    addFields(
      lines,
      "Global Options:",
      globalFields.filter((field) => !field.hidden),
    )
    return lines.join("\n")
  }

  export function stripHelpTokens(argv: readonly string[]): string[] {
    return argv.filter((arg) => arg !== "--help" && arg !== "-h")
  }

  export function isRootHelp(argv: readonly string[]): boolean {
    return (
      argv.length === 1 &&
      (argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help")
    )
  }
}

function splitPath(path: string): string[] {
  const parts = path.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0 && path !== "") {
    throw new Error("Command path cannot be empty")
  }
  return parts
}

function assertClaim(
  claimed: Map<string, string>,
  path: readonly string[],
  owner: string,
) {
  if (path[0] === "help") {
    throw new Error("Root command path `help` is reserved")
  }
  const key = path.join(" ")
  const previous = claimed.get(key)
  if (previous) {
    throw new Error(
      `Duplicate command path or alias: ${key} (${previous}, ${owner})`,
    )
  }
  claimed.set(key, owner)
}

function setField(
  input: Record<string, unknown>,
  field: Field,
  value: unknown,
) {
  if (field.array) {
    const existing = input[field.key]
    input[field.key] = Array.isArray(existing) ? [...existing, value] : [value]
    return
  }
  if (field.boolean) {
    input[field.key] = value
    return
  }
  if (input[field.key] !== undefined) {
    throw new Error(`Repeated option: --${field.option}`)
  }
  input[field.key] = value
}

function usageFields(
  command: MountedCommand,
  globalFields: readonly Field[],
): string {
  const args = command.fields
    .filter((field) => field.arg !== undefined && !field.hidden)
    .map((field) => `<${argName(field)}>`)
  const hasOptions = [...command.fields, ...globalFields].some(
    (field) => field.arg === undefined && !field.hidden,
  )
  return [...args, hasOptions ? "[options]" : ""].filter(Boolean).join(" ")
}

function addFields(lines: string[], title: string, fields: readonly Field[]) {
  if (fields.length === 0) {
    return
  }
  lines.push("", title)
  for (const field of fields) {
    const name = `${field.short ? `-${field.short}, ` : ""}--${field.option}${field.boolean ? "" : ` <${field.key}>`}`
    lines.push(`  ${pad(name, 24)}${field.description ?? field.key}`.trimEnd())
  }
}

function pad(text: string, width: number): string {
  return text + " ".repeat(Math.max(1, width - text.length))
}

function argName(field: Field): string {
  return typeof field.arg === "object" && field.arg.name
    ? field.arg.name
    : field.key
}
