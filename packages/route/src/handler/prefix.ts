import type { RequestContext, RequestHandler, RouteMiddleware } from "../router.types"
import { use } from "./use"

export function prefix(
  prefix: string,
  ...handlers: RequestHandler[]
): RequestHandler
export function prefix(
  prefix: string,
  middlewares: RouteMiddleware[],
  ...handlers: RequestHandler[]
): RequestHandler
export function prefix(
  prefix: string,
  head: RouteMiddleware[] | RequestHandler,
  ...tail: RequestHandler[]
): RequestHandler {
  const [middlewares, handlers] = Array.isArray(head)
    ? [head, tail]
    : [[], [head, ...tail]]
  const root = prefix.endsWith("/") ? prefix : prefix + "/"
  const handle = use(middlewares, ...handlers)
  return (context: RequestContext) => {
    if (!context.url.pathname.startsWith(root)) {
      return
    }
    const url = new URL(context.url.href)
    url.pathname = url.pathname.slice(root.length - 1) || "/"
    context.bind({ url })
    return handle(context)
  }
}
