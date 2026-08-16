import type { ReactNode } from 'react';
import { Button, SegmentedControl } from '@/components/ui';
import { useToast } from '@/providers/ToastProvider';
import { useThemeControls } from './useThemeControls';

const DENSITY_OPTIONS = [
  { value: 'comfortable' as const, label: 'Comfortable', title: 'Comfortable rows' },
  { value: 'compact' as const, label: 'Compact', title: 'Compact rows' },
];

/** Row padding, persisted per member like the theme. */
export function DensityControl() {
  const { density, changeDensity } = useThemeControls();
  return <SegmentedControl options={DENSITY_OPTIONS} value={density} onChange={changeDensity} />;
}

/**
 * The Import CSV affordance the list toolbars carry. The wizard itself lands
 * with the import PR; until then the button says so rather than disappearing
 * and changing the toolbar the design specifies.
 */
export function ImportCsvButton() {
  const toast = useToast();
  return (
    <Button
      variant="ghost"
      icon="upload"
      onClick={() => toast.show('CSV import arrives with the import wizard.')}
    >
      Import CSV
    </Button>
  );
}

/** Title · density · import · primary action, in the design's order. */
export function ListToolbar({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0, marginRight: 'auto' }}>{title}</h1>
      <DensityControl />
      <ImportCsvButton />
      {children}
    </div>
  );
}
