import { HTTP } from "../HTTP"
import type { RequestContext, RouteMiddleware } from "../router.types"
import type { Cookies } from "./cookies"

export type CsrfOptions = {
  readonly cookie?: string
  readonly header?: string
  readonly methods?: string[]
}

export function csrf(options?: CsrfOptions): RouteMiddleware {
  const cookieName = options?.cookie ?? "csrf-token"
  const headerName = options?.header ?? HTTP.header.XCsrfToken
  const methods = options?.methods ?? [
    HTTP.method.POST,
    HTTP.method.PUT,
    HTTP.method.PATCH,
    HTTP.method.DELETE,
  ]

  return {
    before: ({ request, cookies }: RequestContext & { cookies?: Cookies }) => {
      if (!cookies) {
        throw new Error(
          "csrf() requires cookies() middleware to be in the stack",
        )
      }

      if (!methods.includes(request.method)) return

      const origin = request.headers.get(HTTP.header.Origin)
      const url = new URL(request.url)
      if (origin && origin !== url.origin) {
        return new Response(
          JSON.stringify({ error: HTTP.statusText.Forbidden }),
          {
            status: HTTP.status.Forbidden,
            statusText: HTTP.statusText.Forbidden,
          },
        )
      }

      const cookieToken = cookies.get(cookieName)
      const headerToken = request.headers.get(headerName)

      if (!cookieToken || !headerToken || cookieToken !== headerToken) {
        return new Response(
          JSON.stringify({ error: HTTP.statusText.Forbidden }),
          {
            status: HTTP.status.Forbidden,
            statusText: HTTP.statusText.Forbidden,
          },
        )
      }
    },
    after: ({ cookies }: { cookies?: Cookies }) => {
      if (!cookies) return
      const token = crypto.randomUUID()
      cookies.set(cookieName, token, {
        httpOnly: false,
        sameSite: "strict",
        path: "/",
      })
    },
  }
}
