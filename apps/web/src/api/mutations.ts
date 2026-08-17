import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  AcceptInviteInput,
  AssetCreateInput,
  AssetPatchInput,
  AssignInput,
  CheckinInput,
  CustomFieldCreateInput,
  CustomFieldPatchInput,
  EmployeeCreateInput,
  EmployeePatchInput,
  InviteInput,
  LoginInput,
  MemberPatchInput,
  PrefsPatchInput,
  ResetPasswordInput,
  SettingsPatchInput,
  SetupInput,
  WorkspaceDeleteInput,
} from '@inventory/shared';
import { apiFetch, apiUpload } from './client';
import { invalidateAdmin, invalidateInventory } from './invalidate';
import { queryKeys } from './queries';
import type { Asset, Attachment, Employee, Member, MemberSummary, OrgSettings } from '@/types/api';

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

// Inventory writes. Every one of them goes through invalidateInventory, which
// refreshes each surface a write can touch — see the note there.

export function useCreateAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AssetCreateInput) =>
      apiFetch<{ asset: Asset }>('/assets', { method: 'POST', body: input }),
    onSuccess: () => invalidateInventory(queryClient),
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
    onSuccess: () => invalidateInventory(queryClient),
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
    onSuccess: () => invalidateInventory(queryClient),
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
    onSuccess: () => invalidateInventory(queryClient),
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

// Assign and check-in are operations, not edits: they open and close ownership
// records, so they have their own endpoints and their own hooks.

export function useAssignAsset(assetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AssignInput) =>
      apiFetch<{ asset: Asset }>(`/assets/${encodeURIComponent(assetId)}/assign`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => invalidateInventory(queryClient),
  });
}

export function useCheckinAsset(assetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CheckinInput) =>
      apiFetch<{ asset: Asset }>(`/assets/${encodeURIComponent(assetId)}/checkin`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => invalidateInventory(queryClient),
  });
}

export function useUploadAttachment(assetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return apiUpload<{ attachment: Attachment }>(
        `/assets/${encodeURIComponent(assetId)}/attachments`,
        body,
      );
    },
    onSuccess: () => invalidateInventory(queryClient),
  });
}

export function useDeleteAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/attachments/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => invalidateInventory(queryClient),
  });
}

// Custom fields change the shape of every asset, so their writes invalidate
// the definitions and everything that renders values through them.
function useCustomFieldMutation<TInput>(request: (input: TInput) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.customFields });
      invalidateInventory(queryClient);
    },
  });
}

export const useCreateCustomField = () =>
  useCustomFieldMutation((input: CustomFieldCreateInput) =>
    apiFetch('/custom-fields', { method: 'POST', body: input }),
  );

export const useUpdateCustomField = () =>
  useCustomFieldMutation((input: { id: string } & CustomFieldPatchInput) =>
    apiFetch(`/custom-fields/${encodeURIComponent(input.id)}`, {
      method: 'PATCH',
      body: { label: input.label, sortOrder: input.sortOrder },
    }),
  );

export const useDeleteCustomField = () =>
  useCustomFieldMutation((id: string) =>
    apiFetch(`/custom-fields/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  );

// Admin writes: members, invitations and workspace settings. They all go
// through invalidateAdmin for the same reason inventory writes go through
// invalidateInventory — see the note there.

function useAdminMutation<TInput, TResult>(request: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => invalidateAdmin(queryClient),
  });
}

const member = (id: string) => `/members/${encodeURIComponent(id)}`;

/**
 * The response carries the invitation link in full. It is the only time the
 * raw token exists — the database keeps its hash — so the modal shows it
 * rather than assuming an email went out.
 */
export const useInviteMember = () =>
  useAdminMutation((input: InviteInput) =>
    apiFetch<{ member: MemberSummary; inviteUrl: string }>('/members/invites', {
      method: 'POST',
      body: input,
    }),
  );

export const useResendInvite = () =>
  useAdminMutation((id: string) =>
    apiFetch<{ inviteUrl: string }>(`${member(id)}/resend-invite`, { method: 'POST' }),
  );

/** The recovery path on an instance with no SMTP: an admin hands this over. */
export const useIssueResetLink = () =>
  useAdminMutation((id: string) =>
    apiFetch<{ resetUrl: string }>(`${member(id)}/reset-link`, { method: 'POST' }),
  );

export const useUpdateMember = () =>
  useAdminMutation((input: { id: string } & MemberPatchInput) =>
    apiFetch<{ member: MemberSummary }>(member(input.id), {
      method: 'PATCH',
      body: { role: input.role, employeeId: input.employeeId },
    }),
  );

export const useRemoveMember = () =>
  useAdminMutation((id: string) => apiFetch(member(id), { method: 'DELETE' }));

export const useUpdateSettings = () =>
  useAdminMutation((input: SettingsPatchInput) =>
    apiFetch<{ settings: OrgSettings }>('/settings', { method: 'PATCH', body: input }),
  );

/**
 * Everything goes, including the session that asked for it, so every cached
 * read is now a lie — invalidating all of them refetches what is still mounted
 * and `/meta` then reports an uninitialized instance, which is what sends the
 * router back to /setup.
 *
 * Not `clear()` (it empties the mutation cache too, dropping this mutation's
 * own callbacks mid-flight) and not `removeQueries()` (a removed query leaves
 * its live observers holding the last result, so nothing refetches and the app
 * carries on showing a workspace that no longer exists).
 */
export function useDeleteWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: WorkspaceDeleteInput) =>
      apiFetch('/workspace/delete', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}
