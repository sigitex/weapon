import "@sigitex/ssjs"

declare global {
  type MaybePromise<T> = T | Promise<T>
}
