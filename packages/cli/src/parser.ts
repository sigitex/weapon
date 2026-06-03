import { positionalIndex } from "./commands"
import type { CliField, CliMountedCommand } from "./types"

// oxlint-disable-next-line complexity
export function parseGlobalOptions(
  fields: readonly CliField[],
  argv: readonly string[],
): { input: Record<string, unknown>; argv: string[] } {
  const byOption = new Map(fields.map((f) => [f.option, f]))
  const byShort = new Map(fields.filter((f) => f.short).map((f) => [f.short, f]))
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
      const [name, inline] = (negated ? raw.slice(3) : raw).split(/[=](.*)/s, 2)
      const field = byOption.get(name)
      if (!field) {
        rest.push(token)
        continue
      }
      if (negated) {
        if (!field.boolean) {
          throw new Error(`Cannot negate non-boolean option: --${name}`)
        }
        setField(input, field, false)
      } else if (field.boolean && inline === undefined) {
        setField(input, field, true)
      } else {
        const value = inline ?? argv[++i]
        if (value === undefined) {
          throw new Error(`Missing value for --${name}`)
        }
        setField(input, field, value)
      }
      continue
    }

    if (options && token.startsWith("-") && token !== "-") {
      const raw = token.slice(1)
      if (raw.length > 1) {
        const fields = [...raw].map((short) => byShort.get(short))
        if (fields.every((field) => field?.boolean)) {
          for (const field of fields) {
            setField(input, field!, true)
          }
          continue
        }
      } else {
        const field = byShort.get(raw)
        if (field) {
          if (field.boolean) {
            setField(input, field, true)
          } else {
            const value = argv[++i]
            if (value === undefined) {
              throw new Error(`Missing value for -${raw}`)
            }
            setField(input, field, value)
          }
          continue
        }
      }
    }

    rest.push(token)
  }

  return { input, argv: rest }
}

// oxlint-disable-next-line complexity
export function parseInput(
  command: CliMountedCommand,
  argv: readonly string[],
): Record<string, unknown> {
  const byOption = new Map(command.fields.map((f) => [f.option, f]))
  const byShort = new Map(
    command.fields.filter((f) => f.short).map((f) => [f.short, f]),
  )
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
      const [name, inline] = (negated ? raw.slice(3) : raw).split(/[=](.*)/s, 2)
      const field = byOption.get(name)
      if (!field) {
        throw new Error(`Unknown option: --${name}`)
      }
      if (negated) {
        if (!field.boolean) {
          throw new Error(`Cannot negate non-boolean option: --${name}`)
        }
        setField(input, field, false)
      } else if (field.boolean && inline === undefined) {
        setField(input, field, true)
      } else {
        const value = inline ?? argv[++i]
        if (value === undefined) {
          throw new Error(`Missing value for --${name}`)
        }
        setField(input, field, value)
      }
      continue
    }
    if (options && token.startsWith("-") && token !== "-") {
      const raw = token.slice(1)
      if (raw.length > 1) {
        const fields = [...raw].map((short) => byShort.get(short))
        if (fields.some((field) => !field)) {
          throw new Error(`Unknown short option: -${raw}`)
        }
        if (fields.some((field) => !field!.boolean)) {
          throw new Error(
            `Short option clusters only support boolean flags: -${raw}`,
          )
        }
        for (const field of fields) {
          setField(input, field!, true)
        }
      } else {
        const field = byShort.get(raw)
        if (!field) {
          throw new Error(`Unknown short option: -${raw}`)
        }
        if (field.boolean) {
          setField(input, field, true)
        } else {
          const value = argv[++i]
          if (value === undefined) {
            throw new Error(`Missing value for -${raw}`)
          }

          setField(input, field, value)
        }
      }
      continue
    }
    positionals.push(token)
  }

  const positionalFields = command.fields.filter((f) => f.arg !== undefined)
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

  if (positionals.length > positionalFields.length) {
    throw new Error(
      `Unexpected positional argument: ${positionals[positionalFields.length]}`,
    )
  }

  return input
}

function setField(
  input: Record<string, unknown>,
  field: CliField,
  value: unknown,
) {
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
