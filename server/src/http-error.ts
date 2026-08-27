/**
 * An error carrying the status and machine-readable code the client should see.
 * Anything thrown that is *not* an HttpError is treated as a bug and reported
 * as a generic 500, so internal details never reach the browser.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
