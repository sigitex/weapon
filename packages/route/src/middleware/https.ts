import type { RequestContext, RequestHandler } from "../router.types"

export function https(): RequestHandler {
  return ({ url }: RequestContext) => {
    if (url.protocol === "https:") return
    url.protocol = "https:"
    return Response.redirect(url, 301)
  }
}
