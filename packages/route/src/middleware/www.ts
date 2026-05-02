import type { RequestContext, RequestHandler } from "../router.types"

export function www({ secure }: { readonly secure?: boolean }): RequestHandler {
  return ({ url }: RequestContext) => {
    const isWww = url.hostname.startsWith("www.")
    const isSecure = url.protocol === "https:"
    if (isWww && (secure ? isSecure : true)) return
    url.hostname = `www.${url.hostname}`
    if (secure) url.protocol = "https:"
    return Response.redirect(url, 301)
  }
}
