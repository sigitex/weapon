import { Container } from "@sigitex/bind"
import type { CliConfig, CliOperationConfig, TransportConfig } from "@weapon/spec"
import { mapCommands } from "./commands"
import { commandHelp, isRootHelp, rootHelp, stripHelpTokens } from "./help"
import { commandGuess, findCommand } from "./matching"
import { formatOutput, isArkErrors, withNewline } from "./output"
import { parseInput } from "./parser"
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
  const stdout =
    config.stdout ?? ((text: string) => process?.stdout.write(text))
  const stderr =
    config.stderr ?? ((text: string) => process?.stderr.write(text))

  function help(argv: readonly string[] = []): string {
    const args = stripHelpTokens(argv)
    if (args.length === 0) {
      return rootHelp(transport.config, commands)
    }
    const match = findCommand(commands, args)
    if (!match || match.rest.length > 0) {
      throw new Error(`Unknown command: ${args.join(" ")}`)
    }
    return commandHelp(match.command)
  }

  async function run(argv: readonly string[] = defaultArgv()): Promise<number> {
    const args = [...argv]
    try {
      if (args.length === 0 || isRootHelp(args)) {
        await stdout(withNewline(rootHelp(transport.config, commands)))
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
        await stderr(withNewline(rootHelp(transport.config, commands)))
        return 1
      }

      if (match.rest.includes("--help") || match.rest.includes("-h")) {
        await stdout(withNewline(commandHelp(match.command)))
        return 0
      }

      const input = parseInput(match.command, match.rest)
      const validation = match.command.mounted.definition.input(input)
      if (isArkErrors(validation)) {
        await stderr(withNewline(String(validation)))
        await stderr(withNewline(commandHelp(match.command)))
        return 1
      }

      const container = config.container
        ? config.container.clone()
        : new Container()
      const response = await executor.handle(
        { mounted: match.command.mounted, input },
        container,
      )
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

function defaultArgv(): readonly string[] {
  return typeof process !== "undefined" ? process.argv.slice(2) : []
}
