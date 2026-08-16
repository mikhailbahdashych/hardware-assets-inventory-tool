/**
 * One uploaded part, reduced to what the attachment service needs.
 *
 * `truncated` is part of the contract, not an afterthought: @fastify/multipart
 * stops reading at the size limit and flags the stream instead of throwing, so
 * a caller that ignores it silently stores a half-written file.
 */
export interface UploadedFile {
  filename: string;
  mimetype: string;
  stream: NodeJS.ReadableStream & { truncated?: boolean };
}
