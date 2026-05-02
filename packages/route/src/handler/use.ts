import type { RequestContext, RequestHandler, RouteMiddleware } from "../router.types"
import { noop } from "./noop"

export function use(
  middlewares: RouteMiddleware[],
  ...handlers: RequestHandler[]
): RequestHandler {
  const befores = middlewares.filter(({ before }) => before)
  const afters = middlewares
    .filter(({ after }) => after)
    .map(({ after }) => ({ before: after }) as RouteMiddleware)
  return async ({ dispatch, bind }: RequestContext) => {
    if (befores.length) {
      const interruptBefore = await dispatch(noop, befores)
      if (interruptBefore !== undefined) {
        return interruptBefore
      }
    }
    let response: Response | undefined
    for (const handler of handlers) {
      response = await dispatch(handler, [])
      if (response !== undefined) break
    }
    if (response === undefined) {
      return
    }
    bind({ response })
    if (afters.length) {
      const interruptAfter = await dispatch(noop, afters)
      if (interruptAfter !== undefined) {
        return interruptAfter
      }
    }
    return response
  }
}
