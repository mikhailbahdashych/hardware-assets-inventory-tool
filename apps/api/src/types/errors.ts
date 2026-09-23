/**
 * A thrown value narrowed to what the error envelope can use. `message` is
 * required because every Error has one; `statusCode` is optional because only
 * fastify's own errors carry it.
 */
export interface HttpErrorLike {
  statusCode?: number;
  message: string;
}
