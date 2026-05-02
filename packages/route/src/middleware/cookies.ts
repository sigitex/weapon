import type {
  RequestContext,
  ResponseContext,
  RouteMiddleware,
} from "../router.types"

export type CookieOptions = {
  domain?: string
  expires?: Date
  httpOnly?: boolean
  maxAge?: number
  path?: string
  sameSite?: "strict" | "lax" | "none"
  secure?: boolean
}

export type Cookies = {
  get(name: string): string | undefined
  set(name: string, value: string, options?: CookieOptions): void
}

export function cookies(): RouteMiddleware {
  const pending: { name: string; value: string; options?: CookieOptions }[] = []
  let parsed: Record<string, string> = {}

  return {
    before: ({ request, bind }: RequestContext) => {
      parsed = parseCookies(request.headers.get("cookie") ?? "")
      bind({
        cookies: {
          get: (name: string) => parsed[name],
          set: (name: string, value: string, options?: CookieOptions) =>
            pending.push({ name, value, options }),
        } satisfies Cookies,
      })
    },
    after: ({ response }: ResponseContext) => {
      for (const { name, value, options } of pending) {
        response.headers.append(
          "set-cookie",
          serializeCookie(name, value, options),
        )
      }
    },
  }
}

function parseCookies(header: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const pair of header.split(";")) {
    const index = pair.indexOf("=")
    if (index === -1) continue
    const key = pair.slice(0, index).trim()
    const value = pair.slice(index + 1).trim()
    if (key) result[key] = decodeURIComponent(value)
  }
  return result
}

function serializeCookie(
  name: string,
  value: string,
  options?: CookieOptions,
): string {
  let cookie = `${name}=${encodeURIComponent(value)}`
  if (!options) return cookie
  if (options.domain) cookie += `; Domain=${options.domain}`
  if (options.expires) cookie += `; Expires=${options.expires.toUTCString()}`
  if (options.httpOnly) cookie += "; HttpOnly"
  // oxlint-disable-next-line no-eq-null
  if (options.maxAge != null) cookie += `; Max-Age=${options.maxAge}`
  if (options.path) cookie += `; Path=${options.path}`
  if (options.sameSite) cookie += `; SameSite=${options.sameSite}`
  if (options.secure) cookie += "; Secure"
  return cookie
}
