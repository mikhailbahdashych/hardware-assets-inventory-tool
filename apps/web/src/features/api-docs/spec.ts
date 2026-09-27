import { API_SCOPES, type ApiScope, type SemanticColor } from '@inventory/shared';
import type { HttpMethod, JsonSchema, OpenApiDocument, OpenApiOperation } from '@/types/openapi';
import type { DocSection, FieldRow } from './types/spec';

// Reading the OpenAPI document into what the page draws. Nothing here knows a
// route: every section, row and label comes out of the document, which is what
// lets a route added to the public surface appear with no change to this app.
//
// The format makes almost every field optional, so the reads below ask whether
// a field is there; a field the document leaves out is simply not drawn.

/**
 * The colour of each method's badge — picked once, used by the cards and the
 * contents alike. Reads are information, creation is a new thing, an edit is a
 * change to be careful with, a delete is destructive. Exhaustive over the
 * format's methods, so a method nobody coloured is a compile error.
 */
export const METHOD_COLORS: Record<HttpMethod, SemanticColor> = {
  get: 'info',
  post: 'ok',
  put: 'warn',
  patch: 'warn',
  delete: 'err',
  head: 'neut',
  options: 'neut',
  trace: 'neut',
};

/** A path item's keys are methods and, optionally, path-level fields. */
function isMethod(key: string): key is HttpMethod {
  return Object.hasOwn(METHOD_COLORS, key);
}

/** `post /api/public/v1/assets/{id}/assign` → `post-api-public-v1-assets-id-assign`. */
export function operationAnchor(method: HttpMethod, path: string): string {
  return `${method}-${path}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-$/, '');
}

/**
 * A tag as a heading: `custom-fields` → `Custom fields`. Derived rather than
 * looked up, so a tag the surface gains tomorrow is headed in words with no
 * label map to forget. Only the first letter is raised — lowercasing the rest
 * would turn an acronym in an already-worded tag into a word.
 */
export function humanizeTag(tag: string): string {
  const words = tag.replace(/[-_]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Where an operation that carries no tag is filed — the name every OpenAPI
 * renderer, swagger-ui included, gives that group.
 */
const UNTAGGED = 'default';

/**
 * Every operation in the document, grouped by its first tag: the document's
 * own tags first, in its order, then any tag it uses without declaring, then
 * the untagged. An operation with several tags sits under the first, so each
 * one has exactly one card and one anchor.
 */
export function docSections(spec: OpenApiDocument): DocSection[] {
  const sections = new Map<string, DocSection>();
  for (const tag of spec.tags ?? []) {
    sections.set(tag.name, { name: tag.name, description: tag.description, operations: [] });
  }

  for (const [path, item] of Object.entries(spec.paths)) {
    for (const [key, operation] of Object.entries(item)) {
      if (!isMethod(key) || operation === undefined) continue;
      const tag = operation.tags?.[0] ?? UNTAGGED;
      let section = sections.get(tag);
      if (section === undefined) {
        section = { name: tag, operations: [] };
        sections.set(tag, section);
      }
      section.operations.push({ method: key, path, operation, anchor: operationAnchor(key, path) });
    }
  }

  // A tag the document declares but no operation uses has nothing to show.
  return [...sections.values()].filter((section) => section.operations.length > 0);
}

/**
 * The scope an operation needs. The document carries it in prose — `documented()`
 * in the API's `modules/public.ts` ends every description with "Requires the
 * `<scope>` scope.", and the API's own spec test holds every route to it —
 * because OpenAPI 3.0 gives a bearer scheme nowhere structured to put one.
 * Undefined when the sentence is absent or names a scope this build does not know.
 */
export function scopeOf(operation: OpenApiOperation): ApiScope | undefined {
  const named = operation.description?.match(/Requires the `([^`]+)` scope/)?.[1];
  return API_SCOPES.find((scope) => scope === named);
}

/** The colour of a response's status: success, redirect, the caller's fault, ours. */
export function statusColor(status: string): SemanticColor {
  if (status.startsWith('2')) return 'ok';
  if (status.startsWith('3')) return 'info';
  if (status.startsWith('4')) return 'warn';
  if (status.startsWith('5')) return 'err';
  return 'neut';
}

/** The path and query parameters, and the body's top-level fields, as table rows. */
export function parameterRows(operation: OpenApiOperation): FieldRow[] {
  return (operation.parameters ?? []).map((parameter) => ({
    name: parameter.name,
    location: parameter.in,
    required: parameter.required === true,
    // A parameter described by `content` rather than `schema` has none, and
    // `{}` is the schema that says exactly that: any value.
    schema: parameter.schema ?? {},
    // The parameter's own words first; its schema may carry some too.
    description: parameter.description ?? parameter.schema?.description,
  }));
}

export function fieldRows(schema: JsonSchema): FieldRow[] {
  const required = new Set(schema.required);
  return Object.entries(schema.properties ?? {}).map(([name, property]) => ({
    name,
    required: required.has(name),
    schema: property,
    description: property.description,
  }));
}

/**
 * A schema's type as one short line: `string`, `string (email)`,
 * `integer | null`, `string[]`. A schema naming no type accepts any value.
 */
export function schemaType(schema: JsonSchema): string {
  const base =
    schema.type === 'array' && schema.items !== undefined
      ? `${schemaType(schema.items)}[]`
      : (schema.type ?? 'any');
  const formatted = schema.format === undefined ? base : `${base} (${schema.format})`;
  return schema.nullable === true ? `${formatted} | null` : formatted;
}

/**
 * zod writes `Number.MAX_SAFE_INTEGER` as the ceiling of every `.int()`: that
 * is JavaScript's limit, not the API's, and quoting it would read as a rule.
 */
const NO_CEILING = Number.MAX_SAFE_INTEGER;

/**
 * What a schema allows beyond its type, one note each, with values in
 * backticks for the page to set in mono: the enum, the default, the ranges,
 * the pattern and the value type of a free-keyed map.
 */
export function schemaNotes(schema: JsonSchema): string[] {
  const notes: string[] = [];
  const code = (value: unknown) => `\`${JSON.stringify(value)}\``;

  if (schema.enum !== undefined) notes.push(`One of ${schema.enum.map(code).join(', ')}`);
  if (schema.default !== undefined) notes.push(`Default ${code(schema.default)}`);

  const maximum = schema.maximum === NO_CEILING ? undefined : schema.maximum;
  const range = bounds(schema.minimum, maximum);
  if (range !== null) notes.push(range);
  const length = bounds(schema.minLength, schema.maxLength);
  if (length !== null) notes.push(`length ${length}`);

  // A format already names what the pattern spells out, and says it legibly.
  if (schema.pattern !== undefined && schema.format === undefined) {
    notes.push(`Pattern \`${schema.pattern}\``);
  }
  if (typeof schema.additionalProperties === 'object') {
    notes.push(`Any keys, each \`${schemaType(schema.additionalProperties)}\``);
  }
  return notes;
}

function bounds(min: number | undefined, max: number | undefined): string | null {
  if (min !== undefined && max !== undefined) return `${min}–${max}`;
  if (min !== undefined) return `≥ ${min}`;
  if (max !== undefined) return `≤ ${max}`;
  return null;
}
