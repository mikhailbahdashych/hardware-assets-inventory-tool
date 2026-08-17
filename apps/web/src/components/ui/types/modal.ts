import type { ReactNode } from 'react';

export interface ModalProps {
  title: ReactNode;
  subtitle?: ReactNode;
  width?: number;
  topOffset?: string;
  /** e.g. "86vh" — makes the body scroll (New asset, Add employee). */
  maxHeight?: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}
