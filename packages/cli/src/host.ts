// oxlint-disable typescript/no-explicit-any
import { Container } from "@sigitex/bind"
import type {
  CliCommandConfig,
  CliConfig,
  CliFieldMetadata,
  CliOperationConfig,
  Executor,
  MountedOperation,
  TransportConfig,
} from "@weapon/spec"

declare const process: {
  argv: string[]
  exitCode?: number
  stdout: { write(text: string): void }
  stderr: { write(text: string): void }
} | undefined

export type CliRuntimeConfig = {
  readonly container?: Container
  readonly stdout?: (text: string) => void | Promise<void>
  readonly stderr?: (text: string) => void | Promise<void>
}

export type CliMountedCommand = {
  readonly mounted: MountedOperation
  readonly path: readonly string[]
  readonly aliases: readonly (readonly string[])[]
  readonly description?: string
  readonly hidden: boolean
  readonly format?: "json" | "text" | "silent"
  readonly fields: readonly CliField[]
}

export type CliField = {
  readonly key: string
  readonly option: string
  readonly short?: string
  readonly arg?: true | number | { readonly name?: string; readonly index?: number }
  readonly hidden: boolean
  readonly description?: string
  readonly boolean: boolean
  readonly array: boolean
}

export type CliHost = {
  readonly executor: Executor
  readonly commands: CliMountedCommand[]
  readonly run: (argv?: readonly string[]) => Promise<number>
  readonly main: (argv?: readonly string[]) => Promise<void>
  readonly help: (argv?: readonly string[]) => string
}

export function cliHost<const Config extends CliConfig>(
  transport: TransportConfig<Config, CliOperationConfig>,
  executor: Executor,
  config: CliRuntimeConfig = {},
): CliHost {
  const commands = mapCommands(executor.operations)
  const stdout = config.stdout ?? ((text: string) => process?.stdout.write(text))
  const stderr = config.stderr ?? ((text: string) => process?.stderr.write(text))

  function help(argv: readonly string[] = []): string {
    const args = stripHelpTokens(argv)
    if (args.length === 0) return rootHelp(transport.config, commands)
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

      const container = config.container ? config.container.clone() : new Container()
      const response = await executor.handle(
        { mounted: match.command.mounted, input },
        container,
      )
      const text = formatOutput(response.output, match.command.format)
      if (text !== undefined) await stdout(withNewline(text))
      return 0
    } catch (error) {
      await stderr(withNewline(error instanceof Error ? error.message : String(error)))
      return 1
    }
  }

  async function main(argv?: readonly string[]): Promise<void> {
    const code = await run(argv)
    if (process) process.exitCode = code
  }

  return { executor, commands, run, main, help }
}

export function mapCommands(operations: readonly MountedOperation[]): CliMountedCommand[] {
  const commands: CliMountedCommand[] = []
  const claimed = new Map<string, string>()

  for (const mounted of operations) {
    const cli = (mounted.definition as Record<string, unknown>).cli as
      | CliOperationConfig
      | undefined
    if (cli === undefined || cli === false) continue

    const config = typeof cli === "object" ? cli : undefined
    const path = splitCommandPath(
      cli === true ? mounted.path.join(" ") : typeof cli === "string" ? cli : (config?.command ?? mounted.path.join(" ")),
    )
    const aliases = (config?.aliases ?? []).map(splitCommandPath)
    const command: CliMountedCommand = {
      mounted,
      path,
      aliases,
      description: config?.description ?? mounted.definition.description,
      hidden: config?.hidden === true,
      format: config?.format,
      fields: getFields(mounted),
    }

    assertClaim(claimed, path, path.join(" "))
    for (const alias of aliases) assertClaim(claimed, alias, path.join(" "))
    validatePositionals(command)
    commands.push(command)
  }

  return commands.sort((a, b) => a.path.join(" ").localeCompare(b.path.join(" ")))
}

