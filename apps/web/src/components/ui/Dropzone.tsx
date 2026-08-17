import { useRef, useState } from 'react';
import { Icon } from './Icon';
import type { DropzoneProps } from './types/dropzone';
import styles from './Dropzone.module.css';

export function Dropzone({
  onFile,
  accept,
  label,
  inputLabel,
  hint,
  compact = false,
}: DropzoneProps) {
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
        const dropped = event.dataTransfer.files[0];
        if (dropped) onFile(dropped);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        aria-label={inputLabel}
        hidden
        onChange={(event) => {
          const chosen = event.target.files?.[0];
          event.target.value = '';
          if (chosen) onFile(chosen);
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
