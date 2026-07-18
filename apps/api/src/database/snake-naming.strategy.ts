import { DefaultNamingStrategy, NamingStrategyInterface } from 'typeorm';

const snakeCase = (name: string): string =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();

/**
 * DB identifiers are snake_case while TS properties stay camelCase.
 * Table names are NOT derived here — every entity declares its table
 * explicitly via @Entity('table_name').
 */
export class SnakeNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  override columnName(
    propertyName: string,
    customName: string,
    embeddedPrefixes: string[],
  ): string {
    const prefix = embeddedPrefixes.map(snakeCase).join('_');
    const base = customName || snakeCase(propertyName);
    return prefix ? `${prefix}_${base}` : base;
  }

  override relationName(propertyName: string): string {
    return snakeCase(propertyName);
  }

  override joinColumnName(relationName: string, referencedColumnName: string): string {
    return `${snakeCase(relationName)}_${snakeCase(referencedColumnName)}`;
  }

  override joinTableColumnName(
    tableName: string,
    propertyName: string,
    columnName?: string,
  ): string {
    return `${snakeCase(tableName)}_${columnName || snakeCase(propertyName)}`;
  }
}
