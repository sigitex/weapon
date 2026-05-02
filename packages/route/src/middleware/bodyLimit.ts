import { HTTP } from "../HTTP"
import type { RequestContext, RouteMiddleware } from "../router.types"

export type BodyLimitOptions = {
  readonly maxSize?: number
  readonly contentTypes?: string[]
}

export function bodyLimit(options?: BodyLimitOptions): RouteMiddleware {
  const maxSize = options?.maxSize ?? 1_048_576
  const contentTypes = options?.contentTypes

  return {
    before: ({ request }: RequestContext) => {
      const contentLength = request.headers.get(HTTP.header.ContentLength)
      if (contentLength && Number.parseInt(contentLength, 10) > maxSize) {
        return new Response(
          JSON.stringify({ error: HTTP.statusText.PayloadTooLarge }),
          {
            status: HTTP.status.PayloadTooLarge,
            statusText: HTTP.statusText.PayloadTooLarge,
          },
        )
      }

      if (contentTypes) {
        const contentType = request.headers.get(HTTP.header.ContentType)
        if (
          contentType &&
          !contentTypes.some((allowed) => contentType.startsWith(allowed))
        ) {
          return new Response(
            JSON.stringify({ error: HTTP.statusText.UnsupportedMediaType }),
            {
              status: HTTP.status.UnsupportedMediaType,
              statusText: HTTP.statusText.UnsupportedMediaType,
            },
          )
        }
      }
    },
  }
}
