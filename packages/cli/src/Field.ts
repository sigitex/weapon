import { ArkTypeField } from "./ArkTypeField"

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
    return ArkTypeField.read(input)
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
    const seen = new Set<number>()
    for (const field of positionalFields) {
      if (field.arg === true) {
        if (positionalFields.length <= 1) {
          continue
        }
        throw new Error(
          `Multiple positional fields require indexes: ${field.key}`,
        )
      }
      const index = positionalIndex(field)
      if (!Number.isInteger(index) || index < 0) {
        throw new Error(`Invalid positional index: ${field.key}`)
      }
      if (seen.has(index)) {
        throw new Error(`Duplicate positional index: ${index}`)
      }
      seen.add(index)
    }
  }

  export function validateOptions(fields: readonly Field[]) {
    const options = fields.filter((field) => field.arg === undefined)
    const names = new Map<string, string>()
    const shorts = new Map<string, string>()
    for (const field of options) {
      if (field.option === "help" || field.short === "h") {
        throw new Error(`CLI option is reserved for help: ${field.key}`)
      }
      const previousName = names.get(field.option)
      if (previousName) {
        throw new Error(
          `Duplicate CLI option: --${field.option} (${previousName}, ${field.key})`,
        )
      }
      names.set(field.option, field.key)
      if (field.short === undefined) {
        continue
      }
      const previousShort = shorts.get(field.short)
      if (previousShort) {
        throw new Error(
          `Duplicate CLI short option: -${field.short} (${previousShort}, ${field.key})`,
        )
      }
      shorts.set(field.short, field.key)
    }
  }

  export function validateGlobalCompatibility(
    globalFields: readonly Field[],
    commandFields: readonly Field[],
  ) {
    for (const global of globalFields) {
      const collision = commandFields.find(
        (field) =>
          field.arg === undefined &&
          (field.option === global.option ||
            (field.short !== undefined && field.short === global.short)),
      )
      if (collision) {
        throw new Error(
          `Global option collides with command option: ${global.key}`,
        )
      }
    }
  }

  export function parseInput(
    fields: readonly Field[],
    argv: readonly string[],
  ): Record<string, unknown> {
    const optionFields = fields.filter((field) => field.arg === undefined)
    const parsed = parseOptions(optionFields, argv, {
      unknown: "throw",
      keepTerminator: false,
    })
    const input = parsed.input
    const positionals = parsed.argv
    const positionalFields = fields.filter((field) => field.arg !== undefined)
    if (positionalFields.length === 1 && positionalFields[0].arg === true) {
      if (positionals[0] !== undefined) {
        input[positionalFields[0].key] = positionals[0]
      }
    } else {
      for (const field of positionalFields) {
        const index = positionalIndex(field)
        if (positionals[index] !== undefined) {
          input[field.key] = positionals[index]
        }
      }
    }

    const allowedPositionals =
      positionalFields.length === 0
        ? 0
        : positionalFields.length === 1 && positionalFields[0].arg === true
          ? 1
          : Math.max(...positionalFields.map(positionalIndex)) + 1

    if (positionals.length > allowedPositionals) {
      throw new Error(
        `Unexpected positional argument: ${positionals[allowedPositionals]}`,
      )
    }

    return input
  }

  // oxlint-disable-next-line complexity
  export function parseGlobalOptions(
    fields: readonly Field[],
    argv: readonly string[],
  ): { input: Record<string, unknown>; argv: string[] } {
    return parseOptions(fields, argv, { unknown: "pass", keepTerminator: true })
  }

  export function validateGlobal(fields: readonly Field[]) {
    const positional = fields.find((field) => field.arg !== undefined)
    if (positional) {
      throw new Error(`Global options cannot be positional: ${positional.key}`)
    }
  }
}

type ParseOptionsConfig = {
  readonly unknown: "throw" | "pass"
  readonly keepTerminator: boolean
}

// oxlint-disable-next-line complexity
function parseOptions(
  fields: readonly Field[],
  argv: readonly string[],
  config: ParseOptionsConfig,
): { input: Record<string, unknown>; argv: string[] } {
  const byOption = new Map(fields.map((field) => [field.option, field]))
  const byShort = new Map(
    fields.filter((field) => field.short).map((field) => [field.short, field]),
  )
  const input: Record<string, unknown> = {}
  const rest: string[] = []
  let options = true

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (options && token === "--") {
      options = false
      if (config.keepTerminator) {
        rest.push(token)
      }
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
        if (config.unknown === "throw") {
          throw new Error(`Unknown option: --${name}`)
        }
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
        const clusterFields = [...raw].map((short) => byShort.get(short))
        if (clusterFields.some((field) => !field)) {
          if (config.unknown === "throw") {
            throw new Error(`Unknown short option: -${raw}`)
          }
        } else if (clusterFields.some((field) => !field!.boolean)) {
          if (config.unknown === "throw") {
            throw new Error(
              `Short option clusters only support boolean flags: -${raw}`,
            )
          }
        } else {
          for (const field of clusterFields) {
            set(input, field!, true)
          }
          continue
        }
      } else {
        const field = byShort.get(raw)
        if (!field) {
          if (config.unknown === "throw") {
            throw new Error(`Unknown short option: -${raw}`)
          }
        } else if (field.boolean) {
          set(input, field, true)
          continue
        } else {
          const value = argv[++i]
          if (value === undefined) {
            throw new Error(`Missing value for -${raw}`)
          }
          set(input, field, value)
          continue
        }
      }
    }
    rest.push(token)
  }

  return { input, argv: rest }
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
