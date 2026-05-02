type Hash = {
  update(data: string): Hash
  digest(encoding: "hex"): string
}

declare module "node:crypto" {
  export function createHash(algorithm: string): Hash
  export function randomUUID(): `${string}-${string}-${string}-${string}-${string}`
}
