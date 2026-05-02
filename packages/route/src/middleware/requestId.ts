import { HTTP } from "../HTTP"
import type {
  RequestContext,
  ResponseContext,
  RouteMiddleware,
} from "../router.types"

export type RequestIdOptions = {
  readonly header?: string
  readonly generate?: () => string
}

export function requestId(options?: RequestIdOptions): RouteMiddleware {
  const header = options?.header ?? HTTP.header.XRequestId
  const generate = options?.generate ?? (() => crypto.randomUUID())

  return {
    before: ({ request, bind }: RequestContext) => {
      const id = request.headers.get(header) ?? generate()
      bind({ requestId: id })
    },
    after: ({
      response,
      requestId,
    }: ResponseContext & { requestId: string }) => {
      if (requestId) {
        response.headers.set(header, requestId)
      }
    },
  }
}
