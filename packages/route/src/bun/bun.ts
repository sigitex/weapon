import { join } from "node:path"
import type { Assets } from "../Assets"
import type { RequestHandler } from "../router.types"

type BunOptions = {
  readonly assets?: string
}

export function bun(options: BunOptions = {}): RequestHandler {
  const assets = bunAssets(options.assets ?? "./assets")
  return ({ bind }: { bind: (bindings: { assets: Assets }) => void }) => {
    bind({ assets })
  }
}

function bunAssets(dir: string): Assets {
  const cache = new Map<string, Response>()

  return {
    async static(path) {
      const cached = cache.get(path)
      if (cached) return cached.clone() as Response
      const file = Bun.file(join(dir, path))
      const response = new Response(await file.bytes(), {
        headers: { "Content-Type": file.type },
      })
      cache.set(path, response.clone() as Response)
      return response as Response
    },
    async file(request) {
      const path = new URL(request.url).pathname
      const file = Bun.file(join(dir, path))
      if (!await file.exists()) return undefined
      return new Response(file) as Response
    },
  }
}
