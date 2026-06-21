export function formatOutput(
  output: unknown,
  format?: "json" | "text" | "silent",
): string | undefined {
  if (format === "silent" || output === undefined) {
    return undefined
  }
  if (format === "json") {
    return JSON.stringify(output)
  }
  if (format === "text") {
    return String(output)
  }
  if (output === null || typeof output === "object") {
    return JSON.stringify(output)
  }
  return String(output)
}

export function withNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`
}
