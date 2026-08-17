import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { GlobalModal } from '@/types/modals';
import type { ModalContextValue, ModalProviderProps } from './types/modalProvider';

/**
 * The modals that belong to the app rather than to a record.
 *
 * Anything carrying a subject — assign, check in, change status, edit — stays
 * local state on the page that knows the subject. These six are different: the
 * command palette can open four of them from anywhere, and two of them are
 * reachable from more than one screen. Without one owner they would be the same
 * boolean declared in three places.
 */
const ModalContext = createContext<ModalContextValue | null>(null);

export function ModalProvider({ children }: ModalProviderProps) {
  const [open, setOpen] = useState<GlobalModal | null>(null);

  const openModal = useCallback((modal: GlobalModal) => setOpen(modal), []);
  const closeModal = useCallback(() => setOpen(null), []);
  const value = useMemo(() => ({ open, openModal, closeModal }), [open, openModal, closeModal]);

  return <ModalContext.Provider value={value}>{children}</ModalContext.Provider>;
}

export function useModals() {
  const context = useContext(ModalContext);
  if (!context) throw new Error('useModals must be used inside <ModalProvider>');
  return context;
}
