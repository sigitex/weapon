import "@weapon/runtime"

declare global {
  declare type MaybePromise<T> = T | Promise<T>
}
