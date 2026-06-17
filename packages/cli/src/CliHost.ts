import { Container } from "@sigitex/bind"
import type {
  CliConfig,
  CliOperationConfig,
  Executor,
  TransportConfig,
} from "@weapon/spec"
import type { Type } from "arktype"
import { Field } from "./Field"
import { MountedCommand } from "./MountedCommand"
import { formatOutput, isArkErrors, withNewline } from "./output"
export type { Field } from "./Field"
export type { MountedCommand } from "./MountedCommand"

export type CliRuntimeConfig = {
  readonly container?: Container
  readonly stdout?: (text: string) => void | Promise<void>
  readonly stderr?: (text: string) => void | Promise<void>
  readonly options?: Type
}

export type CliHost = {
  readonly executor: Executor
  readonly commands: MountedCommand[]
  readonly run: (argv?: readonly string[]) => Promise<number>
  readonly main: (argv?: readonly string[]) => Promise<void>
  readonly help: (argv?: readonly string[]) => string
}

declare const process:
  | {
      argv: string[]
      exitCode?: number
      stdout: { write(text: string): void }
      stderr: { write(text: string): void }
    }
  | undefined

export namespace CliHost {
  export function create<const Config extends CliConfig>(
    transport: TransportConfig<Config, CliOperationConfig>,
    executor: CliHost["executor"],
    config: CliRuntimeConfig = {},
  ): CliHost {
    const commands = MountedCommand.fromOperations(executor.operations)
    const globalFields = config.options ? Field.fromType(config.options) : []
    Field.validateGlobal(globalFields)
    validateOptionCollisions(commands, globalFields)
    const stdout =
      config.stdout ?? ((text: string) => process?.stdout.write(text))
    const stderr =
      config.stderr ?? ((text: string) => process?.stderr.write(text))

    function help(argv: readonly string[] = []): string {
      const args = MountedCommand.stripHelpTokens(argv)
      if (args.length === 0) {
        return MountedCommand.rootHelp(transport.config, commands, globalFields)
      }
      const match = MountedCommand.match(commands, args)
      if (!match || match.rest.length > 0) {
        throw new Error(`Unknown command: ${args.join(" ")}`)
      }
      return MountedCommand.help(match.command, globalFields)
    }

    async function run(
      argv: readonly string[] = defaultArgv(),
    ): Promise<number> {
      try {
        const global = Field.parseGlobalOptions(globalFields, argv)
        const args = global.argv
        const validatedGlobalOptions = config.options
          ? config.options(global.input)
          : {}
        if (isArkErrors(validatedGlobalOptions)) {
          await stderr(withNewline(String(validatedGlobalOptions)))
          await stderr(
            withNewline(
              MountedCommand.rootHelp(transport.config, commands, globalFields),
            ),
          )
          return 1
        }

        if (args.length === 0 || MountedCommand.isRootHelp(args)) {
          const root = MountedCommand.match(commands, [])
          if (args.length === 0 && root) {
            return await runCommand(root, [], validatedGlobalOptions)
          }
          await stdout(
            withNewline(
              MountedCommand.rootHelp(transport.config, commands, globalFields),
            ),
          )
          return 0
        }

        if (args[0] === "help") {
          const target = args.slice(1)
          await stdout(withNewline(help(target)))
          return 0
        }

        const match = MountedCommand.match(commands, args)
        if (!match) {
          await stderr(
            withNewline(`Unknown command: ${MountedCommand.guess(args)}`),
          )
          await stderr(
            withNewline(
              MountedCommand.rootHelp(transport.config, commands, globalFields),
            ),
          )
          return 1
        }

        if (match.rest.includes("--help") || match.rest.includes("-h")) {
          await stdout(
            withNewline(MountedCommand.help(match.command, globalFields)),
          )
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
      match: MountedCommand.Match,
      argv: readonly string[],
      options: unknown,
    ): Promise<number> {
      try {
        const input = MountedCommand.parseInput(match.command, argv)
        const validation = match.command.mounted.definition.input(input)
        if (isArkErrors(validation)) {
          await stderr(withNewline(String(validation)))
          await stderr(
            withNewline(MountedCommand.help(match.command, globalFields)),
          )
          return 1
        }

        const container = config.container
          ? config.container.clone()
          : new Container()
        container.bind({ cli: { options } })
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
}

export function cliHost<const Config extends CliConfig>(
  transport: TransportConfig<Config, CliOperationConfig>,
  executor: CliHost["executor"],
  config: CliRuntimeConfig = {},
): CliHost {
  return CliHost.create(transport, executor, config)
}

function validateOptionCollisions(
  commands: readonly MountedCommand[],
  globalFields: readonly Field[],
) {
  for (const command of commands) {
    for (const global of globalFields) {
      const collision = command.fields.find(
        (field) =>
          field.option === global.option ||
          (field.short !== undefined && field.short === global.short),
      )
      if (collision) {
        throw new Error(
          `Global option collides with command option: ${global.key}`,
        )
      }
    }
  }
}

function defaultArgv(): readonly string[] {
  return typeof process !== "undefined" ? process.argv.slice(2) : []
}
