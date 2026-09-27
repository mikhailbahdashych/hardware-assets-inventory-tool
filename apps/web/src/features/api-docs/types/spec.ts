import type { HttpMethod, JsonSchema, OpenApiOperation } from '@/types/openapi';

/** One operation, with the method and path the document keys it by. */
export interface DocOperation {
  method: HttpMethod;
  path: string;
  operation: OpenApiOperation;
  /** The element id a URL fragment points at, so one endpoint can be linked. */
  anchor: string;
}

/** One tag's operations, in the order the document lists them. */
export interface DocSection {
  name: string;
  description?: string;
  operations: DocOperation[];
}

/** One line of a parameter or request-body table. */
export interface FieldRow {
  name: string;
  /** Where a parameter travels (`path`, `query`); absent for a body field. */
  location?: string;
  required: boolean;
  schema: JsonSchema;
  description?: string;
}
