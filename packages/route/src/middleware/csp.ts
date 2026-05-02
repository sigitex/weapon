import { CSP, type CspSource } from "../CSP"
import { HTTP } from "../HTTP"
import type {
  RequestContext,
  ResponseContext,
  RouteMiddleware,
} from "../router.types"

export type CspOptions = {
  readonly defaultSrc?: CspSource[]
  readonly scriptSrc?: CspSource[]
  readonly styleSrc?: CspSource[]
  readonly imgSrc?: CspSource[]
  readonly connectSrc?: CspSource[]
  readonly fontSrc?: CspSource[]
  readonly frameSrc?: CspSource[]
  readonly frameAncestors?: CspSource[]
  readonly mediaSrc?: CspSource[]
  readonly objectSrc?: CspSource[]
  readonly workerSrc?: CspSource[]
  readonly childSrc?: CspSource[]
  readonly baseUri?: CspSource[]
  readonly formAction?: CspSource[]
  readonly manifestSrc?: CspSource[]
  readonly upgradeInsecureRequests?: boolean
  readonly reportOnly?: boolean
  readonly reportTo?: string
}

const directiveMap: Record<string, string> = {
  defaultSrc: "default-src",
  scriptSrc: "script-src",
  styleSrc: "style-src",
  imgSrc: "img-src",
  connectSrc: "connect-src",
  fontSrc: "font-src",
  frameSrc: "frame-src",
  frameAncestors: "frame-ancestors",
  mediaSrc: "media-src",
  objectSrc: "object-src",
  workerSrc: "worker-src",
  childSrc: "child-src",
  baseUri: "base-uri",
  formAction: "form-action",
  manifestSrc: "manifest-src",
}

export function csp(options: CspOptions): RouteMiddleware {
  const usesNonce = detectsNonce(options)
  const reportOnly = options.reportOnly ?? false

  return {
    before: usesNonce
      ? ({ bind }: RequestContext) => {
          const nonce = crypto.randomUUID()
          bind({ cspNonce: nonce })
        }
      : undefined,
    after: ({
      response,
      cspNonce,
    }: ResponseContext & { cspNonce?: string }) => {
      const value = buildPolicy(options, cspNonce)
      const header = reportOnly
        ? HTTP.header.ContentSecurityPolicyReportOnly
        : HTTP.header.ContentSecurityPolicy
      response.headers.set(header, value)
    },
  }
}

function detectsNonce(options: CspOptions): boolean {
  for (const key of Object.keys(directiveMap)) {
    const sources = options[key as keyof CspOptions]
    if (
      Array.isArray(sources) &&
      sources.includes(CSP.nonce as unknown as CspSource)
    ) {
      return true
    }
  }
  return false
}

function buildPolicy(options: CspOptions, nonce?: string): string {
  const parts: string[] = []

  for (const [key, directive] of Object.entries(directiveMap)) {
    const sources = options[key as keyof CspOptions]
    if (!Array.isArray(sources) || sources.length === 0) continue

    const resolved = sources.map((source) => {
      if (source === CSP.nonce) return `'nonce-${nonce}'`
      return source as string
    })

    parts.push(`${directive} ${resolved.join(" ")}`)
  }

  if (options.upgradeInsecureRequests) {
    parts.push("upgrade-insecure-requests")
  }

  if (options.reportTo) {
    parts.push(`report-to ${options.reportTo}`)
  }

  return parts.join("; ")
}
