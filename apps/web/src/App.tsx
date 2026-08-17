import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';
import { AppErrorBoundary } from './components/app/AppErrorBoundary';
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
  // Not a fallback: the prop is an injection point for tests, and its absence
  // means "make your own", which is what the app does in the browser.
  const [ownClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient ?? ownClient}>
      <ThemeProvider>
        <ToastProvider>
          <AppErrorBoundary>{children}</AppErrorBoundary>
        </ToastProvider>
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
