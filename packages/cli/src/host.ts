import { Container } from "@sigitex/bind"
import type { CliConfig, CliOperationConfig, TransportConfig } from "@weapon/spec"
import { fieldsFromType, mapCommands } from "./commands"
import { commandHelp, isRootHelp, rootHelp, stripHelpTokens } from "./help"
import { commandGuess, findCommand } from "./matching"
import { formatOutput, isArkErrors, withNewline } from "./output"
import { parseGlobalOptions, parseInput } from "./parser"
import type { CliHost, CliRuntimeConfig } from "./types"
export type { CliField, CliHost, CliMountedCommand, CliRuntimeConfig } from "./types"

declare const process:
  | {
      argv: string[]
      exitCode?: number
      stdout: { write(text: string): void }
      stderr: { write(text: string): void }
    }
  | undefined

export function cliHost<const Config extends CliConfig>(
  transport: TransportConfig<Config, CliOperationConfig>,
  executor: CliHost["executor"],
  config: CliRuntimeConfig = {},
): CliHost {
  const commands = mapCommands(executor.operations)
  const globalFields = config.options ? fieldsFromType(config.options) : []
  validateGlobalFields(globalFields)
  validateOptionCollisions(commands, globalFields)
  const stdout =
    config.stdout ?? ((text: string) => process?.stdout.write(text))
  const stderr =
    config.stderr ?? ((text: string) => process?.stderr.write(text))

  function help(argv: readonly string[] = []): string {
    const args = stripHelpTokens(argv)
    if (args.length === 0) {
      return rootHelp(transport.config, commands, globalFields)
    }
    const match = findCommand(commands, args)
    if (!match || match.rest.length > 0) {
      throw new Error(`Unknown command: ${args.join(" ")}`)
    }
    return commandHelp(match.command, globalFields)
  }

  async function run(argv: readonly string[] = defaultArgv()): Promise<number> {
    try {
      const global = parseGlobalOptions(globalFields, argv)
      const args = global.argv
      const validatedGlobalOptions = config.options
        ? config.options(global.input)
        : {}
      if (isArkErrors(validatedGlobalOptions)) {
        await stderr(withNewline(String(validatedGlobalOptions)))
        await stderr(withNewline(rootHelp(transport.config, commands, globalFields)))
        return 1
      }

      if (args.length === 0 || isRootHelp(args)) {
        const root = findCommand(commands, [])
        if (args.length === 0 && root) {
          return await runCommand(root, [], validatedGlobalOptions)
        }
        await stdout(withNewline(rootHelp(transport.config, commands, globalFields)))
        return 0
      }

      if (args[0] === "help") {
        const target = args.slice(1)
        await stdout(withNewline(help(target)))
        return 0
      }

      const match = findCommand(commands, args)
      if (!match) {
        await stderr(withNewline(`Unknown command: ${commandGuess(args)}`))
        await stderr(withNewline(rootHelp(transport.config, commands, globalFields)))
        return 1
      }

      if (match.rest.includes("--help") || match.rest.includes("-h")) {
        await stdout(withNewline(commandHelp(match.command, globalFields)))
        return 0
      }

      return await runCommand(match, match.rest, validatedGlobalOptions)
    } catch (error) {
      await stderr(
        withNewline(error instanceof Error ? error.message : String(error)),
      )
      return 1
    }
  }

  async function runCommand(
    match: NonNullable<ReturnType<typeof findCommand>>,
    argv: readonly string[],
    options: unknown,
  ): Promise<number> {
    try {
      const input = parseInput(match.command, argv)
      const validation = match.command.mounted.definition.input(input)
      if (isArkErrors(validation)) {
        await stderr(withNewline(String(validation)))
        await stderr(withNewline(commandHelp(match.command, globalFields)))
        return 1
      }

      const container = config.container
        ? config.container.clone()
        : new Container()
      container.bind({ cli: { options } })
      const response = await executor.handle({ mounted: match.command.mounted, input }, container)
      const text = formatOutput(response.output, match.command.format)
      if (text !== undefined) {
        await stdout(withNewline(text))
      }
      return 0
    } catch (error) {
      await stderr(
        withNewline(error instanceof Error ? error.message : String(error)),
      )
      return 1
    }
  }

  async function main(argv?: readonly string[]): Promise<void> {
    const code = await run(argv)
    if (process) {
      process.exitCode = code
    }
  }

  return { executor, commands, run, main, help }
}

function validateGlobalFields(fields: readonly { arg?: unknown; key: string }[]) {
  const positional = fields.find((field) => field.arg !== undefined)
  if (positional) {
    throw new Error(`Global options cannot be positional: ${positional.key}`)
  }
}

function validateOptionCollisions(
  commands: readonly { fields: readonly { option: string; short?: string; key: string }[] }[],
  globalFields: readonly { option: string; short?: string; key: string }[],
) {
  for (const command of commands) {
    for (const global of globalFields) {
      const collision = command.fields.find(
        (field) =>
          field.option === global.option ||
          (field.short !== undefined && field.short === global.short),
      )
      if (collision) {
        throw new Error(`Global option collides with command option: ${global.key}`)
      }
    }
  }
}

function defaultArgv(): readonly string[] {
  return typeof process !== "undefined" ? process.argv.slice(2) : []
}
