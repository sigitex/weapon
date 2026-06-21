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
        { allowEmpty: true },
      )
      const aliases = (config?.aliases ?? []).map((alias) =>
        splitPath(alias, { allowEmpty: false }),
      )
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
      Field.validateOptions(fields)
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

  export function parseInput(
    command: MountedCommand,
    argv: readonly string[],
  ): Record<string, unknown> {
    return Field.parseInput(command.fields, argv)
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

function splitPath(
  path: string,
  config: { readonly allowEmpty: boolean },
): string[] {
  const parts = path.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0 && (!config.allowEmpty || path !== "")) {
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
  if (claimed.has(key)) {
    throw new Error(
      `Duplicate command path or alias: ${key} (${previous}, ${owner})`,
    )
  }
  claimed.set(key, owner)
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
