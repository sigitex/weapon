// oxlint-disable typescript/no-explicit-any
import { type, type Type } from "arktype"
import {
  type BoundService,
  type CliFieldMetadata,
  type ConfigOf,
  type DefinesProtocol,
  type MiddlewareKeysOf,
  type OperationMiddleware,
  cli,
  executor,
  spec,
} from "@weapon/spec"
import { type CliHost, type CliRuntimeConfig, cliHost } from "./host"

export type CommandConfig<Protocol extends DefinesProtocol = {}> =
  CliRuntimeConfig & {
    readonly name?: string
    readonly description?: string
    readonly options?: Type
    readonly protocol?: Protocol
    readonly middleware?: {
      readonly [K in MiddlewareKeysOf<Protocol>]?: OperationMiddleware<
        ConfigOf<Protocol[K]>
      >
    }
    readonly [key: string]: unknown
  }

export type CommandApp = CliHost & {
  readonly spec: ReturnType<typeof spec>
  readonly services: readonly BoundService[]
}

export type CommandOperations = {
  readonly [key: string]: CommandOperation | CommandOperations
}

export type CommandOperation = {
  readonly input?: Type
  readonly output?: Type
  readonly description?: string
  readonly cli?: unknown
  readonly run: (input: any, context: any) => unknown | Promise<unknown>
  readonly [key: string]: unknown
}

function commandFn<const Protocol extends DefinesProtocol = {}>(
  config: CommandConfig<Protocol>,
): CommandApp {
  const protocol = {
    cli: cli({ name: config.name, description: config.description }),
    ...config.protocol,
  } as any
  if ((config.protocol as Record<string, unknown> | undefined)?.cli) {
    throw new Error("protocol.cli is reserved")
  }

  const operations = extractOperations(config)
  const contractDefinition = normalizeDefinition(operations)
  const appSpec = spec(protocol, contractDefinition as any)
  const service = appSpec.contract.service(
    normalizeService(operations) as any,
  )
  const middleware = Object.fromEntries(
    Object.keys(appSpec.middleware).map((key) => [
      key,
      (config.middleware as Record<string, unknown> | undefined)?.[key],
    ]),
  ) as any
  const exec = executor(appSpec as any, { middleware, services: [service] })
  const host = cliHost(protocol.cli, exec, config)
  return {
    spec: appSpec as any,
    services: [service as any],
    executor: exec,
    commands: host.commands,
    run: host.run,
    main: host.main,
    help: host.help,
  }
}

const appKeys = new Set([
  "name",
  "description",
  "protocol",
  "middleware",
  "options",
  "container",
  "stdout",
  "stderr",
])

function extractOperations(config: Record<string, unknown>): CommandOperations {
  const out: Record<string, CommandOperation | CommandOperations> = {}
  const root = extractRootOperation(config)
  const hasRoot = root !== undefined
  if (root) {
    out.$root = root
  }
  for (const [key, value] of Object.entries(config)) {
    if (appKeys.has(key)) {
      continue
    }
    if (hasRoot && rootKeys.has(key)) {
      continue
    }
    if (key === "operations") {
      throw new Error("command() uses top-level operations; remove the operations wrapper")
    }
    if (value && typeof value === "object") {
      out[key] = value as CommandOperation | CommandOperations
      continue
    }
    throw new Error(`Command entry must be an object: ${key}`)
  }
  return out
}

const rootKeys = new Set(["input", "output", "run", "cli"])

function extractRootOperation(config: Record<string, unknown>): CommandOperation | undefined {
  const hasRootFields =
    typeof config.run === "function" ||
    "input" in config ||
    "output" in config ||
    "cli" in config
  if (!hasRootFields) {
    return undefined
  }
  if (typeof config.run !== "function") {
    throw new Error("Root command requires run")
  }
  return {
    input: config.input as Type | undefined,
    output: config.output as Type | undefined,
    cli: rootCli(config.cli),
    run: config.run as CommandOperation["run"],
  }
}

function rootCli(value: unknown): unknown {
  if (value === false) {
    return false
  }
  if (typeof value === "object" && value !== null) {
    return { ...value, command: "" }
  }
  return { command: "" }
}

function normalizeDefinition(
  operations: CommandOperations,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(operations)) {
    if (isCommandOperation(value)) {
      const { run: _run, ...definition } = value
      out[key] = {
        ...definition,
        input: value.input ?? type({}),
        output: value.output ?? type("unknown"),
        cli: value.cli ?? true,
      }
    } else if (looksLikeOperation(value)) {
      throw new Error(`Command operation requires run: ${key}`)
    } else {
      out[key] = normalizeDefinition(value as CommandOperations)
    }
  }
  return out
}

function normalizeService(
  operations: CommandOperations,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(operations)) {
    if (isCommandOperation(value)) {
      out[key] = value.run
    } else {
      out[key] = normalizeService(value as CommandOperations)
    }
  }
  return out
}

function isCommandOperation(value: unknown): value is CommandOperation {
  if (!value || typeof value !== "object") {
    return false
  }
  return "run" in value
}

function looksLikeOperation(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false
  }
  return ["input", "output", "cli", "description"].some((key) => key in value)
}

export type CommandFieldOptions = CliFieldMetadata & {
  readonly description?: string
  readonly label?: string
}

function withCliMetadata<T extends Type>(
  field: T,
  options: CommandFieldOptions = {},
): T {
  const { description, label, ...cliMeta } = options
  return field.configure({
    ...(description !== undefined && { description }),
    ...(label !== undefined && { label }),
    meta: { cli: { option: true, ...cliMeta } },
  } as any) as T
}

export const command = Object.assign(commandFn, {
  string(options?: CommandFieldOptions) {
    return withCliMetadata(type("string"), options)
  },
  integer(options?: CommandFieldOptions) {
    return withCliMetadata(type("string.integer.parse"), options)
  },
  number(options?: CommandFieldOptions) {
    return withCliMetadata(type("string.numeric.parse"), options)
  },
  boolean(options?: CommandFieldOptions) {
    return withCliMetadata(type("boolean"), options)
  },
})
