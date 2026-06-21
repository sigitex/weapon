import type {
  CliConfig,
  CliOperationConfig,
  MountedOperation,
} from "@weapon/spec"
import { Field } from "./Field"
import { Help } from "./Help"

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
    return Help.root(config, commands, globalFields)
  }

  export function help(
    command: MountedCommand,
    globalFields: readonly Field[] = [],
  ): string {
    return Help.command(command, globalFields)
  }

  export function stripHelpTokens(argv: readonly string[]): string[] {
    return Help.stripTokens(argv)
  }

  export function isRootHelp(argv: readonly string[]): boolean {
    return Help.isRootRequest(argv)
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
