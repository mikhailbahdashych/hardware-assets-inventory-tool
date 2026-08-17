import type { ReactNode } from 'react';

export interface DropzoneProps {
  /**
   * One file, because every caller wants the first one — handing over a
   * FileList only moved the "is there one?" question to each of them.
   */
  onFile: (file: File) => void;
  accept?: string;
  label: ReactNode;
  /**
   * Accessible name for the file input itself. The visible `label` is prose
   * around a "browse" link; this is what a screen reader — and a test — reaches
   * the control by.
   */
  inputLabel: string;
  hint?: ReactNode;
  compact?: boolean;
}
