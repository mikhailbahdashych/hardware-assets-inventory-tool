import { useQuery } from '@tanstack/react-query';
import { ApiError, apiFetch } from './client';
import type {
  Asset,
  AssetDetail,
  CustomFieldDef,
  Employee,
  InviteDetails,
  Member,
  Meta,
} from './types';

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
};

export function useMeta() {
  return useQuery({
    queryKey: queryKeys.meta,
    queryFn: () => apiFetch<Meta>('/meta'),
  });
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

export function useEmployee(id: string) {
  return useQuery({
    queryKey: queryKeys.employee(id),
    queryFn: async () =>
      (await apiFetch<{ employee: Employee }>(`/employees/${encodeURIComponent(id)}`)).employee,
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
