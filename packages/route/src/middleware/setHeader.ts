import type { ResponseContext, ResponseHandler } from "../router.types"

export function setHeader(header: string, value: string): ResponseHandler {
  return ({ response }: ResponseContext) => {
    response.headers.set(header, value)
  }
}
