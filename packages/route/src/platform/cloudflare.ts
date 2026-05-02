import type { Assets } from "../Assets"
import type { RequestHandler } from "../router.types"

type CloudflareAssets = {
  readonly fetch: (request: Request | URL | string) => Promise<Response>
}

type CloudflareOptions = {
  readonly assets?: string
}

export function cloudflare(options: CloudflareOptions = {}): RequestHandler {
  const assetsKey = options.assets ?? "ASSETS"
  return ({ env, request, bind }: { env: Env, request: Request, bind: (bindings: { assets: Assets }) => void }) => {
    // biome-ignore lint/suspicious/noExplicitAny: env binding access
    const binding = (env as any)[assetsKey] as CloudflareAssets
    const origin = new URL(request.url).origin
    bind({ assets: cloudflareAssets(binding, origin) })
  }
}

function cloudflareAssets(binding: CloudflareAssets, origin: string): Assets {
  return {
    async static(path) {
      return binding.fetch(new Request(`${origin}${path}`))
    },
    async file(request) {
      const response = await binding.fetch(request)
      if (response.status === 404) return undefined
      return response
    },
  }
}
