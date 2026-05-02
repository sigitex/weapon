export class RouterError extends Error {
  readonly code: number
  constructor(code: number, message: string) {
    super(message)
    this.code = code
  }
}

export class NotFound extends RouterError {
  constructor(message?: string) {
    super(404, message ?? "Not found.")
  }
}

export class ServerError extends Error {
  constructor(message?: string) {
    super(message ?? "Internal error.")
  }
}

export class MethodNotAllowed extends RouterError {
  constructor(message?: string) {
    super(405, message ?? "Method not allowed.")
  }
}

export class InvalidRequest extends RouterError {
  constructor(message?: string) {
    super(400, message ?? "Invalid request.")
  }
}