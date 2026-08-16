import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

// The topbar breadcrumb ends with the record you are looking at ("Assets /
// AST-0142"), which only the detail page knows. Rather than have the shell
// guess from the URL, each detail page announces its label here.

type Setter = (label: string | null) => void;

const BreadcrumbDetailContext = createContext<{ label: string | null; set: Setter }>({
  label: null,
  set: () => {},
});

export function BreadcrumbDetailProvider({ children }: { children: ReactNode }) {
  const [label, setLabel] = useState<string | null>(null);
  return (
    <BreadcrumbDetailContext.Provider value={{ label, set: setLabel }}>
      {children}
    </BreadcrumbDetailContext.Provider>
  );
}

export function useBreadcrumbDetail(): string | null {
  return useContext(BreadcrumbDetailContext).label;
}

/** Detail pages call this with their identifier; it clears on unmount. */
export function usePageBreadcrumb(label: string | null | undefined): void {
  const { set } = useContext(BreadcrumbDetailContext);
  useEffect(() => {
    // A page whose record has not loaded has no label yet, which the context
    // spells null.
    set(label ?? null);
    return () => set(null);
  }, [label, set]);
}
