import { withCode } from './prose';
import { schemaNotes, schemaType } from './spec';
import type { FieldsTableProps } from './types/fieldsTable';
import styles from './ApiDocs.module.css';

/**
 * Parameters or body fields: name, where it travels, type, and what it allows.
 * A real `<table>` rather than `DataTable`, whose cells clip to one line — the
 * notes column here wraps, because an enum or a pattern cut off at an ellipsis
 * is the one part a reader came for.
 */
export function FieldsTable({ label, rows }: FieldsTableProps) {
  const located = rows.some((row) => row.location !== undefined);
  return (
    <table className={styles.fields} aria-label={label}>
      <thead>
        <tr>
          <th scope="col" className={styles.nameCol}>
            Name
          </th>
          {located && (
            <th scope="col" className={styles.inCol}>
              In
            </th>
          )}
          <th scope="col" className={styles.typeCol}>
            Type
          </th>
          <th scope="col">Notes</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const notes = schemaNotes(row.schema);
          return (
            <tr key={`${row.location}:${row.name}`}>
              <td>
                <code className={styles.fieldName}>{row.name}</code>
                {row.required && <span className={styles.required}>required</span>}
              </td>
              {located && <td className={styles.muted}>{row.location}</td>}
              <td>
                <code className={styles.type}>{schemaType(row.schema)}</code>
              </td>
              <td className={styles.notes}>
                {row.description !== undefined && <p>{withCode(row.description)}</p>}
                {notes.length > 0 && <p className={styles.muted}>{withCode(notes.join(' · '))}</p>}
                {/* The design's em dash, for a field that allows anything of its type. */}
                {row.description === undefined && notes.length === 0 && (
                  <span className={styles.muted}>—</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
