import "@weapon/runtime"

declare global {
  interface Env {}
}

declare module "node:crypto" {
  export function randomUUID(): `${string}-${string}-${string}-${string}-${string}`
}
