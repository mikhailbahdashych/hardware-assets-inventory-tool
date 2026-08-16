import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';
import { ThemeProvider } from './providers/ThemeProvider';
import { ToastProvider } from './providers/ToastProvider';
import { AppRoutes } from './routes';

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Multi-user instance: prefer freshness on focus over aggressive caching.
        staleTime: 30_000,
        retry: 1,
      },
    },
  });
}

export function AppProviders({
  children,
  queryClient,
}: {
  children: ReactNode;
  queryClient?: QueryClient;
}) {
  const [fallbackClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient ?? fallbackClient}>
      <ThemeProvider>
        <ToastProvider>{children}</ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default function App() {
  return (
    <AppProviders>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppProviders>
  );
}
