/** biome-ignore-all lint/suspicious/noExplicitAny: intent */
import {
  useMutation,
  useQuery,
  type QueryClient as TanStackQueryClient,
} from "@tanstack/react-query"
import type { Remote, RemoteConfig } from "@weapon/remote"
import { remote } from "@weapon/remote"
import type {
  Contract,
  DefinesContract,
  DefinesOperation,
  DefinesProtocol,
  HttpConfig,
  HttpOperationConfig,
  InferInput,
  InferOutput,
  Spec,
  TransportConfig,
} from "@weapon/spec"

/**
 * Creates a typed TanStack Query client from a spec.
 *
 * @example
 * ```ts
 * // From an existing remote client
 * const Api = remote(Spec, Spec.transports.http, { base: "/api", authenticate: () => "" })
 * const Q = query(Spec, Api)
 *
 * // Or create the remote client inline
 * const Q = query(Spec, Spec.transports.http, { base: "/api", authenticate: () => "" })
 *
 * // Direct hooks
 * const { data } = Q.users.useGet({ id: "12" })
 * const mutation = Q.users.useCreate()
 *
 * // Options factories
 * useQuery(Q.users.get.queryOptions({ id: "12" }))
 * useMutation(Q.users.create.mutationOptions())
 *
 * // Query keys for invalidation
 * queryClient.invalidateQueries({ queryKey: Q.users.get.queryKey({ id: "12" }) })
 * queryClient.invalidateQueries({ queryKey: Q.users.queryKey() })
 * ```
 */
export function query<
  Protocol extends DefinesProtocol,
  ContractDef extends DefinesContract<Protocol>,
>(
  spec: Spec<Protocol, ContractDef>,
  client: Remote<Protocol, ContractDef>,
  options?: QueryOptions,
): QueryProxy<Protocol, ContractDef>

export function query<
  Protocol extends DefinesProtocol,
  ContractDef extends DefinesContract<Protocol>,
  const Config extends HttpConfig,
>(
  spec: Spec<Protocol, ContractDef>,
  transport: TransportConfig<Config, HttpOperationConfig>,
  config: RemoteConfig<Config>,
  options?: QueryOptions,
): QueryProxy<Protocol, ContractDef>

export function query(
  spec: Spec,
  clientOrTransport: RemoteProxy | TransportConfig<any, HttpOperationConfig>,
  configOrOptions?: RemoteConfig<any> | QueryOptions,
  options?: QueryOptions,
): any {
  let client: RemoteProxy
  let opts: QueryOptions | undefined
  if ("kind" in clientOrTransport) {
    client = remote(
      spec,
      clientOrTransport as TransportConfig<any, HttpOperationConfig>,
      configOrOptions as RemoteConfig<any>,
    ) as RemoteProxy
    opts = options
  } else {
    client = clientOrTransport as RemoteProxy
    opts = configOrOptions as QueryOptions | undefined
  }
  return createQueryProxy(
    spec.contract as Contract<any, any>,
    client,
    [],
    opts?.queryClient,
  )
}

// --- Public Types ---

export type QueryOptions = {
  queryClient?: TanStackQueryClient
}

export type OperationOptions<Input, Output> = {
  queryOptions(input: Input): {
    queryKey: readonly unknown[]
    queryFn: () => Promise<Output>
  }
  queryKey(input: Input): readonly unknown[]
  mutationOptions(): {
    mutationKey: readonly unknown[]
    mutationFn: (input: Input) => Promise<Output>
  }
  mutationKey(): readonly unknown[]
}

type UseHookKey<K extends string> = `use${Capitalize<K>}`

export type QueryProxy<
  Protocol extends DefinesProtocol,
  ContractDef extends DefinesContract<Protocol>,
> = { // Options factories: api.users.get.queryOptions(...)
  readonly [K in keyof ContractDef &
    string as ContractDef[K] extends DefinesOperation<Protocol>
    ? K
    : never]: OperationOptions<
    InferInput<ContractDef[K]>,
    InferOutput<ContractDef[K]>
  >
} & { // Direct hooks: api.users.useGet(...)
  readonly [K in keyof ContractDef &
    string as ContractDef[K] extends DefinesOperation<Protocol>
    ? UseHookKey<K>
    : never]: ContractDef[K] extends DefinesOperation<Protocol>
    ? ((
        input: InferInput<ContractDef[K]>,
      ) => ReturnType<typeof useQuery<InferOutput<ContractDef[K]>>>) &
        (() => ReturnType<
          typeof useMutation<
            InferOutput<ContractDef[K]>,
            Error,
            InferInput<ContractDef[K]>
          >
        >)
    : never
} & { // Scopes: api.users.queryKey(), api.users.list.queryOptions(...)
  readonly [K in keyof ContractDef &
    string as ContractDef[K] extends DefinesOperation<Protocol>
    ? never
    : K]: ContractDef[K] extends DefinesContract<Protocol>
    ? QueryProxy<Protocol, ContractDef[K]> & { queryKey(): readonly unknown[] }
    : never
}

// --- Internals ---

interface RemoteProxy {
  [key: string]: ((...args: any[]) => Promise<any>) | RemoteProxy
}

function createQueryProxy(
  contract: Contract<any, any>,
  client: RemoteProxy,
  path: readonly string[],
  queryClient?: TanStackQueryClient,
): any {
  const proxy: Record<string, unknown> = {}

  for (const [key, definition] of Object.entries(contract.operations)) {
    const def = definition as DefinesOperation<DefinesProtocol>
    const fn = client[key] as (...args: any[]) => Promise<any>
    const opPath = [...path, key]
    const isGet = isQueryMethod(def.http as HttpOperationConfig | undefined)

    const options: OperationOptions<any, any> = {
      queryOptions: (input: unknown) => ({
        queryKey: [...opPath, input],
        queryFn: () => fn(input),
      }),
      queryKey: (input: unknown) => [...opPath, input],
      mutationOptions: () => ({
        mutationKey: opPath,
        mutationFn: (input: unknown) => fn(input),
      }),
      mutationKey: () => opPath,
    }
    proxy[key] = options

    const hookKey = `use${capitalize(key)}`
    proxy[hookKey] = isGet
      ? (input: unknown) =>
          useQuery(
            { queryKey: [...opPath, input], queryFn: () => fn(input) },
            queryClient,
          )
      : () =>
          useMutation(
            { mutationKey: opPath, mutationFn: (input: unknown) => fn(input) },
            queryClient,
          )
  }

  for (const [key, scope] of Object.entries(contract.scopes)) {
    const scopePath = [...path, key]
    const nested = createQueryProxy(
      scope as Contract<any, any>,
      client[key] as RemoteProxy,
      scopePath,
      queryClient,
    )
    nested.queryKey = () => scopePath
    proxy[key] = nested
  }

  return proxy
}

function isQueryMethod(config: HttpOperationConfig | undefined): boolean {
  if (!config) return false
  const method =
    typeof config === "string"
      ? config.slice(0, config.indexOf(" "))
      : config.method
  return method === "GET" || method === "HEAD"
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
