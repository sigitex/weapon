// oxlint-disable typescript/no-explicit-any
import type { CliFieldMetadata } from "@weapon/spec"
import type { Type } from "arktype"
import type { Field } from "./Field"

export namespace ArkTypeField {
  export type Options = CliFieldMetadata & {
    readonly description?: string
    readonly label?: string
  }

  export function read(input: unknown): Field[] {
    const props = schemaProps(input)
    if (!Array.isArray(props)) {
      return []
    }

    return props.map((prop: any) => {
      const value = prop.value
      const cli = cliMetadata(value)
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
        description: fieldDescription(value),
        boolean: isBooleanType(value),
        array: isArrayType(value),
      }
    })
  }

  export function configure<T extends Type>(field: T, options: Options = {}): T {
    const { description, label, ...cliMeta } = options
    return field.configure({
      ...(description !== undefined && { description }),
      ...(label !== undefined && { label }),
      meta: { cli: { option: true, ...cliMeta } },
    } as any) as T
  }
}

function schemaProps(input: unknown): any[] | undefined {
  return (input as any).structure?.props
}

function schemaMeta(type: any): Record<string, any> {
  return type?.meta ?? {}
}

function cliMetadata(type: any): CliFieldMetadata {
  const meta = schemaMeta(type)
  return (meta.meta?.cli ?? meta.cli ?? {}) as CliFieldMetadata
}

function fieldDescription(type: any): string | undefined {
  const meta = schemaMeta(type)
  return meta.description ?? meta.label
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
