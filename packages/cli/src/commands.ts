// oxlint-disable typescript/no-explicit-any
import type {
  CliFieldMetadata,
  CliOperationConfig,
  MountedOperation,
} from "@weapon/spec"
import type { CliField, CliMountedCommand } from "./types"

export function mapCommands(
  operations: readonly MountedOperation[],
): CliMountedCommand[] {
  const commands: CliMountedCommand[] = []
  const claimed = new Map<string, string>()

  for (const mounted of operations) {
    const cli = (mounted.definition as Record<string, unknown>).cli as
      | CliOperationConfig
      | undefined
    if (cli === undefined || cli === false) {
      continue
    }

    const config = typeof cli === "object" ? cli : undefined
    const path = splitCommandPath(
      cli === true
        ? mounted.path.join(" ")
        : typeof cli === "string"
          ? cli
          : (config?.command ?? mounted.path.join(" ")),
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
    for (const alias of aliases) {
      assertClaim(claimed, alias, path.join(" "))
    }
    validatePositionals(command)
    commands.push(command)
  }

  return commands.toSorted((a, b) =>
    a.path.join(" ").localeCompare(b.path.join(" ")),
  )
}

function getFields(mounted: MountedOperation): CliField[] {
  const type = mounted.definition.input as any
  const props = type.structure?.props
  if (!Array.isArray(props)) {
    return []
  }

  return props.map((prop: any) => {
    const value = prop.value
    const meta = value?.meta ?? {}
    const cli = (meta.meta?.cli ?? meta.cli ?? {}) as CliFieldMetadata
    const option =
      cli.option === true || cli.option === undefined
        ? prop.key
        : String(cli.option)
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

function validatePositionals(command: CliMountedCommand) {
  const fields = command.fields.filter((f) => f.arg !== undefined)
  if (fields.length <= 1) {
    return
  }
  const seen = new Set<number>()
  for (const field of fields) {
    if (field.arg === true) {
      throw new Error(
        `Multiple positional fields require indexes: ${field.key}`,
      )
    }
    const index = positionalIndex(field)
    if (seen.has(index)) {
      throw new Error(`Duplicate positional index: ${index}`)
    }
    seen.add(index)
  }
}

export function positionalIndex(field: CliField): number {
  if (typeof field.arg === "number") {
    return field.arg
  }
  if (typeof field.arg === "object" && typeof field.arg.index === "number") {
    return field.arg.index
  }
  throw new Error(`Missing positional index: ${field.key}`)
}

function splitCommandPath(path: string): string[] {
  const parts = path.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) {
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

function isBooleanType(type: any): boolean {
  return (
    type?.expression === "boolean" ||
    JSON.stringify(type?.json).includes('"unit":true')
  )
}

function isArrayType(type: any): boolean {
  return type?.json?.proto === "Array" || type?.expression?.endsWith("[]")
}
