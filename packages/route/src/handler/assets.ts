import type { Assets } from "../Assets"
import type { RequestHandler } from "../router.types"

export function assets(): RequestHandler {
  return async ({ assets, request }: { assets: Assets, request: Request }) => {
    const response = await assets.file(request)
    if (!response || response.status === 404) return
    return response
  }
}
