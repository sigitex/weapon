const nonce = Symbol("csp-nonce")

export const CSP = {
  self: "'self'",
  none: "'none'",
  unsafeInline: "'unsafe-inline'",
  unsafeEval: "'unsafe-eval'",
  unsafeHashes: "'unsafe-hashes'",
  strictDynamic: "'strict-dynamic'",
  nonce,
  wildcard: "*",
  data: "data:",
  blob: "blob:",
  https: "https:",
  wss: "wss:",
} as const

export type CspSource = string | typeof nonce
