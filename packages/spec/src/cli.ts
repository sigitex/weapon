import type { TransportConfig } from "./spec"

/** Creates a declarative CLI transport for a spec. */
export function cli<const Config extends CliConfig = CliConfig>(
  config: Config = {} as Config,
): TransportConfig<Config, CliOperationConfig> {
  return {
    kind: "transport",
    config,
  }
}

/** Spec-level CLI metadata used by generated help. */
export type CliConfig = {
  readonly name?: string
  readonly description?: string
}

/** Structured per-operation CLI command config. */
export type CliCommandConfig = {
  readonly command?: string
  readonly aliases?: readonly string[]
  readonly description?: string
  readonly hidden?: boolean
  readonly format?: "json" | "text" | "silent"
}

/** Per-operation CLI config shared by low-level specs and high-level commands. */
export type CliOperationConfig = false | true | string | CliCommandConfig

/** Field-level CLI metadata attached to ArkType field schemas. */
export type CliFieldMetadata = {
  readonly arg?: true | number | { readonly name?: string; readonly index?: number }
  readonly option?: true | string
  readonly short?: string
  readonly hidden?: boolean
}
