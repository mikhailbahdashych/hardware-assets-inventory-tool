import { SnakeNamingStrategy } from './snake-naming.strategy';

describe('SnakeNamingStrategy', () => {
  const s = new SnakeNamingStrategy();

  it('snake_cases column names from property names', () => {
    expect(s.columnName('mfaEnabled', '', [])).toBe('mfa_enabled');
    expect(s.columnName('createdAt', '', [])).toBe('created_at');
    expect(s.columnName('id', '', [])).toBe('id');
  });

  it('respects explicit custom column names', () => {
    expect(s.columnName('whatever', 'custom_name', [])).toBe('custom_name');
  });

  it('prefixes embedded columns', () => {
    expect(s.columnName('street', '', ['home', 'address'])).toBe('home_address_street');
  });

  it('snake_cases join columns as relation_referencedColumn', () => {
    expect(s.joinColumnName('assetType', 'id')).toBe('asset_type_id');
    expect(s.joinColumnName('assignedBy', 'id')).toBe('assigned_by_id');
  });

  it('snake_cases relation constraint parts', () => {
    expect(s.relationName('assetType')).toBe('asset_type');
  });
});
