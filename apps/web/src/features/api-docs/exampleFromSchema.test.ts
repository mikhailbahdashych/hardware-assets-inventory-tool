import { describe, expect, it } from 'vitest';
import { OPENAPI_SPEC } from '@/test/api-stub';
import type { HttpMethod, JsonSchema } from '@/types/openapi';
import {
  EXAMPLE_DATE,
  EXAMPLE_TIMESTAMP,
  exampleFromSchema,
  exampleRequest,
  mediaExample,
} from './exampleFromSchema';

/** One operation of the captured document, by method and path. */
const op = (method: HttpMethod, path: string) => OPENAPI_SPEC.paths[path]![method]!;

/** The JSON body schema of one operation — every body on the surface is JSON. */
const bodyOf = (method: HttpMethod, path: string): JsonSchema =>
  op(method, path).requestBody!.content['application/json']!.schema!;

const property = (schema: JsonSchema, name: string): JsonSchema => schema.properties![name]!;

describe('exampleFromSchema, over the shapes the real document carries', () => {
  const createAsset = bodyOf('post', '/api/public/v1/assets');

  it('builds an object from every property, required or not', () => {
    const example = exampleFromSchema(bodyOf('post', '/api/public/v1/assets/{id}/assign'));
    expect(example).toEqual({
      employeeId: 'string',
      checkoutDate: EXAMPLE_DATE,
      expectedReturnDate: 'string',
      notes: 'string',
    });
  });

  it('takes an enum’s first value', () => {
    expect(exampleFromSchema(property(createAsset, 'category'))).toBe('laptops');
  });

  it('describes a nullable field by the value it holds when it is not null', () => {
    // `currency` is nullable with a default of null: null says nothing about
    // the field, so the example is what a caller would send to set it.
    expect(exampleFromSchema(property(createAsset, 'currency'))).toBe('EUR');
    expect(exampleFromSchema(property(createAsset, 'purchasePriceCents'))).toBe(0);
    expect(exampleFromSchema(property(createAsset, 'model'))).toBe('string');
  });

  it('prefers a default that says something', () => {
    const limit = op('get', '/api/public/v1/assets').parameters!.find((p) => p.name === 'limit')!;
    expect(exampleFromSchema(limit.schema!)).toBe(50);
  });

  it('writes a date for a pattern that accepts one, and an address for an email', () => {
    const checkin = bodyOf('post', '/api/public/v1/assets/{id}/checkin');
    expect(exampleFromSchema(property(checkin, 'returnDate'))).toBe(EXAMPLE_DATE);
    expect(EXAMPLE_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const employee = bodyOf('post', '/api/public/v1/employees');
    expect(exampleFromSchema(property(employee, 'email'))).toBe('name@example.com');
  });

  it('keeps a free-keyed map to one entry of its value type', () => {
    expect(exampleFromSchema(property(createAsset, 'customValues'))).toEqual({ key: 'string' });
  });
});

describe('exampleFromSchema, over the shapes a later document may add', () => {
  it('uses the example the schema carries before deriving one', () => {
    expect(exampleFromSchema({ type: 'string', example: 'AST-0142' })).toBe('AST-0142');
    expect(exampleFromSchema({ type: 'string', examples: ['AST-0143'] })).toBe('AST-0143');
    // A written example of null is still the example somebody wrote.
    expect(exampleFromSchema({ type: 'string', nullable: true, example: null })).toBeNull();
  });

  it('wraps one item in an array', () => {
    expect(exampleFromSchema({ type: 'array', items: { type: 'integer', minimum: 1 } })).toEqual([
      1,
    ]);
  });

  it('writes an ISO timestamp for a date-time, and true for a boolean', () => {
    expect(exampleFromSchema({ type: 'string', format: 'date-time' })).toBe(EXAMPLE_TIMESTAMP);
    expect(exampleFromSchema({ type: 'string', format: 'date' })).toBe(EXAMPLE_DATE);
    expect(exampleFromSchema({ type: 'boolean' })).toBe(true);
  });

  it('answers null for a schema that names no type, which accepts any value', () => {
    expect(exampleFromSchema({})).toBeNull();
  });
});

describe('mediaExample', () => {
  it('prefers the media type’s own example, then its first named one, then the schema', () => {
    const schema: JsonSchema = { type: 'object', properties: { name: { type: 'string' } } };
    expect(mediaExample({ schema, example: { name: 'Given' } })).toEqual({ name: 'Given' });
    expect(mediaExample({ schema, examples: { first: { value: { name: 'Named' } } } })).toEqual({
      name: 'Named',
    });
    expect(mediaExample({ schema })).toEqual({ name: 'string' });
  });
});

describe('exampleRequest', () => {
  it('is the request a caller sends: the line, the bearer header and the JSON body', () => {
    const path = '/api/public/v1/assets/{id}/assign';
    expect(exampleRequest(OPENAPI_SPEC, 'post', path, op('post', path))).toBe(
      [
        'POST /api/public/v1/assets/{id}/assign',
        'Authorization: Bearer <token>',
        'Content-Type: application/json',
        '',
        '{',
        '  "employeeId": "string",',
        `  "checkoutDate": "${EXAMPLE_DATE}",`,
        '  "expectedReturnDate": "string",',
        '  "notes": "string"',
        '}',
      ].join('\n'),
    );
  });

  it('has no body when the operation takes none', () => {
    const path = '/api/public/v1/workflow';
    expect(exampleRequest(OPENAPI_SPEC, 'get', path, op('get', path))).toBe(
      ['GET /api/public/v1/workflow', 'Authorization: Bearer <token>'].join('\n'),
    );
  });

  it('sends no credential to an operation that requires none', () => {
    expect(exampleRequest(OPENAPI_SPEC, 'get', '/open', { responses: {} })).toBe('GET /open');
  });
});
