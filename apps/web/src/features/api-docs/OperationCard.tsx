import { API_SCOPE_LABELS } from '@inventory/shared';
import { Card, Pill } from '@/components/ui';
import { exampleRequest, mediaExample } from './exampleFromSchema';
import { FieldsTable } from './FieldsTable';
import { withCode } from './prose';
import { fieldRows, METHOD_COLORS, parameterRows, scopeOf, statusColor } from './spec';
import type { OperationCardProps } from './types/operationCard';
import styles from './ApiDocs.module.css';

/**
 * One endpoint, everything the document says about it: what it is called, the
 * route, what it needs, what it takes, a request a caller could send, and the
 * responses it declares. The card is its own anchor, so a URL can point at it.
 */
export function OperationCard({ spec, entry }: OperationCardProps) {
  const { method, path, operation, anchor } = entry;
  const route = `${method.toUpperCase()} ${path}`;
  const scope = scopeOf(operation);
  const parameters = parameterRows(operation);
  const bodyMedia = operation.requestBody && Object.entries(operation.requestBody.content)[0];
  const bodyFields = bodyMedia?.[1].schema === undefined ? [] : fieldRows(bodyMedia[1].schema);

  return (
    <article id={anchor} aria-label={route} className={styles.operation}>
      <Card padding={false}>
        <div className={styles.opHead}>
          <div className={styles.opTitleRow}>
            <h3 className={styles.opTitle}>
              {/* An operation the document leaves unsummarised is headed by its route. */}
              <a href={`#${anchor}`}>{operation.summary ?? route}</a>
            </h3>
            {/* The scope in the words the token form's checkbox uses, so an
                admin can match a token's pills to the doors they open. */}
            {scope !== undefined && (
              <Pill sv="neut" size="sm">
                {API_SCOPE_LABELS[scope]}
              </Pill>
            )}
          </div>
          <div className={styles.route}>
            <span className={styles.method}>
              <Pill sv={METHOD_COLORS[method]} size="sm" strong>
                {method.toUpperCase()}
              </Pill>
            </span>
            <code className={styles.path}>{path}</code>
          </div>
          {operation.description !== undefined && (
            <p className={styles.prose}>{withCode(operation.description)}</p>
          )}
        </div>

        <div className={styles.opBody}>
          {parameters.length > 0 && (
            <div className={styles.block}>
              <div className={styles.label}>Parameters</div>
              <FieldsTable label="Parameters" rows={parameters} />
            </div>
          )}

          {bodyFields.length > 0 && (
            <div className={styles.block}>
              <div className={styles.label}>
                Request body
                {bodyMedia !== undefined && <code className={styles.media}>{bodyMedia[0]}</code>}
              </div>
              <FieldsTable label="Request body" rows={bodyFields} />
            </div>
          )}

          <div className={styles.block}>
            <div className={styles.label}>Example request</div>
            <pre className={styles.code} aria-label="Example request">
              {exampleRequest(spec, method, path, operation)}
            </pre>
          </div>

          <div className={styles.block}>
            <div className={styles.label}>Responses</div>
            <ul className={styles.responses} aria-label="Responses">
              {Object.entries(operation.responses).map(([status, response]) => (
                <li key={status} className={styles.response}>
                  <div className={styles.responseHead}>
                    <span className={styles.method}>
                      <Pill sv={statusColor(status)} size="sm" strong>
                        {status}
                      </Pill>
                    </span>
                    <span>{withCode(response.description)}</span>
                  </div>
                  {/* A response with no body declares no content. */}
                  {Object.entries(response.content ?? {}).map(([mediaType, media]) => (
                    <pre key={mediaType} className={styles.code} aria-label={`Example ${status}`}>
                      {JSON.stringify(mediaExample(media), null, 2)}
                    </pre>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>
    </article>
  );
}
