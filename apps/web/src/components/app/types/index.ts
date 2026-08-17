// A component imports its own type module directly (`./types/appShell`), never
// this barrel — that is what keeps the barrel from forming an import cycle.
export type { AppErrorBoundaryProps, AppErrorBoundaryState } from './appErrorBoundary';
export type { AppShellProps } from './appShell';
export type { CommandPaletteProps } from './commandPalette';
export type { ListToolbarProps } from './listToolbar';
export type { ModalHostProps } from './modalHost';
export type { GatedNavItem, NavItem } from './nav';
export type { NotifyCheckboxProps } from './notifyCheckbox';
export type { PageContainerProps } from './pageContainer';
export type {
  ActionDefinition,
  PaletteEffect,
  PaletteGroup,
  PaletteInput,
  PaletteRow,
} from './palette';
export type { SidebarProps } from './sidebar';