function getFields(mounted: MountedOperation): CliField[] {
  const type = mounted.definition.input as any
  const props = type.structure?.props
  if (!Array.isArray(props)) return []

  return props.map((prop: any) => {
    const value = prop.value
    const meta = value?.meta ?? {}
    const cli = ((meta.meta?.cli ?? meta.cli) ?? {}) as CliFieldMetadata
    const option = cli.option === true || cli.option === undefined ? prop.key : String(cli.option)
    return {
      key: prop.key,
      option,
      short: cli.short,
      arg: cli.arg,
      hidden: cli.hidden === true,
      description: meta.description ?? meta.label,
      boolean: isBooleanType(value),
      array: isArrayType(value),
    }
  })
}

function parseInput(command: CliMountedCommand, argv: readonly string[]): Record<string, unknown> {
  const byOption = new Map(command.fields.map((f) => [f.option, f]))
  const byShort = new Map(command.fields.filter((f) => f.short).map((f) => [f.short, f]))
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
      const [name, inline] = (negated ? raw.slice(3) : raw).split(/=(.*)/s, 2)
      const field = byOption.get(name)
      if (!field) throw new Error(`Unknown option: --${name}`)
      if (negated) {
        if (!field.boolean) throw new Error(`Cannot negate non-boolean option: --${name}`)
        setField(input, field, false)
      } else if (field.boolean && inline === undefined) {
        setField(input, field, true)
      } else {
        const value = inline ?? argv[++i]
        if (value === undefined) throw new Error(`Missing value for --${name}`)
        setField(input, field, value)
      }
      continue
    }
    if (options && token.startsWith("-") && token !== "-") {
      const raw = token.slice(1)
      if (raw.length > 1) {
        const fields = [...raw].map((short) => byShort.get(short))
        if (fields.some((field) => !field)) throw new Error(`Unknown short option: -${raw}`)
        if (fields.some((field) => !field!.boolean)) throw new Error(`Short option clusters only support boolean flags: -${raw}`)
        for (const field of fields) setField(input, field!, true)
      } else {
        const field = byShort.get(raw)
        if (!field) throw new Error(`Unknown short option: -${raw}`)
        if (field.boolean) setField(input, field, true)
        else {
          const value = argv[++i]
          if (value === undefined) throw new Error(`Missing value for -${raw}`)
          setField(input, field, value)
        }
      }
      continue
    }
    positionals.push(token)
  }

  const positionalFields = command.fields.filter((f) => f.arg !== undefined)
  if (positionalFields.length === 1 && positionalFields[0].arg === true) {
    if (positionals[0] !== undefined) input[positionalFields[0].key] = positionals[0]
  } else {
    for (const field of positionalFields) {
      const index = positionalIndex(field)
      if (positionals[index] !== undefined) input[field.key] = positionals[index]
    }
  }

  if (positionals.length > positionalFields.length) {
    throw new Error(`Unexpected positional argument: ${positionals[positionalFields.length]}`)
  }

  return input
}

function setField(input: Record<string, unknown>, field: CliField, value: unknown) {
  if (field.array) {
    const existing = input[field.key]
    input[field.key] = Array.isArray(existing) ? [...existing, value] : [value]
    return
  }
  if (input[field.key] !== undefined) throw new Error(`Repeated option: --${field.option}`)
  input[field.key] = value
}

function validatePositionals(command: CliMountedCommand) {
  const fields = command.fields.filter((f) => f.arg !== undefined)
  if (fields.length <= 1) return
  const seen = new Set<number>()
  for (const field of fields) {
    if (field.arg === true) throw new Error(`Multiple positional fields require indexes: ${field.key}`)
    const index = positionalIndex(field)
    if (seen.has(index)) throw new Error(`Duplicate positional index: ${index}`)
    seen.add(index)
  }
}

function positionalIndex(field: CliField): number {
  if (typeof field.arg === "number") return field.arg
  if (typeof field.arg === "object" && typeof field.arg.index === "number") return field.arg.index
  throw new Error(`Missing positional index: ${field.key}`)
}

function findCommand(commands: readonly CliMountedCommand[], argv: readonly string[]) {
  const candidates = commands.flatMap((command) => [command.path, ...command.aliases].map((path) => ({ command, path })))
  candidates.sort((a, b) => b.path.length - a.path.length)
  for (const candidate of candidates) {
    if (candidate.path.every((part, index) => argv[index] === part)) {
      return { command: candidate.command, rest: argv.slice(candidate.path.length) }
    }
  }
}

