import type {
  HttpMethod,
  JsonSchema,
  OpenApiDocument,
  OpenApiMediaType,
  OpenApiOperation,
  OpenApiSecurityScheme,
} from '@/types/openapi';

// Examples are derived from the document, never written beside it: a curated
// example goes stale the week a field is added, and one read off the schema
// that validates the route cannot. Where the document carries an example of
// its own, that wins — somebody chose it.
//
// Every field of a schema is optional in the format itself, so every read below
// asks whether it is there; absence is the document saying nothing, not a
// value that went missing.

/** The date every date-only example shows. Fixed, so the page never changes by itself. */
export const EXAMPLE_DATE = '2026-01-15';
/** The timestamp every date-time example shows — ISO-8601 UTC, like the API's. */
export const EXAMPLE_TIMESTAMP = '2026-01-15T09:30:00.000Z';

/** A value that satisfies `schema`, as a caller would write it in JSON. */
export function exampleFromSchema(schema: JsonSchema): unknown {
  if ('example' in schema) return schema.example;
  if (schema.examples !== undefined && schema.examples.length > 0) return schema.examples[0];
  // A default of null says only that the field may be left out; the example
  // is for what a caller sends when they do set it.
  if (schema.default !== undefined && schema.default !== null) return schema.default;
  if (schema.enum !== undefined && schema.enum.length > 0) return schema.enum[0];

  switch (schema.type) {
    case 'object':
      return objectExample(schema);
    case 'array':
      return schema.items === undefined ? [] : [exampleFromSchema(schema.items)];
    case 'string':
      return stringExample(schema);
    case 'integer':
    case 'number':
      // The smallest value it accepts, or zero where it names no floor.
      return schema.minimum ?? 0;
    case 'boolean':
      return true;
    default:
      // A schema that names no type accepts any JSON value, and null is one.
      return null;
  }
}

function objectExample(schema: JsonSchema): Record<string, unknown> {
  if (schema.properties !== undefined) {
    return Object.fromEntries(
      Object.entries(schema.properties).map(([name, property]) => [
        name,
        exampleFromSchema(property),
      ]),
    );
  }
  // A map whose keys are the caller's own — custom field keys, say — shown
  // with one entry of the value type it allows.
  if (typeof schema.additionalProperties === 'object') {
    return { key: exampleFromSchema(schema.additionalProperties) };
  }
  return {};
}

function stringExample(schema: JsonSchema): string {
  if (schema.format === 'date') return EXAMPLE_DATE;
  if (schema.format === 'date-time') return EXAMPLE_TIMESTAMP;
  if (schema.format === 'email') return 'name@example.com';
  // zod writes a date-only field as a pattern rather than a format; asking the
  // pattern whether it takes our date finds those without naming any regex.
  if (schema.pattern !== undefined && new RegExp(schema.pattern).test(EXAMPLE_DATE)) {
    return EXAMPLE_DATE;
  }
  return 'string';
}

/**
 * The example for one media type: the one written beside it, else its first
 * named example, else one derived from its schema. Null when it has neither —
 * a body the document declares but does not describe.
 */
export function mediaExample(media: OpenApiMediaType): unknown {
  if ('example' in media) return media.example;
  const named = media.examples === undefined ? [] : Object.values(media.examples);
  const first = named.find((example) => 'value' in example);
  if (first !== undefined) return first.value;
  return media.schema === undefined ? null : exampleFromSchema(media.schema);
}

/**
 * The header a bearer scheme asks for. The token is a placeholder rather than
 * the real prefix: the document does not say what a token looks like.
 */
export const BEARER_HEADER = 'Authorization: Bearer <token>';

/** Scheme names are case-insensitive (RFC 7235). */
export function isBearer(scheme: OpenApiSecurityScheme): boolean {
  return scheme.type === 'http' && scheme.scheme?.toLowerCase() === 'bearer';
}

/**
 * The request a caller would send, as HTTP: the request line, the credential
 * the operation's security names, and the JSON body when it takes one. Path
 * parameters stay as the template (`{id}`) — an invented id would read as a
 * real record.
 */
export function exampleRequest(
  spec: OpenApiDocument,
  method: HttpMethod,
  path: string,
  operation: OpenApiOperation,
): string {
  const lines = [`${method.toUpperCase()} ${path}`];
  if (requiresBearer(spec, operation)) lines.push(BEARER_HEADER);

  // Every body on the public surface is JSON; the first media type is the one
  // a caller would pick when there are several.
  const content = operation.requestBody && Object.entries(operation.requestBody.content)[0];
  if (content) {
    const [mediaType, media] = content;
    lines.push(`Content-Type: ${mediaType}`, '', JSON.stringify(mediaExample(media), null, 2));
  }
  return lines.join('\n');
}

/**
 * Whether one of the operation's security requirements is an HTTP bearer
 * scheme. The document declares no global requirement, so an operation that
 * lists none requires none. A requirement naming a scheme the document never
 * declared is a broken document, and says so.
 */
function requiresBearer(spec: OpenApiDocument, operation: OpenApiOperation): boolean {
  if (operation.security === undefined) return false;
  return operation.security.some((requirement) =>
    Object.keys(requirement).some((name) => {
      const scheme = spec.components?.securitySchemes?.[name];
      if (scheme === undefined) {
        throw new Error(`The API document names a security scheme it never declares: ${name}.`);
      }
      return isBearer(scheme);
    }),
  );
}
