import type { Role } from '@inventory/shared';
import type { Density, Theme } from '../providers/ThemeProvider';

export type Member = {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: 'active' | 'invited';
  employeeId: string | null;
  lastActiveAt: string | null;
  theme: Theme;
  density: Density;
  widgets: Record<string, boolean>;
};

export type Meta = {
  needsSetup: boolean;
  version: string;
  orgName?: string;
};

export type InviteDetails = {
  email: string;
  role: Role;
  orgName: string;
};
