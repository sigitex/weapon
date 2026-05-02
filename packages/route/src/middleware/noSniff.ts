import { HTTP } from "../HTTP"
import type { ResponseContext, RouteMiddleware } from "../router.types"

export const noSniff: RouteMiddleware = {
  after: ({ response }: ResponseContext) => {
    response.headers.set(
      HTTP.header.XContentTypeOptions,
      HTTP.contentTypeOptions.nosniff,
    )
  },
}
