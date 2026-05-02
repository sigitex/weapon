import type { distill, Type } from "arktype"

type Out<T> = distill.Out<T>

export function fromRow<T>(type: Type<T>, row: SnakeKeyed<Out<T>>): Out<T>
export function fromRow<T>(type: Type<T>): (row: SnakeKeyed<Out<T>>) => Out<T>
export function fromRow<T>(type: Type<T>, row?: SnakeKeyed<Out<T>>): Out<T> | ((row: SnakeKeyed<Out<T>>) => Out<T>) {
  if (!row) return (row: SnakeKeyed<Out<T>>) => mapRow(type, row)
  return mapRow(type, row)
}

export type SnakeKeyed<T> = { [K in keyof T & string as CamelToSnake<K>]: unknown }

type CamelToSnake<S extends string> =
  S extends `${infer C}${infer Rest}`
    ? C extends Uppercase<C>
      ? C extends Lowercase<C>
        ? `${C}${CamelToSnake<Rest>}`
        : `_${Lowercase<C>}${CamelToSnake<Rest>}`
      : `${C}${CamelToSnake<Rest>}`
    : S

// --- Internals ---

function mapRow<T>(type: Type<T>, row: SnakeKeyed<Out<T>>): Out<T> {
  const mapped: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
    mapped[snakeToCamel(key)] = value
  }
  return type.assert(mapped) as Out<T>
}

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}
