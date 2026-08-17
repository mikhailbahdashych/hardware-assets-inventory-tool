import { useQuery } from '@tanstack/react-query';
import type { AuditType } from '@inventory/shared';
import { ApiError, apiFetch } from './client';
import type {
  Asset,
  AssetDetail,
  AuditPage,
  CustomFieldDef,
  Employee,
  EmployeeDetail,
  InviteDetails,
  Member,
  MemberSummary,
  Meta,
  OrgMeta,
  OrgSettings,
} from '@/types/api';

/**
 * The query-key catalog. Every cached read is listed here so invalidation
 * after a mutation is a lookup rather than a guess (see api/invalidate.ts).
 */
export const queryKeys = {
  meta: ['meta'] as const,
  me: ['me'] as const,
  invite: (token: string) => ['invite', token] as const,
  assets: ['assets'] as const,
  asset: (id: string) => ['asset', id] as const,
  nextAssetTag: ['assets', 'next-tag'] as const,
  employees: ['employees'] as const,
  employee: (id: string) => ['employee', id] as const,
  customFields: ['custom-fields'] as const,
  members: ['members'] as const,
  settings: ['settings'] as const,
  audit: (filter: AuditFilter) => ['audit', filter] as const,
};

/** What the activity log is currently showing — both halves live in the URL. */
export interface AuditFilter {
  type?: AuditType;
  limit: number;
}

export function useMeta() {
  return useQuery({
    queryKey: queryKeys.meta,
    queryFn: () => apiFetch<Meta>('/meta'),
  });
}

/**
 * The organization's own metadata, for the screens that only exist once setup
 * has run. `orgName` and `defaultCurrency` are NOT NULL columns written by
 * /setup, so an absent one means /meta broke its contract — and calling the
 * workspace "Inventory" or pricing everything in EUR because the call failed
 * would be a lie that survives to a screenshot.
 *
 * Safe to call anywhere inside the signed-in app: routes.tsx blocks on /meta
 * before the shell mounts, so the query has resolved by then.
 */
export function orgMeta(meta: Meta | undefined): OrgMeta {
  if (!meta) {
    throw new Error('GET /api/v1/meta has not answered, so this instance cannot be described.');
  }
  if (meta.orgName === undefined || meta.defaultCurrency === undefined) {
    throw new Error(
      'GET /api/v1/meta reported an initialized instance without an orgName or a defaultCurrency.',
    );
  }
  return { version: meta.version, orgName: meta.orgName, defaultCurrency: meta.defaultCurrency };
}

/** Resolves to the signed-in member, or null when nobody is signed in. */
export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: async () => {
      try {
        const { member } = await apiFetch<{ member: Member }>('/auth/me');
        return member;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
  });
}

export function useInvite(token: string) {
  return useQuery({
    queryKey: queryKeys.invite(token),
    queryFn: () => apiFetch<InviteDetails>(`/auth/invite/${encodeURIComponent(token)}`),
    enabled: token.length > 0,
    retry: false,
  });
}

/** The whole inventory in one payload — filtering and counting are local. */
export function useAssets() {
  return useQuery({
    queryKey: queryKeys.assets,
    queryFn: async () => (await apiFetch<{ assets: Asset[] }>('/assets')).assets,
  });
}

export function useAsset(id: string) {
  return useQuery({
    queryKey: queryKeys.asset(id),
    queryFn: () => apiFetch<AssetDetail>(`/assets/${encodeURIComponent(id)}`),
    enabled: id.length > 0,
    retry: false,
  });
}

/** Prefills the New-asset form; the field stays editable, so this is a hint. */
export function useNextAssetTag(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.nextAssetTag,
    queryFn: async () => (await apiFetch<{ assetTag: string }>('/assets/next-tag')).assetTag,
    enabled,
    staleTime: 0,
    gcTime: 0,
  });
}

export function useEmployees() {
  return useQuery({
    queryKey: queryKeys.employees,
    queryFn: async () => (await apiFetch<{ employees: Employee[] }>('/employees')).employees,
  });
}

/** The person, what they hold, and what they handed back — one payload. */
export function useEmployee(id: string) {
  return useQuery({
    queryKey: queryKeys.employee(id),
    queryFn: () => apiFetch<EmployeeDetail>(`/employees/${encodeURIComponent(id)}`),
    enabled: id.length > 0,
    retry: false,
  });
}

export function useCustomFields() {
  return useQuery({
    queryKey: queryKeys.customFields,
    queryFn: async () =>
      (await apiFetch<{ customFields: CustomFieldDef[] }>('/custom-fields')).customFields,
    staleTime: 5 * 60 * 1000,
  });
}

/** Everyone can read the member list; only admins can change anything on it. */
export function useMembers() {
  return useQuery({
    queryKey: queryKeys.members,
    queryFn: async () => (await apiFetch<{ members: MemberSummary[] }>('/members')).members,
  });
}

/** Admin-only, like every screen that reads it. */
export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: async () => (await apiFetch<{ settings: OrgSettings }>('/settings')).settings,
  });
}

/**
 * One page of the activity log. "Load more" raises the limit and refetches
 * from the top rather than appending pages: the log grows at the head, so an
 * appended page would duplicate whatever arrived while you were reading.
 */
export function useAuditLog(filter: AuditFilter) {
  return useQuery({
    queryKey: queryKeys.audit(filter),
    queryFn: () => apiFetch<AuditPage>(`/audit?${auditParams(filter)}`),
    // Keeps the previous page on screen while a wider one loads, so the table
    // does not blank out every time the filter changes.
    placeholderData: (previous) => previous,
  });
}

export function auditParams(filter: AuditFilter): string {
  const params = new URLSearchParams({ limit: String(filter.limit) });
  if (filter.type) params.set('type', filter.type);
  return params.toString();
}
