import { useId, type ReactNode } from 'react';
import { ApiError } from '../../api/client';
import { useMeta } from '../../api/queries';
import { Icon, IconButton } from '../../components/ui';
import { useTheme } from '../../providers/ThemeProvider';
import styles from './Auth.module.css';

/** The centered 360px column shared by every signed-out screen. */
export function AuthLayout({
  title,
  subtitle,
  children,
  below,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  below?: ReactNode;
}) {
  const { theme, toggleTheme } = useTheme();
  const { data: meta } = useMeta();

  return (
    <div className={styles.screen}>
      <IconButton
        icon={theme === 'light' ? 'sun' : 'moon'}
        label="Toggle theme"
        bordered
        size={30}
        className={styles.themeToggle}
        onClick={toggleTheme}
      />
      <div className={styles.column}>
        <div className={styles.header}>
          <span className={styles.logo}>
            <Icon name="cube" size={20} />
          </span>
          <div className={styles.headings}>
            <h1 className={styles.title}>{title}</h1>
            {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
          </div>
        </div>
        <div className={styles.card}>{children}</div>
        {below}
        <div className={styles.footer}>
          v{meta?.version ?? '—'} · open source · self-hosted at {window.location.host}
        </div>
      </div>
    </div>
  );
}

export function AuthField({
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  autoComplete,
  autoFocus,
  error,
  hint,
  trailing,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  error?: string;
  hint?: string;
  /** Rendered opposite the label, e.g. the "Forgot?" link. */
  trailing?: ReactNode;
}) {
  const id = useId();
  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <label className={styles.label} htmlFor={id}>
          {label}
        </label>
        {trailing}
      </div>
      <input
        id={id}
        type={type}
        className={styles.input}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && <div className={styles.fieldError}>{error}</div>}
      {hint && !error && <div className={styles.hint}>{hint}</div>}
    </div>
  );
}

/** Renders the server's message; field-level details land under their inputs. */
export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  const message =
    error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';
  return <div className={styles.error}>{message}</div>;
}
