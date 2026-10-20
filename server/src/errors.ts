/** A refusal the person should see. `message` is shown as-is; `code` is for programs. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string, readonly extra?: Record<string, unknown>) {
    super(message)
  }
}

export const badRequest = (m: string, code = 'invalid') => new HttpError(400, m, code)
export const unauthorized = (m = 'Sign in to continue', code = 'unauthorized') => new HttpError(401, m, code)
export const forbidden = (m = 'Your role cannot do that', code = 'forbidden') => new HttpError(403, m, code)
export const notFound = (m = 'Not found', code = 'not_found') => new HttpError(404, m, code)
export const conflict = (m: string, code = 'conflict') => new HttpError(409, m, code)
export const tooLarge = (m = 'That is too large', code = 'too_large') => new HttpError(413, m, code)
export const unprocessable = (m: string, code = 'invalid') => new HttpError(422, m, code)
export const tooMany = (m: string, retryAfter: number) => new HttpError(429, m, 'throttled', { retryAfter })
