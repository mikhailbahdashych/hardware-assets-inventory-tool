import type { ImportReport, ImportResult } from '@/types/api';

export interface ImportWizardModalProps {
  onClose: () => void;
}

export interface ReportStepProps {
  report: ImportReport;
}

export interface DoneStepProps {
  result: ImportResult;
}

export interface IssueListProps {
  title: string;
  issues: ImportReport['errors'];
  tone: 'error' | 'warning';
}
