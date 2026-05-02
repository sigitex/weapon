import { HTTP } from "../HTTP"
import type { ResponseContext, RouteMiddleware } from "../router.types"

export type HstsOptions = {
  readonly maxAge?: number
  readonly includeSubDomains?: boolean
  readonly preload?: boolean
}

export function hsts(options?: HstsOptions): RouteMiddleware {
  const maxAge = options?.maxAge ?? 31536000
  const includeSubDomains = options?.includeSubDomains ?? true
  const preload = options?.preload ?? false

  let value = `max-age=${maxAge}`
  if (includeSubDomains) value += "; includeSubDomains"
  if (preload) value += "; preload"

  return {
    after: ({ response }: ResponseContext) => {
      response.headers.set(HTTP.header.StrictTransportSecurity, value)
    },
  }
}