function rootHelp(config: CliConfig | undefined, commands: readonly CliMountedCommand[]): string {
  const lines = [config?.name ?? "Commands"]
  if (config?.description) lines.push("", config.description)
  lines.push("", "Usage:", `  ${config?.name ?? "command"} <command> [options]`, "", "Commands:")
  const visible = commands.filter((c) => !c.hidden)
  for (const command of visible) {
    lines.push(`  ${pad(command.path.join(" "), 24)}${command.description ?? ""}`.trimEnd())
  }
  lines.push(`  ${pad("help", 24)}Show help`.trimEnd())
  return lines.join("\n")
}

function commandHelp(command: CliMountedCommand): string {
  const lines = [command.path.join(" ")]
  if (command.description) lines.push("", command.description)
  lines.push("", "Usage:", `  ${command.path.join(" ")} ${usageFields(command)}`.trimEnd())
  const args = command.fields.filter((f) => f.arg !== undefined && !f.hidden)
  const opts = command.fields.filter((f) => f.arg === undefined && !f.hidden)
  if (args.length > 0) {
    lines.push("", "Arguments:")
    for (const field of args) lines.push(`  ${pad(argName(field), 24)}${field.description ?? field.key}`.trimEnd())
  }
  if (opts.length > 0) {
    lines.push("", "Options:")
    for (const field of opts) {
      const name = `${field.short ? `-${field.short}, ` : ""}--${field.option}${field.boolean ? "" : ` <${field.key}>`}`
      lines.push(`  ${pad(name, 24)}${field.description ?? field.key}`.trimEnd())
    }
  }
  return lines.join("\n")
}

function usageFields(command: CliMountedCommand): string {
  const args = command.fields.filter((f) => f.arg !== undefined && !f.hidden).map((f) => `<${argName(f)}>`)
  const hasOptions = command.fields.some((f) => f.arg === undefined && !f.hidden)
  return [...args, hasOptions ? "[options]" : ""].filter(Boolean).join(" ")
}

function formatOutput(output: unknown, format?: "json" | "text" | "silent"): string | undefined {
  if (format === "silent" || output === undefined) return undefined
  if (format === "json") return JSON.stringify(output)
  if (format === "text") return String(output)
  if (output === null || typeof output === "object") return JSON.stringify(output)
  return String(output)
}

function splitCommandPath(path: string): string[] {
  const parts = path.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) throw new Error("Command path cannot be empty")
  return parts
}

function assertClaim(claimed: Map<string, string>, path: readonly string[], owner: string) {
  if (path[0] === "help") throw new Error("Root command path `help` is reserved")
  const key = path.join(" ")
  const previous = claimed.get(key)
  if (previous) throw new Error(`Duplicate command path or alias: ${key} (${previous}, ${owner})`)
  claimed.set(key, owner)
}

function isBooleanType(type: any): boolean {
  return type?.expression === "boolean" || JSON.stringify(type?.json).includes('"unit":true')
}

function isArrayType(type: any): boolean {
  return type?.json?.proto === "Array" || type?.expression?.endsWith("[]")
}

function isArkErrors(value: unknown): boolean {
  return !!value && typeof value === "object" && (value as Record<string, unknown>)[" arkKind"] === "errors"
}

function defaultArgv(): readonly string[] {
  return typeof process !== "undefined" ? process.argv.slice(2) : []
}

function stripHelpTokens(argv: readonly string[]): string[] {
  return argv.filter((arg) => arg !== "--help" && arg !== "-h")
}

function isRootHelp(argv: readonly string[]): boolean {
  return argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help")
}

function commandGuess(argv: readonly string[]): string {
  return argv.find((arg) => !arg.startsWith("-")) ?? ""
}

function withNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`
}

function pad(text: string, width: number): string {
  return text + " ".repeat(Math.max(1, width - text.length))
}

function argName(field: CliField): string {
  return typeof field.arg === "object" && field.arg.name ? field.arg.name : field.key
}
