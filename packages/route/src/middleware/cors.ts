import { HTTP } from "../HTTP"
import type {
  RequestContext,
  ResponseContext,
  RouteMiddleware,
} from "../router.types"

export type CorsOptions = {
  readonly origin?: string | string[] | ((origin: string) => boolean)
  readonly methods?: string[]
  readonly allowHeaders?: string[]
  readonly exposeHeaders?: string[]
  readonly credentials?: boolean
  readonly maxAge?: number
}

export function cors(options?: CorsOptions): RouteMiddleware {
  const originOption = options?.origin ?? "*"
  const methods = options?.methods ?? [
    HTTP.method.GET,
    HTTP.method.HEAD,
    HTTP.method.PUT,
    HTTP.method.PATCH,
    HTTP.method.POST,
    HTTP.method.DELETE,
  ]
  const allowHeaders = options?.allowHeaders
  const exposeHeaders = options?.exposeHeaders
  const credentials = options?.credentials ?? false
  const maxAge = options?.maxAge

  return {
    before: ({ request }: RequestContext) => {
      if (request.method !== HTTP.method.OPTIONS) return

      const requestOrigin = request.headers.get(HTTP.header.Origin)
      if (!requestOrigin) return

      const response = new Response(null, { status: HTTP.status.NoContent })
      setOriginHeader(response, requestOrigin, originOption)
      response.headers.set(
        HTTP.header.AccessControlAllowMethods,
        methods.join(", "),
      )

      const requestedHeaders = request.headers.get(
        HTTP.header.AccessControlRequestHeaders,
      )
      if (allowHeaders) {
        response.headers.set(
          HTTP.header.AccessControlAllowHeaders,
          allowHeaders.join(", "),
        )
      } else if (requestedHeaders) {
        response.headers.set(
          HTTP.header.AccessControlAllowHeaders,
          requestedHeaders,
        )
      }

      if (credentials) {
        response.headers.set(HTTP.header.AccessControlAllowCredentials, "true")
      }

      // oxlint-disable-next-line no-eq-null -- fix this
      if (maxAge != null) {
        response.headers.set(HTTP.header.AccessControlMaxAge, String(maxAge))
      }

      return response
    },
    after: ({ request, response }: ResponseContext) => {
      const requestOrigin = request.headers.get(HTTP.header.Origin)
      if (!requestOrigin) return

      setOriginHeader(response, requestOrigin, originOption)

      if (credentials) {
        response.headers.set(HTTP.header.AccessControlAllowCredentials, "true")
      }

      if (exposeHeaders) {
        response.headers.set(
          HTTP.header.AccessControlExposeHeaders,
          exposeHeaders.join(", "),
        )
      }
    },
  }
}

function setOriginHeader(
  response: Response,
  requestOrigin: string,
  originOption: string | string[] | ((origin: string) => boolean),
) {
  if (originOption === "*") {
    response.headers.set(HTTP.header.AccessControlAllowOrigin, "*")
    return
  }

  const allowed =
    typeof originOption === "function"
      ? originOption(requestOrigin)
      : typeof originOption === "string"
        ? originOption === requestOrigin
        : originOption.includes(requestOrigin)

  if (allowed) {
    response.headers.set(HTTP.header.AccessControlAllowOrigin, requestOrigin)
    response.headers.append(HTTP.header.Vary, HTTP.header.Origin)
  }
}
