import { ASSET_CATEGORY_LABELS, can } from '@inventory/shared';
import { isAdmin } from '@/lib/roles';
import { navSectionsFor } from './nav';
import { statusInfo, statusMap } from '@/lib/workflow';
import type { ActionDefinition, PaletteGroup, PaletteInput, PaletteRow } from './types/palette';

// The palette's contents, as data. Pure so the grouping and the permission
// filtering are testable without a keyboard.
//
// Assets and people are searched and capped by `GET /search` — four of each,
// because past that the list stops being scannable and starts being a table.
// The commands stay here and are still matched locally: they are a few strings
// this build already knows, and a round trip to filter them would be silly.
//
// The pages are not listed here at all: they are the sidebar's own items, read
// through the same permission filter (`navSectionsFor`), so the palette can
// never offer a page the sidebar would not, nor miss one it gains.

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
  {
    // No `requires`: your own password is yours whatever the role grants.
    title: 'Change password',
    icon: 'key',
    effect: { kind: 'modal', modal: 'changePassword' },
  },
  { title: 'Toggle theme', icon: 'moon', effect: { kind: 'theme' }, keywords: ['dark', 'light'] },
  {
    // Not in the sidebar — the API tokens page links to it — but the palette is
    // a search, and an admin who knows the page exists should find it by name.
    title: 'API reference',
    icon: 'file',
    effect: { kind: 'navigate', to: '/api-docs' },
    adminOnly: true,
    keywords: ['docs', 'openapi'],
  },
];

/**
 * A command matches on its title or on any of its keywords. An absent list is
 * a command with no other names, which is most of them.
 */
const matches = (query: string, title: string, keywords: string[] = []): boolean =>
  query === '' || [title, ...keywords].some((word) => word.toLowerCase().includes(query));

/**
 * The grouped result list. Groups with nothing in them are left out entirely
 * rather than rendered empty, and the whole thing is flat enough that the
 * keyboard can walk it as one list — see `paletteRows`.
 */
export function paletteGroups(input: PaletteInput): PaletteGroup[] {
  const query = input.query.trim().toLowerCase();
  // Statuses are workspace data; a palette row names one, so it reads the same
  // list every pill does rather than a label map of its own.
  const byId = statusMap(input.statuses);

  const assets = input.results.assets.map((asset): PaletteRow => ({
    id: `asset-${asset.id}`,
    icon: 'cube',
    title: asset.name,
    subtitle: `${asset.assetTag} · ${statusInfo(byId, asset.status).label}`,
    hint: ASSET_CATEGORY_LABELS[asset.category],
    effect: { kind: 'navigate', to: `/assets/${asset.id}` },
  }));

  const employees = input.results.employees.map((employee): PaletteRow => ({
    id: `employee-${employee.id}`,
    icon: 'user',
    title: employee.displayName,
    // Both halves are nullable columns; an em dash is the design's blank.
    subtitle: `${employee.jobTitle ?? '—'} · ${employee.department ?? '—'}`,
    hint: 'Employee',
    effect: { kind: 'navigate', to: `/employees/${employee.id}` },
  }));

  const actions = ACTIONS.filter((action) =>
    action.adminOnly
      ? isAdmin(input.role)
      : action.requires === undefined || can(input.permissions, action.requires),
  )
    .filter((action) => matches(query, action.title, action.keywords))
    .map((action): PaletteRow => ({
      id: `action-${action.title}`,
      icon: action.icon,
      title: action.title,
      subtitle: '',
      hint: 'Action',
      effect: action.effect,
    }));

  const sections = navSectionsFor(input.permissions, input.role);
  const pages = [...sections.inventory, ...sections.workspace]
    .filter((item) => matches(query, item.label, item.keywords))
    .map((item): PaletteRow => ({
      id: `page-${item.to}`,
      icon: item.icon,
      title: item.label,
      subtitle: '',
      hint: 'Page',
      effect: { kind: 'navigate', to: item.to },
    }));

  return [
    { label: 'Assets', rows: assets },
    { label: 'Employees', rows: employees },
    { label: 'Actions', rows: actions },
    { label: 'Pages', rows: pages },
  ].filter((group) => group.rows.length > 0);
}

/** The same rows in one flat list, which is what ↑↓ actually moves through. */
export function paletteRows(groups: PaletteGroup[]): PaletteRow[] {
  return groups.flatMap((group) => group.rows);
}
