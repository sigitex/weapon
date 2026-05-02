/** biome-ignore-all lint/suspicious/noExplicitAny: intent */
import type { Type } from "arktype"

/**
 * Declarative transport configuration (http, mcp, cli, webhook).
 * Describes how operations are exposed over a particular protocol.
 * Server-side behavior lives in a separate transport implementation
 * (e.g. `httpGateway`).
 *
 * @typeParam SpecConfig - Spec-level configuration (e.g. auth scheme for HTTP).
 * @typeParam OperationConfig - Per-operation configuration (e.g. `"POST /teams"`).
 */
export type TransportConfig<SpecConfig = unknown, OperationConfig = unknown> = {
  readonly kind: "transport"
  readonly config?: SpecConfig
  readonly opConfig?: OperationConfig
}

/**
 * Declarative operation middleware configuration (authorize, rate-limit, audit).
 * Describes a cross-cutting concern that hooks into the operation lifecycle.
 * Server-side behavior lives in an {@link OperationMiddleware} implementation.
 *
 * @typeParam SpecConfig - Spec-level configuration (unused for simple middleware).
 * @typeParam OperationConfig - Per-operation configuration (e.g. `{ user: true, role: "owner" }`).
 */
export type OperationMiddlewareConfig<SpecConfig = unknown, OperationConfig = unknown> = {
  readonly kind: "middleware"
  readonly config?: SpecConfig
  readonly opConfig?: OperationConfig
}

/** Any member that can be registered on a spec — either a transport or middleware. */
export type ProtocolMember = TransportConfig<any, any> | OperationMiddlewareConfig<any, any>

/** Extracts the per-operation config type from a TransportConfig or OperationMiddlewareConfig. */
export type ConfigOf<P> = P extends TransportConfig<any, infer OpConfig>
  ? OpConfig
  : P extends OperationMiddlewareConfig<any, infer OpConfig>
    ? OpConfig
    : never

/** Extracts the spec-level config type from a TransportConfig or OperationMiddlewareConfig. */
export type SpecConfigOf<P> = P extends TransportConfig<infer SC, any>
  ? SC
  : P extends OperationMiddlewareConfig<infer SC, any>
    ? SC
    : never

/** Filters protocol keys to only those that are transports. */
export type TransportKeysOf<Protocol extends DefinesProtocol> = {
  [K in keyof Protocol]: Protocol[K] extends TransportConfig<any, any> ? K : never
}[keyof Protocol] & string

/** Filters protocol keys to only those that are middleware. */
export type MiddlewareKeysOf<Protocol extends DefinesProtocol> = {
  [K in keyof Protocol]: Protocol[K] extends OperationMiddlewareConfig<any, any> ? K : never
}[keyof Protocol] & string

// --- Spec ---

/** Constraint for the protocol layer — transports and middleware. */
export type DefinesProtocol = {
  readonly [key: string]: ProtocolMember
}

/**
 * Creates a spec — a declarative, shared definition of transports, middleware,
 * and operations. Specs carry no server-side implementation; they describe
 * *what* transports and cross-cutting concerns exist, not *how* they behave at
 * runtime. Use {@link executor} on the server to pair a spec with implementations.
 */
export function spec<
  const Protocol extends DefinesProtocol,
  const ContractDef extends DefinesContract<Protocol> = {},
>(protocol: Protocol, contractDef?: ContractDef): Spec<Protocol, ContractDef> {
  const transports = {} as Record<string, TransportConfig>
  const middleware = {} as Record<string, OperationMiddlewareConfig>
  for (const [key, member] of Object.entries(protocol)) {
    if (member.kind === "transport") transports[key] = member
    else middleware[key] = member
  }

  return {
    transports: transports as any,
    middleware: middleware as any,
    contract: createContract(protocol, (contractDef ?? {}) as ContractDef) as any,
  }
}

export function createContract<
  Protocol extends DefinesProtocol,
  const ContractDef extends DefinesContract<Protocol>,
