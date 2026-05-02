import type { ResponseContext, RouteMiddleware } from "../router.types"
import { frameGuard } from "./frameGuard"
import { hsts, type HstsOptions } from "./hsts"
import { noSniff } from "./noSniff"
import { referrerPolicy } from "./referrerPolicy"

export type HardenedOptions = {
  readonly noSniff?: false
  readonly frameGuard?: false | "deny" | "sameOrigin"
  readonly referrerPolicy?: false | keyof typeof referrerPolicy
  readonly hsts?: false | HstsOptions
}

export function hardened(options?: HardenedOptions): RouteMiddleware {
  const parts: RouteMiddleware[] = []

  if (options?.noSniff !== false) {
    parts.push(noSniff)
  }

  if (options?.frameGuard !== false) {
    const value = options?.frameGuard ?? "deny"
    parts.push(frameGuard[value])
  }

  if (options?.referrerPolicy !== false) {
    const value = options?.referrerPolicy ?? "strictOriginWhenCrossOrigin"
    parts.push(referrerPolicy[value])
  }

  if (options?.hsts !== false) {
    const hstsOptions = options?.hsts === undefined ? undefined : options.hsts
    parts.push(hsts(hstsOptions))
  }

  return {
    after: (context: ResponseContext) => {
      for (const part of parts) {
        if (part.after) part.after(context)
      }
    },
  }
}
