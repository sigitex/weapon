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
import {
  type CliHost,
  type CliRuntimeConfig,
  CliHost as CliHostRuntime,
} from "./CliHost"
import { ArkTypeField } from "./ArkTypeField"

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
  const protocol = createProtocol(config)
  const protocolKeys = Object.keys(protocol)
  const operations = extractOperations(config, protocolKeys)
  const normalized = normalizeOperations(operations, protocolKeys)
  const appSpec = spec(protocol, normalized.definition as any)
  const service = appSpec.contract.service(normalized.service as any)
  const middleware = createMiddlewareMap(appSpec, config)
  const exec = executor(appSpec as any, { middleware, services: [service] })
  const host = CliHostRuntime.create(protocol.cli, exec, config)
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

function createProtocol<const Protocol extends DefinesProtocol>(
  config: CommandConfig<Protocol>,
): { readonly cli: ReturnType<typeof cli> } & Protocol {
  if ((config.protocol as Record<string, unknown> | undefined)?.cli) {
    throw new Error("protocol.cli is reserved")
  }
  return {
    cli: cli({ name: config.name, description: config.description }),
    ...config.protocol,
  } as any
}

function createMiddlewareMap<const Protocol extends DefinesProtocol>(
  appSpec: any,
  config: CommandConfig<Protocol>,
) {
  return Object.fromEntries(
    Object.keys(appSpec.middleware).map((key) => {
      const implementation = (
        config.middleware as Record<string, unknown> | undefined
      )?.[key]
      if (implementation === undefined) {
        throw new Error(`Missing middleware implementation: ${key}`)
      }
      return [key, implementation]
    }),
  ) as any
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

function extractOperations(
  config: Record<string, unknown>,
  protocolKeys: readonly string[],
): CommandOperations {
  const out: Record<string, CommandOperation | CommandOperations> = {}
  const root = extractRootOperation(config, protocolKeys)
  const hasRoot = root !== undefined
  if (root) {
    out.$root = root
  }
  for (const [key, value] of Object.entries(config)) {
    if (appKeys.has(key)) {
      continue
    }
    if (hasRoot && isRootOperationKey(key, protocolKeys)) {
      continue
    }
    if (key === "operations") {
      throw new Error(
        "command() uses top-level operations; remove the operations wrapper",
      )
    }
    if (value && typeof value === "object") {
      out[key] = value as CommandOperation | CommandOperations
      continue
    }
    throw new Error(`Command entry must be an object: ${key}`)
  }
  return out
}

const rootKeys = new Set(["input", "output", "run", "cli", "description"])

function extractRootOperation(
  config: Record<string, unknown>,
  protocolKeys: readonly string[],
): CommandOperation | undefined {
  const hasRootFields =
    typeof config.run === "function" ||
    "input" in config ||
    "output" in config ||
    "cli" in config ||
    protocolKeys.some((key) => key in config)
  if (!hasRootFields) {
    return undefined
  }
  if (typeof config.run !== "function") {
    throw new Error("Root command requires run")
  }
  const root: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(config)) {
    if (isRootOperationKey(key, protocolKeys)) {
      root[key] = value
    }
  }
  if (config.description !== undefined) {
    root.description = config.description
  }
  root.cli = rootCli(config.cli)
  root.run = config.run as CommandOperation["run"]
  return root as CommandOperation
}

function isRootOperationKey(
  key: string,
  protocolKeys: readonly string[],
): boolean {
  return rootKeys.has(key) || protocolKeys.includes(key)
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

type NormalizedOperations = {
  readonly definition: Record<string, unknown>
  readonly service: Record<string, unknown>
}

function normalizeOperations(
  operations: CommandOperations,
  protocolKeys: readonly string[],
): NormalizedOperations {
  const definition: Record<string, unknown> = {}
  const service: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(operations)) {
    if (isCommandOperation(value)) {
      const { run: _run, ...operationDefinition } = value
      definition[key] = {
        ...operationDefinition,
        input: value.input ?? type({}),
        output: value.output ?? type("unknown"),
        cli: value.cli ?? true,
      }
      service[key] = value.run
    } else if (looksLikeOperation(value, protocolKeys)) {
      throw new Error(`Command operation requires run: ${key}`)
    } else {
      const normalized = normalizeOperations(
        value as CommandOperations,
        protocolKeys,
      )
      definition[key] = normalized.definition
      service[key] = normalized.service
    }
  }
  return { definition, service }
}

function isCommandOperation(value: unknown): value is CommandOperation {
  if (!value || typeof value !== "object") {
    return false
  }
  return typeof (value as Record<string, unknown>).run === "function"
}

function looksLikeOperation(
  value: unknown,
  protocolKeys: readonly string[],
): boolean {
  if (!value || typeof value !== "object") {
    return false
  }
  return ["input", "output", "cli", "description", "run", ...protocolKeys].some(
    (key) => key in value,
  )
}

export type CommandFieldOptions = ArkTypeField.Options

function withCliMetadata<T extends Type>(
  field: T,
  options: CommandFieldOptions = {},
): T {
  return ArkTypeField.configure(field, options)
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
