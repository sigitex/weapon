import { HTTP } from "../HTTP"
import type { ResponseContext, RouteMiddleware } from "../router.types"

function make(value: string): RouteMiddleware {
  return {
    after: ({ response }: ResponseContext) => {
      response.headers.set(HTTP.header.XFrameOptions, value)
    },
  }
}

export namespace frameGuard {
  export const deny = make(HTTP.frameOption.deny)
  export const sameOrigin = make(HTTP.frameOption.sameOrigin)
}
