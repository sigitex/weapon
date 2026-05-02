export type Assets = {
  static(path: string): Promise<Response>
  file(request: Request): Promise<Response | undefined>
}
