import * as RegexParam from "regexparam"
import { MethodNotAllowed } from "../RouterError"
import type { RequestContext, RequestHandler, RouteMiddleware } from "../router.types"

export function pattern(
  method: string | null,
  path: string,
  handler: RequestHandler,
  ...middlewares: RouteMiddleware[]
): RequestHandler {
  const { pattern, keys } = RegexParam.parse(path)
  return ({ url, request, bind, dispatch }: RequestContext) => {
    const match = pattern.exec(url.pathname)
    if (!match) return
    if (method !== null && request.method !== method) {
      return new MethodNotAllowed(`Please use "${method}".`)
    }
    const params: { [key: string]: string } = {}
    if (keys.length > 0) {
      for (let k = 0; k < keys.length; k++) {
        let key = keys[k]
        if (key === "*") {
          key = "path"
        }
        params[key] = match[k + 1]
      }
    }
    bind({ params })
    return dispatch(handler, middlewares)
  }
}

export function get(
  path: string,
  handler: RequestHandler,
  ...middlewares: RouteMiddleware[]
): RequestHandler {
  return pattern("GET", path, handler, ...middlewares)
}

export function post(
  path: string,
  handler: RequestHandler,
  ...middlewares: RouteMiddleware[]
): RequestHandler {
  return pattern("POST", path, handler, ...middlewares)
}

export function put(
  path: string,
  handler: RequestHandler,
  ...middlewares: RouteMiddleware[]
): RequestHandler {
  return pattern("PUT", path, handler, ...middlewares)
}

export function del(
  path: string,
  handler: RequestHandler,
  ...middlewares: RouteMiddleware[]
): RequestHandler {
  return pattern("DELETE", path, handler, ...middlewares)
}

export function patch(
  path: string,
  handler: RequestHandler,
  ...middlewares: RouteMiddleware[]
): RequestHandler {
  return pattern("PATCH", path, handler, ...middlewares)
}
