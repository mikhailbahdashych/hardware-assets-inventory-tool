import type { ReactNode } from 'react';
import { can, type Role } from '@inventory/shared';
import { Button, SegmentedControl } from '@/components/ui';
import { useModals } from '@/providers/ModalProvider';
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

/** Opens the import wizard — the same one the command palette's action opens. */
export function ImportCsvButton() {
  const { openModal } = useModals();
  return (
    <Button variant="ghost" icon="upload" onClick={() => openModal('import')}>
      Import CSV
    </Button>
  );
}

/** Title · density · import · primary action, in the design's order. */
export function ListToolbar({
  title,
  role,
  children,
}: {
  title: string;
  role: Role;
  children?: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0, marginRight: 'auto' }}>{title}</h1>
      <DensityControl />
      {can(role, 'import.run') && <ImportCsvButton />}
      {children}
    </div>
  );
}
