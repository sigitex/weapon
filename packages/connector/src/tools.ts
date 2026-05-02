/** biome-ignore-all lint/suspicious/noExplicitAny: intent */
import type { MountedOperation, McpOperationConfig, McpToolHints } from "@weapon/spec"

/** MCP tool definition matching the protocol spec. */
export type McpTool = {
  readonly name: string
  readonly description?: string
  readonly inputSchema: Record<string, unknown>
  readonly annotations?: {
    readonly title?: string
    readonly readOnlyHint?: boolean
    readonly destructiveHint?: boolean
    readonly idempotentHint?: boolean
    readonly openWorldHint?: boolean
  }
}

/** A mounted operation paired with its MCP tool definition. */
export type McpMountedTool = {
  readonly mounted: MountedOperation
  readonly tool: McpTool
}

/** Filters executor operations to those with MCP config and maps them to tool definitions. */
export function mapTools(operations: MountedOperation[]): McpMountedTool[] {
  const tools: McpMountedTool[] = []
  for (const mounted of operations) {
    const mcpConfig = (mounted.definition as Record<string, unknown>).mcp as
      | McpOperationConfig
      | undefined
    if (mcpConfig === undefined) continue
    tools.push({ mounted, tool: mapOperationToTool(mounted, mcpConfig) })
  }
  return tools
}

function mapOperationToTool(
  mounted: MountedOperation,
  config: McpOperationConfig,
): McpTool {
  const hints = typeof config === "object" ? config : undefined
  const name = hints?.name ?? mounted.key
  const description =
    typeof config === "string"
      ? config
      : mounted.definition.description
  const inputSchema = mounted.definition.input.toJsonSchema({ dialect: null }) as Record<string, unknown>
  const annotations = hints ? mapAnnotations(hints) : undefined

  return {
    name,
    ...(description !== undefined && { description }),
    inputSchema,
    ...(annotations !== undefined && { annotations }),
  }
}

function mapAnnotations(hints: McpToolHints): McpTool["annotations"] | undefined {
  const { readOnly, destructive, idempotent, openWorld } = hints
  if (
    readOnly === undefined &&
    destructive === undefined &&
    idempotent === undefined &&
    openWorld === undefined
  ) {
    return undefined
  }
  return {
    ...(readOnly !== undefined && { readOnlyHint: readOnly }),
    ...(destructive !== undefined && { destructiveHint: destructive }),
    ...(idempotent !== undefined && { idempotentHint: idempotent }),
    ...(openWorld !== undefined && { openWorldHint: openWorld }),
  }
}
