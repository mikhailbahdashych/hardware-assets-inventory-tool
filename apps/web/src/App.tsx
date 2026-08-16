import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { Icon } from './components/ui';
import { ThemeProvider } from './providers/ThemeProvider';
import { ToastProvider } from './providers/ToastProvider';

// Dev-only design-system review page; the conditional is statically false in
// production builds, so the chunk is dropped entirely.
const KitchenSink = import.meta.env.DEV
  ? lazy(() => import('./features/dev/KitchenSink').then((m) => ({ default: m.KitchenSink })))
  : null;

function Placeholder() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          background: 'var(--acc-bg)',
          color: 'var(--accent)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="cube" size={20} />
      </div>
      <div style={{ fontSize: 17, fontWeight: 600 }}>Inventory</div>
      <div style={{ fontSize: '12.5px', color: 'var(--muted)', textAlign: 'center' }}>
        The app shell arrives in an upcoming PR.
        {import.meta.env.DEV && (
          <>
            {' '}
            Meanwhile, review the design system at <a href="/kitchen-sink">/kitchen-sink</a>.
          </>
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            {KitchenSink && (
              <Route
                path="/kitchen-sink"
                element={
                  <Suspense fallback={null}>
                    <KitchenSink />
                  </Suspense>
                }
              />
            )}
            <Route path="*" element={<Placeholder />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </ThemeProvider>
  );
}
