import * as RegexParam from "regexparam"
import type { Assets } from "../Assets"
import type { RequestHandler, RouteTree } from "../router.types"

export function app(routes: RouteTree): RequestHandler {
  const patterns: RegExp[] = getAppPatterns(routes)
  return async ({ assets, url }: { assets: Assets, url: URL }) => {
    for (const pattern of patterns) {
      if (pattern.test(url.pathname)) {
        return await assets.static("/index.html")
      }
    }
    return
  }
}

function getAppPatterns(tree: RouteTree) {
  const patterns: RegExp[] = []
  for (const [key, value] of Object.entries(tree)) {
    if (typeof value === "string") {
      patterns.push(RegexParam.parse(value).pattern)
    } else {
      patterns.push(...getAppPatterns(value))
    }
  }
  return patterns
}
