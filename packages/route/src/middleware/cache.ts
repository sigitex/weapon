// oxlint-disable no-eq-null -- fix this
// oxlint-disable curly
import { HTTP } from "../HTTP"
import type { ResponseContext, RouteMiddleware } from "../router.types"

export type CacheOptions = {
  readonly public?: boolean
  readonly private?: boolean
  readonly maxAge?: number
  readonly sMaxAge?: number
  readonly noCache?: boolean
  readonly noStore?: boolean
  readonly mustRevalidate?: boolean
  readonly proxyRevalidate?: boolean
  readonly immutable?: boolean
  readonly staleWhileRevalidate?: number
  readonly staleIfError?: number
  readonly vary?: string | string[]
}

export function cache(options: string | CacheOptions): RouteMiddleware {
  const directive =
    typeof options === "string" ? options : buildDirective(options)
  const vary = typeof options === "object" ? options.vary : undefined

  return {
    after: ({ response }: ResponseContext) => {
      response.headers.set(HTTP.header.CacheControl, directive)
      if (vary) {
        const value = Array.isArray(vary) ? vary.join(", ") : vary
        response.headers.set(HTTP.header.Vary, value)
      }
    },
  }
}

function buildDirective(options: CacheOptions): string {
  const parts: string[] = []
  if (options.public) parts.push("public")
  if (options.private) parts.push("private")
  if (options.noCache) parts.push("no-cache")
  if (options.noStore) parts.push("no-store")
  if (options.mustRevalidate) parts.push("must-revalidate")
  if (options.proxyRevalidate) parts.push("proxy-revalidate")
  if (options.immutable) parts.push("immutable")
  if (options.maxAge != null) parts.push(`max-age=${options.maxAge}`)
  if (options.sMaxAge != null) parts.push(`s-maxage=${options.sMaxAge}`)
  if (options.staleWhileRevalidate != null)
    parts.push(`stale-while-revalidate=${options.staleWhileRevalidate}`)
  if (options.staleIfError != null)
    parts.push(`stale-if-error=${options.staleIfError}`)
  return parts.join(", ")
}
