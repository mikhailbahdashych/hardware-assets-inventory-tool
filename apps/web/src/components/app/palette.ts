import { ASSET_STATUS_LABELS, ASSET_CATEGORY_LABELS, can, type Role } from '@inventory/shared';
import type { Asset, Employee } from '@/types/api';
import type { IconName } from '@/components/ui';
import type { GlobalModal } from '@/types/modals';

// The palette's contents, as data. Pure so the grouping, the cap and the
// role filtering are testable without a keyboard.

/** What choosing a row does. A union, so no row can mean two things at once. */
export type PaletteEffect =
  { kind: 'navigate'; to: string } | { kind: 'modal'; modal: GlobalModal } | { kind: 'theme' };

export interface PaletteRow {
  id: string;
  icon: IconName;
  title: string;
  /** The second line: "AST-0142 · Assigned", "Product Designer · Design". */
  subtitle: string;
  /** The right-hand word: which kind of thing this is. */
  hint: string;
  effect: PaletteEffect;
}

export interface PaletteGroup {
  label: string;
  rows: PaletteRow[];
}

/** Four of each: past that the list stops being scannable and starts being a table. */
const PER_GROUP = 4;

interface ActionDefinition {
  title: string;
  icon: IconName;
  effect: PaletteEffect;
  /** Omitted for the actions every role may take (there is one: the theme). */
  requires?: Parameters<typeof can>[1];
}

const ACTIONS: ActionDefinition[] = [
  {
    title: 'New asset',
    icon: 'plus',
    effect: { kind: 'modal', modal: 'newAsset' },
    requires: 'assets.create',
  },
  {
    title: 'Add employee',
    icon: 'user',
    effect: { kind: 'modal', modal: 'addEmployee' },
    requires: 'employees.create',
  },
  {
    title: 'Invite member',
    icon: 'shield',
    effect: { kind: 'modal', modal: 'inviteMember' },
    requires: 'members.manage',
  },
  {
    title: 'Import CSV',
    icon: 'upload',
    effect: { kind: 'modal', modal: 'import' },
    requires: 'import.run',
  },
  { title: 'Toggle theme', icon: 'moon', effect: { kind: 'theme' } },
  {
    title: 'Admin settings',
    icon: 'gear',
    effect: { kind: 'navigate', to: '/admin/settings' },
    requires: 'settings.manage',
  },
];

const matches = (query: string, ...fields: (string | null)[]): boolean =>
  query === '' || fields.some((field) => field !== null && field.toLowerCase().includes(query));

/**
 * The grouped result list. Groups with nothing in them are left out entirely
 * rather than rendered empty, and the whole thing is flat enough that the
 * keyboard can walk it as one list — see `paletteRows`.
 */
export function paletteGroups(input: {
  query: string;
  role: Role;
  assets: Asset[];
  employees: Employee[];
}): PaletteGroup[] {
  const query = input.query.trim().toLowerCase();

  const assets = input.assets
    .filter((asset) => matches(query, asset.name, asset.assetTag, asset.serialNumber))
    .slice(0, PER_GROUP)
    .map((asset): PaletteRow => ({
      id: `asset-${asset.id}`,
      icon: 'cube',
      title: asset.name,
      subtitle: `${asset.assetTag} · ${ASSET_STATUS_LABELS[asset.status]}`,
      hint: ASSET_CATEGORY_LABELS[asset.category],
      effect: { kind: 'navigate', to: `/assets/${asset.id}` },
    }));

  const employees = input.employees
    .filter((employee) => matches(query, employee.displayName, employee.email, employee.department))
    .slice(0, PER_GROUP)
    .map((employee): PaletteRow => ({
      id: `employee-${employee.id}`,
      icon: 'user',
      title: employee.displayName,
      // Both halves are nullable columns; an em dash is the design's blank.
      subtitle: `${employee.jobTitle ?? '—'} · ${employee.department ?? '—'}`,
      hint: 'Employee',
      effect: { kind: 'navigate', to: `/employees/${employee.id}` },
    }));

  const actions = ACTIONS.filter(
    (action) => action.requires === undefined || can(input.role, action.requires),
  )
    .filter((action) => matches(query, action.title))
    .map((action): PaletteRow => ({
      id: `action-${action.title}`,
      icon: action.icon,
      title: action.title,
      subtitle: '',
      hint: 'Action',
      effect: action.effect,
    }));

  return [
    { label: 'Assets', rows: assets },
    { label: 'Employees', rows: employees },
    { label: 'Actions', rows: actions },
  ].filter((group) => group.rows.length > 0);
}

/** The same rows in one flat list, which is what ↑↓ actually moves through. */
export function paletteRows(groups: PaletteGroup[]): PaletteRow[] {
  return groups.flatMap((group) => group.rows);
}
