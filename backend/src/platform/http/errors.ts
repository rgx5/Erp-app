/** An error whose message is safe to show the caller. Everything else becomes a generic 500. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(404, 'not_found', `${what} was not found`);
export const unauthorized = (message = 'Authentication is required') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'You are not allowed to do this') => new AppError(403, 'forbidden', message);
export const preconditionRequired = (message: string) => new AppError(428, 'precondition_required', message);
export const preconditionFailed = (message: string) => new AppError(412, 'precondition_failed', message);
export const validationFailed = (errors: { path: string; message: string }[]) =>
  new AppError(422, 'validation_failed', 'The request is not valid', { errors });
