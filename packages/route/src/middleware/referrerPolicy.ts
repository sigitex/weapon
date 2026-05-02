import { HTTP } from "../HTTP"
import type { ResponseContext, RouteMiddleware } from "../router.types"

function make(value: string): RouteMiddleware {
  return {
    after: ({ response }: ResponseContext) => {
      response.headers.set(HTTP.header.ReferrerPolicy, value)
    },
  }
}

export namespace referrerPolicy {
  export const noReferrer = make(HTTP.referrerPolicy.noReferrer)
  export const noReferrerWhenDowngrade = make(
    HTTP.referrerPolicy.noReferrerWhenDowngrade,
  )
  export const origin = make(HTTP.referrerPolicy.origin)
  export const originWhenCrossOrigin = make(
    HTTP.referrerPolicy.originWhenCrossOrigin,
  )
  export const sameOrigin = make(HTTP.referrerPolicy.sameOrigin)
  export const strictOrigin = make(HTTP.referrerPolicy.strictOrigin)
  export const strictOriginWhenCrossOrigin = make(
    HTTP.referrerPolicy.strictOriginWhenCrossOrigin,
  )
  export const unsafeUrl = make(HTTP.referrerPolicy.unsafeUrl)
}
