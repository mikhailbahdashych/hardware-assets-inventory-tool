import { useMemo, useState } from 'react';
import {
  autoMatchColumns,
  importColumns,
  IMPORT_KINDS,
  IMPORT_KIND_LABELS,
  IMPORT_NOTES,
  type ImportKind,
} from '@inventory/shared';
import { useCommitImport, useValidateImport } from '@/api/mutations';
import { Button, Dropzone, Modal, SegmentedControl, Select } from '@/components/ui';
import { useToast } from '@/providers/ToastProvider';
import type { ImportReport, ImportResult } from '@/types/api';
import type { ColumnMapping, ImportStep, ParsedCsv } from '@/types/import';
import { MAX_IMPORT_ROWS, parseCsv } from './parseCsv';
import styles from './Import.module.css';

const PREVIEW_ROWS = 3;

/**
 * The five-step import the design promises: choose a kind and a file, map the
 * columns, read the dry run, commit, and see what happened.
 *
 * The file never leaves the browser as CSV. The mapping step turns it into the
 * canonical rows the API validates, which is why the server needs no parser and
 * no knowledge of what a particular spreadsheet called its columns.
 */
export function ImportWizardModal({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<ImportKind>('assets');
  const [step, setStep] = useState<ImportStep>('file');
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [report, setReport] = useState<ImportReport | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const toast = useToast();
  const validate = useValidateImport();
  const commit = useCommitImport();
  const columns = importColumns(kind);

  const missingRequired = columns
    .filter((column) => column.required && !mapping[column.header])
    .map((column) => column.header);

  /** The file's rows under canonical keys — what both endpoints receive. */
  const canonicalRows = useMemo(() => {
    if (parsed?.ok !== true) return [];
    return parsed.rows.map((row) => {
      const mapped: Record<string, string> = {};
      for (const column of columns) {
        const header = mapping[column.header];
        if (header !== undefined && header !== '') mapped[column.header] = row[header] ?? '';
      }
      return mapped;
    });
  }, [parsed, mapping, columns]);

  async function readFile(file: File): Promise<void> {
    const next = await parseCsv(file);
    setParsed(next);
    // Guessing the mapping here rather than on the next step means a person
    // arrives at a form that is usually already right.
    setMapping(next.ok ? cleanMatches(autoMatchColumns(kind, next.headers)) : {});
  }

  function changeKind(next: ImportKind): void {
    setKind(next);
    setParsed(null);
    setMapping({});
  }

  return (
    <Modal
      title="Import from CSV"
      subtitle="Bulk-add assets or employees to the inventory"
      width={560}
      topOffset="9vh"
      maxHeight="84vh"
      onClose={onClose}
      footer={<Footer />}
    >
      {step === 'file' && <FileStep />}
      {step === 'mapping' && <MappingStep />}
      {step === 'report' && report && <ReportStep report={report} />}
      {step === 'done' && result && <DoneStep result={result} />}
    </Modal>
  );

  function Footer() {
    if (step === 'file') {
      return (
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={parsed?.ok !== true} onClick={() => setStep('mapping')}>
            Continue to mapping
          </Button>
        </>
      );
    }
    if (step === 'mapping') {
      return (
        <>
          <Button variant="ghost" onClick={() => setStep('file')}>
            Back
          </Button>
          <Button
            disabled={missingRequired.length > 0 || validate.isPending}
            onClick={() =>
              validate.mutate(
                { kind, rows: canonicalRows },
                {
                  onSuccess: ({ report: next }) => {
                    setReport(next);
                    setStep('report');
                  },
                  onError: (error) => toast.show(error.message, 'err'),
                },
              )
            }
          >
            Check the file
          </Button>
        </>
      );
    }
    if (step === 'report' && report) {
      return (
        <>
          <Button variant="ghost" onClick={() => setStep('mapping')}>
            Back
          </Button>
          {report.errors.length === 0 && report.validCount > 0 && (
            <Button
              disabled={commit.isPending}
              onClick={() =>
                commit.mutate(
                  { kind, rows: canonicalRows },
                  {
                    onSuccess: (next) => {
                      setResult(next);
                      setStep('done');
                    },
                    onError: (error) => toast.show(error.message, 'err'),
                  },
                )
              }
            >
              Import {report.validCount} rows
            </Button>
          )}
        </>
      );
    }
    return (
      <Button variant="ghost" onClick={onClose}>
        Done
      </Button>
    );
  }

  function FileStep() {
    return (
      <div className={styles.step}>
        <SegmentedControl
          options={IMPORT_KINDS.map((value) => ({ value, label: IMPORT_KIND_LABELS[value] }))}
          value={kind}
          onChange={changeKind}
        />

        <div className={styles.templateRow}>
          <div className={styles.listText}>
            <div className={styles.rowLabel}>{kind}-template.csv</div>
            <div className={styles.rowHint}>
              {columns.length} columns · UTF-8, comma-separated · 2 example rows
            </div>
          </div>
          <a className={styles.templateLink} href={`/api/v1/import/template?kind=${kind}`} download>
            Download template
          </a>
        </div>

        <Dropzone
          label="Drop your CSV here or"
          inputLabel="CSV file"
          accept=".csv,text/csv"
          hint={`Up to ${MAX_IMPORT_ROWS.toLocaleString('en-US')} rows per import · you'll review column mapping next`}
          onFiles={(files) => void readFile(files[0])}
        />

        {parsed?.ok === false && <p className={styles.error}>{parsed.reason}</p>}
        {parsed?.ok === true && (
          <p className={styles.readNote}>
            Read <strong>{parsed.filename}</strong> · {parsed.rows.length}{' '}
            {parsed.rows.length === 1 ? 'row' : 'rows'} · {parsed.headers.length} columns
          </p>
        )}

        <div className={styles.columnsBlock}>
          <span className={styles.blockTitle}>Columns</span>
          <div className={styles.chips}>
            {columns.map((column) => (
              <span key={column.header} className={styles.chip} data-required={column.required}>
                {column.required ? `${column.header} *` : column.header}
              </span>
            ))}
          </div>
          <span className={styles.rowHint}>{IMPORT_NOTES[kind]}</span>
        </div>
      </div>
    );
  }

  function MappingStep() {
    if (parsed?.ok !== true) return null;
    return (
      <div className={styles.step}>
        <p className={styles.rowHint}>
          Point each column at the one in your file. Anything left blank is imported empty.
        </p>

        <div className={styles.mapping}>
          {columns.map((column) => (
            <label key={column.header} className={styles.mapRow}>
              <span className={styles.mapLabel} data-required={column.required}>
                {column.header}
              </span>
              <Select
                aria-label={column.header}
                value={mapping[column.header] ?? ''}
                onChange={(event) =>
                  setMapping((current) => ({ ...current, [column.header]: event.target.value }))
                }
              >
                <option value="">— Not imported —</option>
                {parsed.headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </Select>
            </label>
          ))}
        </div>

        {missingRequired.length > 0 && (
          <p className={styles.error}>
            {missingRequired.join(', ')} {missingRequired.length === 1 ? 'is' : 'are'} required.
          </p>
        )}

        <div className={styles.columnsBlock}>
          <span className={styles.blockTitle}>Preview</span>
          <div className={styles.preview}>
            {canonicalRows.slice(0, PREVIEW_ROWS).map((row, index) => (
              <div key={index} className={styles.previewRow}>
                {columns
                  .filter((column) => mapping[column.header])
                  .map((column) => (
                    <span key={column.header} className={styles.previewCell}>
                      {row[column.header]}
                    </span>
                  ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  function ReportStep({ report: shown }: { report: ImportReport }) {
    const blocked = shown.errors.length > 0;
    return (
      <div className={styles.step}>
        <div className={styles.summary} data-blocked={blocked}>
          <div className={styles.summaryHead}>
            {blocked
              ? `${shown.totalRows - shown.validCount} of ${shown.totalRows} rows cannot be imported`
              : `${shown.validCount} rows ready`}
          </div>
          <div className={styles.rowHint}>
            {shown.createCount} new {kind} · {shown.updateCount} updated
          </div>
        </div>

        {blocked && (
          <IssueList
            title={`Errors${shown.errorsTruncated ? ' (first 100)' : ''}`}
            issues={shown.errors}
            tone="error"
          />
        )}
        {shown.warnings.length > 0 && (
          <IssueList
            title={`Warnings${shown.warningsTruncated ? ' (first 100)' : ''}`}
            issues={shown.warnings}
            tone="warning"
          />
        )}
        {blocked && (
          <p className={styles.rowHint}>Fix the file and try again, or go back and remap.</p>
        )}
      </div>
    );
  }

  function DoneStep({ result: done }: { result: ImportResult }) {
    return (
      <div className={styles.step}>
        <div className={styles.summary}>
          <div className={styles.summaryHead}>
            Added {done.created} {done.kind}
            {done.updated > 0 && ` · updated ${done.updated}`}
          </div>
          <div className={styles.rowHint}>The whole file was written in one go.</div>
        </div>
      </div>
    );
  }
}

function IssueList({
  title,
  issues,
  tone,
}: {
  title: string;
  issues: ImportReport['errors'];
  tone: 'error' | 'warning';
}) {
  return (
    <div className={styles.columnsBlock}>
      <span className={styles.blockTitle}>{title}</span>
      <div className={styles.issues}>
        {issues.map((issue, index) => (
          <div key={index} className={styles.issue} data-tone={tone}>
            <span className={styles.issueWhere}>
              Row {issue.row} · {issue.column}
            </span>
            <span>{issue.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Drops the columns the auto-matcher had no header for, so `?? ''` never fires. */
function cleanMatches(matched: Record<string, string | undefined>): ColumnMapping {
  const mapping: ColumnMapping = {};
  for (const [column, header] of Object.entries(matched)) {
    if (header !== undefined) mapping[column] = header;
  }
  return mapping;
}
