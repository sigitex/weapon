import type { OperationRequest, OperationResponse } from "./executor"

type RedactValue = "TODO"

export function audit() {
  // this should return an OperationMiddlewareConfig
  // this should require that its adapter configuration provides an implementation...
}

export type AuditLogEvent = {
  readonly request: OperationRequest
  readonly response: OperationResponse
}

export type AuditLogger = (
  event: AuditLogEvent,
  dependencies: unknown,
) => MaybePromise<void>

export type AuditOptions = {
  readonly redact?: RedactValue
}
