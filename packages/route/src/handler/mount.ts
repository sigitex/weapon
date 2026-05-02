/** biome-ignore-all lint/suspicious/noExplicitAny: shut up */
import type { RequestHandler } from "../router.types"

/** Wraps a standard fetch function as a router handler. */
export function mount(handler: (request: Request) => Promise<Response>): RequestHandler {
  return ({ request, url, container }: any) => {
    const mapped = new Request(url.href, request)
    if ("__mount" in handler && container) {
      return (handler as any).__mount(mapped, container)
    }
    return handler(mapped)
  }
}
