import { useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import styles from './Dropzone.module.css';

export function Dropzone({
  onFiles,
  accept,
  label,
  inputLabel,
  hint,
  compact = false,
}: {
  onFiles: (files: FileList) => void;
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
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div
      className={styles.zone}
      data-compact={compact}
      data-over={over}
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        if (event.dataTransfer.files.length > 0) onFiles(event.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        aria-label={inputLabel}
        hidden
        onChange={(event) => {
          if (event.target.files && event.target.files.length > 0) onFiles(event.target.files);
          event.target.value = '';
        }}
      />
      <Icon name="upload" size={compact ? 14 : 18} strokeWidth={1.6} />
      <span>
        {label} <span className={styles.browse}>browse</span>
      </span>
      {hint && <span className={styles.hint}>{hint}</span>}
    </div>
  );
}
