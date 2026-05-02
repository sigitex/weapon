// Minimal WinterCG-compatible types for remote.

declare type MaybePromise<T> = T | Promise<T>

declare function btoa(input: string): string

declare type HeadersInit = Record<string, string> | [string, string][]

declare interface RequestInit {
  method?: string
  headers?: HeadersInit
  body?: string | null
  signal?: AbortSignal | null
}

declare interface Headers {
  get(name: string): string | null
  has(name: string): boolean
}

declare interface Response {
  readonly status: number
  readonly statusText: string
  readonly ok: boolean
  readonly headers: Headers
  json(): Promise<unknown>
  text(): Promise<string>
}

declare function fetch(input: string, init?: RequestInit): Promise<Response>

declare interface URLSearchParams {
  toString(): string
}

declare var URLSearchParams: {
  new (init?: string | Record<string, string> | [string, string][]): URLSearchParams
}
