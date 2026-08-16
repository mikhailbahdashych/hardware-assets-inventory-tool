import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  AcceptInviteInput,
  AssetCreateInput,
  AssetPatchInput,
  EmployeeCreateInput,
  EmployeePatchInput,
  LoginInput,
  PrefsPatchInput,
  ResetPasswordInput,
  SetupInput,
} from '@inventory/shared';
import { apiFetch } from './client';
import { invalidateInventory } from './invalidate';
import { queryKeys } from './queries';
import type { Asset, Employee, Member } from './types';

/** Signing in, accepting an invite and resetting a password all end with a session. */
function useSessionMutation<TInput>(path: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TInput) =>
      apiFetch<{ member: Member }>(path, { method: 'POST', body: input }),
    onSuccess: ({ member }) => {
      queryClient.setQueryData(queryKeys.me, member);
      queryClient.invalidateQueries({ queryKey: queryKeys.meta });
    },
  });
}

export const useLogin = () => useSessionMutation<LoginInput>('/auth/login');
export const useSetup = () => useSessionMutation<SetupInput>('/setup');
export const useAcceptInvite = () => useSessionMutation<AcceptInviteInput>('/auth/accept-invite');
export const useResetPassword = () =>
  useSessionMutation<ResetPasswordInput>('/auth/reset-password');

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch('/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      queryClient.setQueryData(queryKeys.me, null);
      queryClient.clear();
    },
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (input: { email: string }) =>
      apiFetch('/auth/forgot-password', { method: 'POST', body: input }),
  });
}

/** Theme, density and dashboard-widget visibility, persisted per member. */
export function useUpdatePrefs() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PrefsPatchInput) =>
      apiFetch<{ member: Member }>('/me/prefs', { method: 'PATCH', body: input }),
    onSuccess: ({ member }) => queryClient.setQueryData(queryKeys.me, member),
  });
}

// Inventory writes. Each one hands the subject to invalidateInventory so the
// list, the detail page and the holder's page all refetch together.

export function useCreateAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AssetCreateInput) =>
      apiFetch<{ asset: Asset }>('/assets', { method: 'POST', body: input }),
    onSuccess: ({ asset }) =>
      invalidateInventory(queryClient, {
        assetId: asset.id,
        employeeId: asset.currentHolder?.employeeId ?? undefined,
      }),
  });
}

export function useUpdateAsset(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AssetPatchInput) =>
      apiFetch<{ asset: Asset }>(`/assets/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: ({ asset }) => invalidateInventory(queryClient, { assetId: asset.id }),
  });
}

export function useDeleteAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/assets/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => invalidateInventory(queryClient),
  });
}

export function useCreateEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: EmployeeCreateInput) =>
      apiFetch<{ employee: Employee }>('/employees', { method: 'POST', body: input }),
    onSuccess: ({ employee }) => invalidateInventory(queryClient, { employeeId: employee.id }),
  });
}

export function useUpdateEmployee(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: EmployeePatchInput) =>
      apiFetch<{ employee: Employee }>(`/employees/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: ({ employee }) => invalidateInventory(queryClient, { employeeId: employee.id }),
  });
}

export function useDeleteEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/employees/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => invalidateInventory(queryClient),
  });
}
