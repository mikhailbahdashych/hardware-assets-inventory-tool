import type { ReactNode } from 'react';
import type { GlobalModal } from '@/types/modals';

export interface ModalContextValue {
  open: GlobalModal | null;
  openModal: (modal: GlobalModal) => void;
  closeModal: () => void;
}

export interface ModalProviderProps {
  children: ReactNode;
}
