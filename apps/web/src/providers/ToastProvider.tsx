import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type {
  ToastContextValue,
  ToastEntry,
  ToastKind,
  ToastProviderProps,
} from './types/toastProvider';
import styles from './Toast.module.css';

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_DURATION_MS = 4000;

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(0);

  const show = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = ++nextId.current;
    setToasts((current) => [...current, { id, message, kind }]);
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, TOAST_DURATION_MS);
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.stack} role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={styles.toast}>
            <span className={styles.dot} data-kind={toast.kind} aria-hidden="true" />
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
