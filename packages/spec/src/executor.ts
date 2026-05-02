// oxlint-disable typescript/no-explicit-any
import type { Container } from "@sigitex/bind"
import type {
  Spec,
  DefinesProtocol,
  DefinesOperation,
  BoundService,
  Contract,
  ConfigOf,
  MiddlewareKeysOf,
} from "./spec"

// --- Boundary Types ---

/** The input to the executor — a matched operation + parsed input from the transport. */
export type OperationRequest = {
  readonly mounted: MountedOperation
  readonly input: unknown
}

/** The output from the executor — the raw handler result. */
export type OperationResponse = {
  readonly output: unknown
}

// --- Mounted Operation ---

/** A flattened operation — pairs its definition with its service handler. Produced by `collectOperations()`. */
export type MountedOperation = {
  readonly key: string
  readonly definition: DefinesOperation<DefinesProtocol>
  readonly handler: (input: unknown, context: unknown) => MaybePromise<unknown>
}

// --- Operation Middleware ---

/**
 * Server-side implementation of an {@link OperationMiddlewareConfig}.
 * Runs cross-cutting hooks before and after the service handler.
 * Both hooks are optional — implement only what the concern requires.
 *
 * @typeParam OperationConfig - The per-operation config for this middleware.
 */
export type OperationMiddleware<OperationConfig = unknown> = {
  /** Runs before the handler — use for authorization, rate-limiting, etc. */
  onRequest?(config: OperationConfig, container: Container): MaybePromise<void>
  /** Runs after the handler (in reverse order) — use for audit logging, response transforms, etc. */
  onResponse?(config: OperationConfig, container: Container): MaybePromise<void>
}


// --- Executor ---

/**
 * The protocol engine produced by {@link executor}.
 * Exposes the flat operation list (for transports to resolve against)
 * and a transport-agnostic `handle` method.
 */
export type Executor = {
  readonly operations: MountedOperation[]
  readonly handle: (request: OperationRequest, container: Container) => Promise<OperationResponse>
}

/**
 * Configuration for creating an executor. Requires a server-side adapter for
 * every middleware declared in the protocol, plus the services to mount.
 */
export type ExecutorConfig<Protocol extends DefinesProtocol> = {
  readonly middleware: {
    [K in MiddlewareKeysOf<Protocol>]: OperationMiddleware<ConfigOf<Protocol[K]>>
  }
  readonly services: BoundService<Protocol, any>[]
}

/**
 * Creates an executor — the protocol engine.
 * Takes a spec, middleware adapters, and service entries.
 * Returns `{ operations, handle }` where `handle` runs the
 * transport-agnostic lifecycle:
 *
 * 1. Validate input (arktype)
 * 2. Middleware `onRequest` hooks (declaration order)
 * 3. Service handler (with DI injector context)
 * 4. Middleware `onResponse` hooks (reverse order)
 * 5. Return `OperationResponse`
 *
 * Bindings live outside the executor — they resolve transport input
 * into an `OperationRequest`, call `handle`, and convert
 * the `OperationResponse` back to their native format.
 */
export function executor<Protocol extends DefinesProtocol>(
  spec: Spec<Protocol, any>,
  config: ExecutorConfig<Protocol>,
): Executor {
  const operations: MountedOperation[] = []
  for (const entry of config.services) {
    mountOperations(entry.contract as Contract<any, any>, entry.service as Record<string, unknown>, operations)
  }

  const middleware = Object.entries(spec.middleware)
    .map(([key]) => ({
      key,
      middleware: (config.middleware as Record<string, OperationMiddleware>)[key],
    }))

  return {
    operations,

    async handle(request: OperationRequest, container: Container): Promise<OperationResponse> {
      const validatedInput = request.mounted.definition.input(request.input)

      for (const mw of middleware) {
        const opConfig = (request.mounted.definition as Record<string, unknown>)[mw.key]
        if (opConfig !== undefined && mw.middleware.onRequest) {
          await mw.middleware.onRequest(opConfig, container)
        }
      }

      const context = container.createInjector()
      const output = await request.mounted.handler(validatedInput, context)

      for (let i = middleware.length - 1; i >= 0; i--) {
        const mw = middleware[i]
        const opConfig = (request.mounted.definition as Record<string, unknown>)[mw.key]
        if (opConfig !== undefined && mw.middleware.onResponse) {
          await mw.middleware.onResponse(opConfig, container)
        }
      }

      return { output }
    },
  }
}

// --- Internals ---

/** Recursively flattens a contract (and its nested scopes) into a flat list of mounted operations. */
function mountOperations(
  contract: Contract<any, any>,
  handlers: Record<string, unknown>,
  entries: MountedOperation[],
) {
  for (const [key, definition] of Object.entries(contract.operations)) {
    const handler = handlers[key]
    if (typeof handler === "function") {
      entries.push({
        key,
        definition: definition as MountedOperation["definition"],
        handler: handler as MountedOperation["handler"],
      })
    }
  }
  for (const [key, scope] of Object.entries(contract.scopes)) {
    const scopeHandlers = handlers[key]
    if (scopeHandlers && typeof scopeHandlers === "object") {
      mountOperations(
        scope as Contract<any, any>,
        scopeHandlers as Record<string, unknown>,
        entries,
      )
    }
  }
}
