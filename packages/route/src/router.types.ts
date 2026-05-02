/** biome-ignore-all lint/suspicious/noExplicitAny: shut up */
import type { Container } from "@weapon/bind"

export type RouteTree = {
  [key: string]: string | RouteTree
}

export type RouterFetch = (
  request: Request,
  env: Env,
) => Promise<Response>

export type RequestContext = {
  readonly request: Request
  readonly env: Env
  readonly url: URL
  readonly bind: RouterBind
  readonly dispatch: RouterDispatch
}

export type RouterBind = (bindings: { [key: string]: any }) => void

export type RouterDispatch = (
  handler: RequestHandler,
  middlewares: RouteMiddleware[],
) => Promise<Response | undefined>

export type ResponseContext = RequestContext & {
  readonly response: Response
}

export type RequestHandler = (
  context: any,
) => unknown

export type ResponseHandler = (
  context: any,
) => unknown

export type RouterOptions = {
  readonly container?: Container
  readonly middlewares?: RouteMiddleware[]
}

export type RouteMiddleware = {
  readonly before?: RequestHandler
  readonly after?: ResponseHandler
}
