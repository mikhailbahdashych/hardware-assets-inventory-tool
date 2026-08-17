import type { ReactNode } from 'react';
import type { QueryClient } from '@tanstack/react-query';

export interface AppProvidersProps {
  children: ReactNode;
  queryClient?: QueryClient;
}
