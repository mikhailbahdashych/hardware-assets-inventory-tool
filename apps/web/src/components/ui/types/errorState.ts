import type { ReactNode } from 'react';

export interface ErrorStateProps {
  /**
   * Whatever the read threw, unnarrowed — `client.ts` has three kinds of it
   * and the panel reads the message off each rather than being told one.
   */
  error: unknown;
  /** Usually a query's own `refetch`. */
  onRetry: () => void;
  /** What failed, in the page's words: "The member list could not be loaded." */
  children: ReactNode;
}
