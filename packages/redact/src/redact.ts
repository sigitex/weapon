import { randomUUID } from "node:crypto"
import type { BaseRoot } from "@ark/schema"
import type { Type } from "arktype"

const defaultSalt = randomUUID()

export function redact<T>(
  type: Type<T>,
  value: T,
  options?: {
    redactValue?: RedactValue
  },
): T {
  const fn = options?.redactValue ?? redact.mask
  return traverse(type.internal, value, fn) as T
}

function traverse(node: BaseRoot, value: unknown, fn: RedactValue): unknown {
  if (node.hasKind("morph")) {
    return traverse(node.rawIn, value, fn)
  }

  if (node.hasKind("union")) {
    const match = node.branches.find((b) => b.allows(value))
    if (match) return traverse(match, value, fn)
  }

  if (node.hasKind("intersection") && node.structure) {
    const { structure } = node

    if (structure.sequence && Array.isArray(value)) {
      const { variadic } = structure.sequence
      if (variadic) {
        return (value as unknown[]).map((item) => traverse(variadic, item, fn))
      }
      return value
    }

    if (value !== null && typeof value === "object") {
      const result: Record<string, unknown> = { ...(value as object) }
      for (const prop of structure.props) {
        const key = prop.key as string
        if (key in result) {
          result[key] = traverse(prop.value, result[key], fn)
        }
      }
      return result
    }
  }

  const meta = node.attachments.meta as { sensitive?: boolean }
  if (meta.sensitive === true && isRedactable(value)) {
    return fn(value)
  }

  return value
}

function isRedactable(value: unknown): value is RedactValueType {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean" ||
    value === null ||
    value === undefined ||
    value instanceof Date
  )
}

export type RedactValueType =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | Date

// uses typeof / instanceof checks internally — no arktype involvement at the leaf level
export type RedactValue = <Value extends RedactValueType>(value: Value) => Value

export namespace redact {
  export function mask<Value extends RedactValueType>(value: Value): Value {
    if (typeof value === "string") {
      return "*".repeat(value.length) as Value
    }
    if (typeof value === "number") {
      return 0 as Value
    }
    if (typeof value === "bigint") {
      return 0n as Value
    }
    if (value instanceof Date) {
      return new Date(0) as Value
    }
    return value
  }

  export function hash(salt?: string): RedactValue {
    const s = salt ?? defaultSalt
    return <Value extends RedactValueType>(value: Value): Value => {
      if (typeof value === "string") {
        return fnv1a(s + value).toString(36) as Value
      }
      if (typeof value === "number") {
        return Number(fnv1a(s + String(value))) as Value
      }
      if (typeof value === "bigint") {
        return fnv1a(s + String(value)) as Value
      }
      if (value instanceof Date) {
        return new Date(Number(fnv1a(s + value.toISOString()))) as Value
      }
      return value
    }
  }
}

function fnv1a(input: string): bigint {
  let hash = 0xcbf29ce484222325n
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash
}
