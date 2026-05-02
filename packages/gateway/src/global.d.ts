import "@sigitex/ssjs"

declare global {
  declare type MaybePromise<T> = T | Promise<T>
}
