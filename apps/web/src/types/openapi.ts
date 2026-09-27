// The OpenAPI document `GET /api/public/openapi.json` serves, as far as the API
// reference page reads it. `@fastify/swagger` writes it from the same zod
// schemas that validate the public routes, so these are the shapes of that
// generator's output — OpenAPI 3.0 — not a hand-kept description of the API.
//
// Almost everything in the format is optional, and the page treats it so: a
// field the document leaves out is simply not drawn.

/** The keys a path item may hold an operation under. */
export type HttpMethod = 'get' | 'put' | 'post' | 'delete' | 'options' | 'head' | 'patch' | 'trace';

/** The subset of a Schema Object the page describes and derives examples from. */
export interface JsonSchema {
  type?: string;
  format?: string;
  description?: string;
  nullable?: boolean;
  enum?: unknown[];
  default?: unknown;
  /** OpenAPI 3.0's single example. */
  example?: unknown;
  /** JSON Schema's list of them, which a 3.1 document would carry instead. */
  examples?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  additionalProperties?: boolean | JsonSchema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

export interface OpenApiParameter {
  name: string;
  /** `path`, `query`, `header` or `cookie`. */
  in: string;
  required?: boolean;
  description?: string;
  schema?: JsonSchema;
}

/** One named example beside a media type. */
export interface OpenApiExample {
  summary?: string;
  value?: unknown;
}

export interface OpenApiMediaType {
  schema?: JsonSchema;
  example?: unknown;
  examples?: Record<string, OpenApiExample>;
}

export interface OpenApiRequestBody {
  required?: boolean;
  description?: string;
  /** Keyed by media type, e.g. `application/json`. */
  content: Record<string, OpenApiMediaType>;
}

export interface OpenApiResponse {
  description: string;
  content?: Record<string, OpenApiMediaType>;
}

export interface OpenApiOperation {
  summary?: string;
  description?: string;
  tags?: string[];
  operationId?: string;
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  /** Keyed by status code, or `default`. */
  responses: Record<string, OpenApiResponse>;
  /** Each entry names a security scheme from `components.securitySchemes`. */
  security?: Record<string, string[]>[];
}

export type OpenApiPathItem = Partial<Record<HttpMethod, OpenApiOperation>>;

export interface OpenApiTag {
  name: string;
  description?: string;
}

export interface OpenApiSecurityScheme {
  /** `http`, `apiKey`, `oauth2` or `openIdConnect`. */
  type: string;
  /** For `http`: `bearer`, `basic`, … */
  scheme?: string;
  description?: string;
}

export interface OpenApiServer {
  url: string;
}

export interface OpenApiInfo {
  title: string;
  description?: string;
  version: string;
}

export interface OpenApiComponents {
  securitySchemes?: Record<string, OpenApiSecurityScheme>;
}

export interface OpenApiDocument {
  openapi: string;
  info: OpenApiInfo;
  servers?: OpenApiServer[];
  tags?: OpenApiTag[];
  paths: Record<string, OpenApiPathItem>;
  components?: OpenApiComponents;
}
