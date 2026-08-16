import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  AcceptInviteInput,
  LoginInput,
  PrefsPatchInput,
  ResetPasswordInput,
  SetupInput,
} from '@inventory/shared';
import { apiFetch } from './client';
import { queryKeys } from './queries';
import type { Member } from './types';

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
