import type { Container } from "@weapon/bind"
import type {
  RequestHandler,
  RouterOptions,
  RouteMiddleware,
  RequestContext
} from "./router.types"

export class Router {
  private readonly handlers: RequestHandler[]
  private readonly container: Container | undefined
  private readonly middlewares: RouteMiddleware[]

  constructor(handlers: RequestHandler[], options: RouterOptions = {}) {
    this.handlers = handlers
    this.container = options.container
    this.middlewares = options.middlewares ?? []
  }

  async route(
    request: Request,
    env: Env,
  ): Promise<Response> {
    const url = new URL(request.url)
    const context: RequestContext = {
      request,
      env,
      url,
      bind,
      dispatch,
    }
    const container = this.container?.clone()
    try {
      if (container) {
        container.bind(context)
      }
      for (const handler of this.handlers) {
        const result = await dispatch(handler, this.middlewares)
        if (result === undefined) continue
        return result
      }
      return fail(404, "Not found.")
    } catch (error) {
      console.error(error)
      return fail(500, "Internal server error.")
    }

    // biome-ignore lint/suspicious/noExplicitAny: shut up>
    async function bind(bindings: { [key: string]: any }) {
      if (container) {
        container.bind(bindings)
      } else {
        Object.assign(context, bindings)
      }
    }

    async function dispatch(
      handler: RequestHandler,
      middlewares: RouteMiddleware[],
    ): Promise<Response | undefined> {
      for (const { before } of middlewares) {
        if (!before) continue
        const interrupt = await Promise.resolve(invoke(before))
        if (interrupt !== undefined) return respond(interrupt)
      }
      const result = await Promise.resolve(invoke(handler))
      if (result === undefined) {
        return
      }
      const response = respond(result)
      bind({ response })
      for (const { after } of middlewares) {
        if (!after) continue
        const interrupt = await Promise.resolve(invoke(after))
        if (interrupt !== undefined) return respond(interrupt)
      }
      return respond(result)
    }

    async function invoke(handler: RequestHandler) {
      if (container) {
        return container.call(handler)
      }
      return handler(context)
    }
  }
}

function fail(status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status,
    statusText: error,
  })
}

function respond(result: unknown) {
  return result instanceof Response
    ? result
    : new Response(JSON.stringify(result))
}
