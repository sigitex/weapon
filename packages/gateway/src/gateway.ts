/** biome-ignore-all lint/suspicious/noExplicitAny: intent */
import {
  type BoundService,
  type ConfigOf,
  type DefinesProtocol,
  type Executor,
  executor,
  type HttpConfig,
  type HttpOperationConfig,
  type MiddlewareKeysOf,
  type OperationMiddleware,
  type Spec,
  type TransportConfig,
} from "@weapon/spec"
import type { HttpHostConfig } from "./httpHost"
import { httpHost } from "./httpHost"

/** Flat config for {@link gateway} — merges HTTP host config and middleware implementations. */
export type GatewayConfig<
  Protocol extends DefinesProtocol,
  Config extends HttpConfig,
> = HttpHostConfig<Config> & {
  [K in MiddlewareKeysOf<Protocol>]: OperationMiddleware<ConfigOf<Protocol[K]>>
}

/**
 * Creates an executor and HTTP host in one call.
 * Pass the spec, the HTTP transport (for auth type inference), a flat config
 * merging gateway config (`authenticate`) and middleware implementations, and the services.
 * Returns `{ executor, fetch }`.
 */
export function gateway<
  Protocol extends DefinesProtocol,
  const Config extends HttpConfig,
>(
  spec: Spec<Protocol, any>,
  transport: TransportConfig<Config, HttpOperationConfig>,
  config: GatewayConfig<Protocol, Config>,
  services: BoundService<Protocol, any>[],
): {
  readonly executor: Executor
  readonly fetch: (request: Request) => Promise<Response>
} {
  const middleware = Object.fromEntries(
    Object.keys(spec.middleware).map((k) => [
      k,
      (config as Record<string, unknown>)[k],
    ]),
  ) as {
    [K in MiddlewareKeysOf<Protocol>]: OperationMiddleware<
      ConfigOf<Protocol[K]>
    >
  }

  const exec = executor(spec, { middleware, services })
  const host = httpHost(transport, exec, {
    authenticate: (config as any).authenticate,
    container: (config as any).container,
  })
  const fetch = (request: Request) => host.fetch(request)
  ;(fetch as any).__mount = (request: Request, container: any) =>
    host.fetch(request, container)
  return { executor: exec, fetch }
}
