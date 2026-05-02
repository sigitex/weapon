import { HTTP } from "../HTTP";
import type {
  RequestContext,
  ResponseContext,
  RouteMiddleware,
} from "../router.types";

export type RateLimitStore = {
  increment(
    key: string,
    window: number,
  ): Promise<{ count: number; reset: number }>
}

export type RateLimitOptions = {
  readonly window?: number
  readonly max?: number
  readonly key?: (context: RequestContext) => string
  readonly store?: RateLimitStore
  readonly headers?: boolean
}

export function rateLimit(options?: RateLimitOptions): RouteMiddleware {
  const window = options?.window ?? 60
  const max = options?.max ?? 100
  const key = options?.key ?? rateLimit.ip
  const store = options?.store ?? rateLimit.memory()
  const headers = options?.headers ?? true

  let lastResult: { count: number; reset: number } | undefined

  return {
    before: async (context: RequestContext) => {
      const id = key(context)
      const result = await store.increment(id, window)
      lastResult = result

      if (result.count > max) {
        const response = new Response(
          JSON.stringify({ error: HTTP.statusText.TooManyRequests }),
          {
            status: HTTP.status.TooManyRequests,
            statusText: HTTP.statusText.TooManyRequests,
          },
        )
        if (headers) {
          response.headers.set(HTTP.header.XRateLimitLimit, String(max))
          response.headers.set(HTTP.header.XRateLimitRemaining, "0")
          response.headers.set(
            HTTP.header.XRateLimitReset,
            String(result.reset),
          )
        }
        return response
      }
    },
    after: ({ response }: ResponseContext) => {
      if (headers && lastResult) {
        const remaining = Math.max(0, max - lastResult.count)
        response.headers.set(HTTP.header.XRateLimitLimit, String(max))
        response.headers.set(HTTP.header.XRateLimitRemaining, String(remaining))
        response.headers.set(
          HTTP.header.XRateLimitReset,
          String(lastResult.reset),
        )
      }
    },
  }
}

export namespace rateLimit {
  export function ip({ request }: RequestContext): string {
    return (
      request.headers.get(HTTP.header.CFConnectingIP) ??
      request.headers.get(HTTP.header.XForwardedFor)?.split(",")[0]?.trim() ??
      "unknown"
    )
  }

  export function memory(): RateLimitStore {
    const windows = new Map<string, { count: number; reset: number }>()

    return {
      async increment(key: string, window: number) {
        const now = Math.floor(Date.now() / 1000)
        const windowStart = now - (now % window)
        const windowKey = `${key}:${windowStart}`
        const reset = windowStart + window

        const entry = windows.get(windowKey)
        if (entry) {
          entry.count++
          return { count: entry.count, reset }
        }

        windows.set(windowKey, { count: 1, reset })

        // Clean up expired windows
        for (const [k, v] of windows) {
          if (v.reset < now) windows.delete(k)
        }

        return { count: 1, reset }
      },
    }
  }
}
