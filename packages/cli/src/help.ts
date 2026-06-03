import type { CliConfig } from "@weapon/spec"
import type { CliField, CliMountedCommand } from "./types"

export function rootHelp(
  config: CliConfig | undefined,
  commands: readonly CliMountedCommand[],
  globalFields: readonly CliField[] = [],
): string {
  const lines = [config?.name ?? "Commands"]
  if (config?.description) {
    lines.push("", config.description)
  }
  lines.push(
    "",
    "Usage:",
    `  ${config?.name ?? "command"} <command> [options]`,
    "",
    "Commands:",
  )
  const visible = commands.filter((c) => !c.hidden)
  for (const command of visible) {
    lines.push(
      `  ${pad(command.path.join(" "), 24)}${command.description ?? ""}`.trimEnd(),
    )
  }
  lines.push(`  ${pad("help", 24)}Show help`.trimEnd())
  addFields(lines, "Global Options:", globalFields.filter((f) => !f.hidden))
  return lines.join("\n")
}

export function commandHelp(
  command: CliMountedCommand,
  globalFields: readonly CliField[] = [],
): string {
  const commandPath = command.path.join(" ")
  const lines = [commandPath || "root"]
  if (command.description) {
    lines.push("", command.description)
  }
  lines.push(
    "",
    "Usage:",
    `  ${commandPath} ${usageFields(command, globalFields)}`.trimEnd(),
  )
  const args = command.fields.filter((f) => f.arg !== undefined && !f.hidden)
  const opts = command.fields.filter((f) => f.arg === undefined && !f.hidden)
  if (args.length > 0) {
    lines.push("", "Arguments:")
    for (const field of args) {
      lines.push(
        `  ${pad(argName(field), 24)}${field.description ?? field.key}`.trimEnd(),
      )
    }
  }
  addFields(lines, "Options:", opts)
  addFields(lines, "Global Options:", globalFields.filter((f) => !f.hidden))
  return lines.join("\n")
}

export function stripHelpTokens(argv: readonly string[]): string[] {
  return argv.filter((arg) => arg !== "--help" && arg !== "-h")
}

export function isRootHelp(argv: readonly string[]): boolean {
  return (
    argv.length === 1 &&
    (argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help")
  )
}

function usageFields(
  command: CliMountedCommand,
  globalFields: readonly CliField[],
): string {
  const args = command.fields
    .filter((f) => f.arg !== undefined && !f.hidden)
    .map((f) => `<${argName(f)}>`)
  const hasOptions = [...command.fields, ...globalFields].some(
    (f) => f.arg === undefined && !f.hidden,
  )
  return [...args, hasOptions ? "[options]" : ""].filter(Boolean).join(" ")
}

function addFields(lines: string[], title: string, fields: readonly CliField[]) {
  if (fields.length === 0) {
    return
  }
  lines.push("", title)
  for (const field of fields) {
    const name = `${field.short ? `-${field.short}, ` : ""}--${field.option}${field.boolean ? "" : ` <${field.key}>`}`
    lines.push(`  ${pad(name, 24)}${field.description ?? field.key}`.trimEnd())
  }
}

function pad(text: string, width: number): string {
  return text + " ".repeat(Math.max(1, width - text.length))
}

function argName(field: CliField): string {
  return typeof field.arg === "object" && field.arg.name
    ? field.arg.name
    : field.key
}
