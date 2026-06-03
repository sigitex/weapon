import type { CliCommandMatch, CliMountedCommand } from "./types"

export function findCommand(
  commands: readonly CliMountedCommand[],
  argv: readonly string[],
): CliCommandMatch | undefined {
  const candidates = commands
    .flatMap((command) =>
      [command.path, ...command.aliases].map((path) => ({ command, path })),
    )
    .toSorted((a, b) => b.path.length - a.path.length)

  for (const candidate of candidates) {
    if (candidate.path.every((part, index) => argv[index] === part)) {
      return {
        command: candidate.command,
        rest: argv.slice(candidate.path.length),
      }
    }
  }
}

export function commandGuess(argv: readonly string[]): string {
  return argv.find((arg) => !arg.startsWith("-")) ?? ""
}
