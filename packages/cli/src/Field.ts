// oxlint-disable typescript/no-explicit-any
import type { CliFieldMetadata } from "@weapon/spec"

export type Field = {
  readonly key: string
  readonly option: string
  readonly short?: string
  readonly arg?:
    | true
    | number
    | { readonly name?: string; readonly index?: number }
  readonly hidden: boolean
  readonly description?: string
  readonly boolean: boolean
  readonly array: boolean
}

export namespace Field {
  export function fromType(input: unknown): Field[] {
    const type = input as any
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

  export function positionalIndex(field: Field): number {
    if (typeof field.arg === "number") {
      return field.arg
    }
    if (typeof field.arg === "object" && typeof field.arg.index === "number") {
      return field.arg.index
    }
    throw new Error(`Missing positional index: ${field.key}`)
  }

  export function validatePositionals(fields: readonly Field[]) {
    const positionalFields = fields.filter((field) => field.arg !== undefined)
    if (positionalFields.length <= 1) {
      return
    }
    const seen = new Set<number>()
    for (const field of positionalFields) {
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

  // oxlint-disable-next-line complexity
  export function parseGlobalOptions(
    fields: readonly Field[],
    argv: readonly string[],
  ): { input: Record<string, unknown>; argv: string[] } {
    const byOption = new Map(fields.map((field) => [field.option, field]))
    const byShort = new Map(
      fields
        .filter((field) => field.short)
        .map((field) => [field.short, field]),
    )
    const input: Record<string, unknown> = {}
    const rest: string[] = []
    let options = true

    for (let i = 0; i < argv.length; i++) {
      const token = argv[i]
      if (options && token === "--") {
        options = false
        rest.push(token)
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
          rest.push(token)
          continue
        }
        if (negated) {
          if (!field.boolean) {
            throw new Error(`Cannot negate non-boolean option: --${name}`)
          }
          set(input, field, false)
        } else if (field.boolean && inline === undefined) {
          set(input, field, true)
        } else {
          const value = inline ?? argv[++i]
          if (value === undefined) {
            throw new Error(`Missing value for --${name}`)
          }
          set(input, field, value)
        }
        continue
      }

      if (options && token.startsWith("-") && token !== "-") {
        const raw = token.slice(1)
        if (raw.length > 1) {
          const fields = [...raw].map((short) => byShort.get(short))
          if (fields.every((field) => field?.boolean)) {
            for (const field of fields) {
              set(input, field!, true)
            }
            continue
          }
        } else {
          const field = byShort.get(raw)
          if (field) {
            if (field.boolean) {
              set(input, field, true)
            } else {
              const value = argv[++i]
              if (value === undefined) {
                throw new Error(`Missing value for -${raw}`)
              }
              set(input, field, value)
            }
            continue
          }
        }
      }

      rest.push(token)
    }

    return { input, argv: rest }
  }

  export function validateGlobal(fields: readonly Field[]) {
    const positional = fields.find((field) => field.arg !== undefined)
    if (positional) {
      throw new Error(`Global options cannot be positional: ${positional.key}`)
    }
  }
}

function set(input: Record<string, unknown>, field: Field, value: unknown) {
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

function isBooleanType(type: any): boolean {
  return (
    type?.expression === "boolean" ||
    JSON.stringify(type?.json).includes('"unit":true')
  )
}

function isArrayType(type: any): boolean {
  return type?.json?.proto === "Array" || type?.expression?.endsWith("[]")
}
