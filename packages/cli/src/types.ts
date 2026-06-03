import type { Container } from "@sigitex/bind"
import type { Type } from "arktype"
import type { Executor, MountedOperation } from "@weapon/spec"

export type CliRuntimeConfig = {
  readonly container?: Container
  readonly stdout?: (text: string) => void | Promise<void>
  readonly stderr?: (text: string) => void | Promise<void>
  readonly options?: Type
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
  readonly arg?:
    | true
    | number
    | { readonly name?: string; readonly index?: number }
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

export type CliCommandMatch = {
  readonly command: CliMountedCommand
  readonly rest: readonly string[]
}
