import { Card, Pill } from '@/components/ui';
import { BEARER_HEADER, isBearer } from './exampleFromSchema';
import { OperationCard } from './OperationCard';
import { withCode } from './prose';
import { docSections, METHOD_COLORS } from './spec';
import type { ReferenceProps } from './types/reference';
import styles from './ApiDocs.module.css';

/**
 * The document, drawn: a preamble saying where to call and how to
 * authenticate, a contents column, and one section per tag.
 */
export function Reference({ spec }: ReferenceProps) {
  const sections = docSections(spec);
  // With no `servers`, OpenAPI's own default is the one at `/`. Relative, like
  // the one this API writes, it resolves against wherever the app is served.
  const server = spec.servers?.[0]?.url ?? '/';
  const baseUrl = new URL(server, window.location.origin).href.replace(/\/$/, '');
  const schemes = Object.entries(spec.components?.securitySchemes ?? {});

  return (
    <>
      <Card>
        <div className={styles.docTitle}>
          <h2>{spec.info.title}</h2>
          <Pill sv="neut" size="sm">
            v{spec.info.version}
          </Pill>
        </div>
        {spec.info.description !== undefined && (
          <p className={styles.prose}>{withCode(spec.info.description)}</p>
        )}
        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt>Base URL</dt>
            <dd>
              <code>{baseUrl}</code>
            </dd>
          </div>
          {schemes.map(([name, scheme]) => (
            <div key={name} className={styles.fact}>
              <dt>Authentication</dt>
              <dd>
                <code>{isBearer(scheme) ? BEARER_HEADER : `${scheme.type} (${name})`}</code>
                {scheme.description !== undefined && (
                  <span className={styles.muted}> — {withCode(scheme.description)}</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      <div className={styles.layout}>
        <nav className={styles.contents} aria-label="Endpoints">
          {sections.map((section) => (
            <div key={section.name}>
              <a className={styles.contentsTag} href={`#tag-${section.name}`}>
                {section.name}
              </a>
              {section.operations.map(({ method, operation, anchor, path }) => (
                <a key={anchor} className={styles.contentsItem} href={`#${anchor}`}>
                  <span className={styles.contentsMethod} data-sv={METHOD_COLORS[method]}>
                    {method.toUpperCase()}
                  </span>
                  <span className={styles.contentsSummary}>{operation.summary ?? path}</span>
                </a>
              ))}
            </div>
          ))}
        </nav>

        <div className={styles.sections}>
          {sections.map((section) => (
            <section
              key={section.name}
              id={`tag-${section.name}`}
              aria-label={section.name}
              className={styles.section}
            >
              <div className={styles.sectionHead}>
                <h2 className={styles.tag}>{section.name}</h2>
                {section.description !== undefined && (
                  <p className={styles.summary}>{withCode(section.description)}</p>
                )}
              </div>
              {section.operations.map((entry) => (
                <OperationCard key={entry.anchor} spec={spec} entry={entry} />
              ))}
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
