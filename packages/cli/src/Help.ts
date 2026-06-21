import type { CliConfig } from "@weapon/spec"
import type { Field } from "./Field"
import type { MountedCommand } from "./MountedCommand"

export namespace Help {
  export function root(
    config: CliConfig | undefined,
    commands: readonly MountedCommand[],
    globalFields: readonly Field[] = [],
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
    const visible = commands.filter((command) => !command.hidden)
    for (const command of visible) {
      lines.push(
        `  ${pad(command.path.join(" "), 24)}${command.description ?? ""}`.trimEnd(),
      )
    }
    lines.push(`  ${pad("help", 24)}Show help`.trimEnd())
    addFields(
      lines,
      "Global Options:",
      globalFields.filter((field) => !field.hidden),
    )
    return lines.join("\n")
  }

  export function command(
    command: MountedCommand,
    globalFields: readonly Field[] = [],
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
    const args = command.fields.filter(
      (field) => field.arg !== undefined && !field.hidden,
    )
    const opts = command.fields.filter(
      (field) => field.arg === undefined && !field.hidden,
    )
    if (args.length > 0) {
      lines.push("", "Arguments:")
      for (const field of args) {
        lines.push(
          `  ${pad(argName(field), 24)}${field.description ?? field.key}`.trimEnd(),
        )
      }
    }
    addFields(lines, "Options:", opts)
    addFields(
      lines,
      "Global Options:",
      globalFields.filter((field) => !field.hidden),
    )
    return lines.join("\n")
  }

  export function stripTokens(argv: readonly string[]): string[] {
    return argv.filter((arg) => arg !== "--help" && arg !== "-h")
  }

  export function isRootRequest(argv: readonly string[]): boolean {
    return (
      argv.length === 1 &&
      (argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help")
    )
  }
}

function usageFields(
  command: MountedCommand,
  globalFields: readonly Field[],
): string {
  const args = command.fields
    .filter((field) => field.arg !== undefined && !field.hidden)
    .map((field) => `<${argName(field)}>`)
  const hasOptions = [...command.fields, ...globalFields].some(
    (field) => field.arg === undefined && !field.hidden,
  )
  return [...args, hasOptions ? "[options]" : ""].filter(Boolean).join(" ")
}

function addFields(lines: string[], title: string, fields: readonly Field[]) {
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

function argName(field: Field): string {
  return typeof field.arg === "object" && field.arg.name
    ? field.arg.name
    : field.key
}