>(
  protocol: Protocol,
  definition: ContractDef,
): Contract<Protocol, ContractDef> {
  const operations: Record<string, unknown> = {}
  const scopes: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(definition)) {
    if (value && typeof value === "object" && "input" in value) {
      operations[key] = value
    } else if (value && typeof value === "object") {
      scopes[key] = createContract(protocol, value as DefinesContract<Protocol>)
    }
  }
  return {
    ...scopes,
    definition,
    protocol,
    operations,
    scopes,
    service(impl: Service<Protocol, ContractDef>): BoundService<Protocol, ContractDef> {
      return { contract: this as any, service: impl }
    },
  } as any
}

/**
 * A spec instance — holds transports, middleware, and a contract.
 * Shared between client and server.
 */
export type Spec<
  Protocol extends DefinesProtocol = DefinesProtocol,
  ContractDef extends DefinesContract<Protocol> = DefinesContract<Protocol>,
> = {
  readonly transports: { [K in TransportKeysOf<Protocol>]: Protocol[K] }
  readonly middleware: { [K in MiddlewareKeysOf<Protocol>]: Protocol[K] }
  readonly contract: Contract<Protocol, ContractDef>
}

/**
 * A contract — a set of operations and nested scopes.
 * Contracts define the API surface; services implement them.
 * Scopes are accessible directly as properties (e.g. `contract.teams`).
 */
export type Contract<
  Protocol extends DefinesProtocol,
  ContractDef extends DefinesContract<Protocol>,
> = {
  readonly definition: ContractDef
  readonly protocol: Protocol
  readonly operations: {
    [K in keyof ContractDef as ContractDef[K] extends DefinesOperation<Protocol> ? K : never]: ContractDef[K]
  }
  readonly scopes: {
    [K in keyof ContractDef as ContractDef[K] extends DefinesOperation<Protocol> ? never : K]:
      ContractDef[K] extends DefinesContract<Protocol> ? Contract<Protocol, ContractDef[K]> : never
  }
  readonly service: (
    impl: Service<Protocol, ContractDef>,
  ) => BoundService<Protocol, ContractDef>
} & {
  readonly [K in keyof ContractDef as ContractDef[K] extends DefinesOperation<Protocol> ? never : K]:
    ContractDef[K] extends DefinesContract<Protocol> ? Contract<Protocol, ContractDef[K]> : never
}

/** A service bound to its contract — produced by {@link Contract.service}. */
export type BoundService<
  Protocol extends DefinesProtocol = DefinesProtocol,
  ContractDef extends DefinesContract<Protocol> = DefinesContract<Protocol>,
> = {
  readonly contract: Contract<Protocol, ContractDef>
  readonly service: Service<Protocol, ContractDef>
}

/**
 * A protocol-agnostic implementation of a contract's operations.
 * Recursive — nested contracts (scopes) map to nested service objects.
 * Each operation handler receives validated input and a DI container injector.
 */
export type Service<
  Protocol extends DefinesProtocol,
  ContractDef extends DefinesContract<Protocol>,
> = {
  [K in keyof ContractDef as ContractDef[K] extends DefinesOperation<Protocol> ? K : never]: (
    input: ContractDef[K]["input"]["infer"],
    context: any,
  ) => MaybePromise<ContractDef[K]["output"]["infer"]>
} & {
  [K in keyof ContractDef as ContractDef[K] extends DefinesOperation<Protocol> ? never : K]?:
    ContractDef[K] extends DefinesContract<Protocol> ? Service<Protocol, ContractDef[K]> : never
}

/** Constraint for a contract definition — a map of operations and nested scopes. */
export type DefinesContract<Protocol extends DefinesProtocol> = {
  readonly [key: string]: DefinesOperation<Protocol> | DefinesContract<Protocol>
}

/** Maps each protocol member key to its optional per-operation config type. */
type OperationMembers<Protocol extends DefinesProtocol> = {
  readonly [K in keyof Protocol & string]?: ConfigOf<Protocol[K]>
}

/**
 * An operation definition — declares input/output types (arktype) plus
 * per-operation config for each transport and middleware in the protocol.
 */
export type DefinesOperation<Protocol extends DefinesProtocol> = {
  readonly input: Type
  readonly output: Type
  readonly description?: string
} & OperationMembers<Protocol>

/** Extracts the inferred input type from an operation definition. */
export type InferInput<Op> = Op extends { readonly input: Type<infer T> } ? T : never

/** Extracts the inferred output type from an operation definition. */
export type InferOutput<Op> = Op extends { readonly output: Type<infer T> } ? T : never
