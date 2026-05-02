import { Router } from "./Router"
import type { RequestHandler, RouterFetch, RouterOptions } from "./router.types"

export type MaybeHandler = RequestHandler | null | undefined | false | 0

export function route(...handlers: MaybeHandler[]): RouterFetch
export function route(
  options: RouterOptions,
  ...handlers: MaybeHandler[]
): RouterFetch
export function route(
  options: RouterOptions | MaybeHandler,
  ...handlers: MaybeHandler[]
) {
  const actualHandlers = handlers.filter((h): h is RequestHandler => !!h)
  const router =
    typeof options === "function"
      ? new Router([options, ...actualHandlers])
      : new Router(actualHandlers, options || undefined)
  return router.route.bind(router)
}
