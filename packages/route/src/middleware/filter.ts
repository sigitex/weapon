import type { RequestContext, RequestHandler } from "../router.types"

export function filter(
  predicate: (context: RequestContext) => boolean | Promise<boolean>,
): (handler: RequestHandler) => RequestHandler {
  return (handler) => async (context: RequestContext) => {
    if (!(await predicate(context))) return
    return context.dispatch(handler, [])
  }
}
