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
  ImportCommitInput,
  ImportValidateInput,
  InviteInput,
  LoginInput,
  MemberPatchInput,
  MfaChallengeInput,
  MfaConfirmInput,
  PrefsPatchInput,
  ResetPasswordInput,
  SettingsPatchInput,
  SetupInput,
  StatusCreateInput,
  StatusPatchInput,
  WorkflowStatus,
  WorkspaceDeleteInput,
} from '@inventory/shared';
import { apiFetch, apiUpload } from './client';
import { invalidateAdmin, invalidateInventory } from './invalidate';
import { queryKeys } from './queries';
import type {
  Asset,
  Attachment,
  Employee,
  ImportReport,
  ImportResult,
  LoginResult,
  Member,
  MemberSummary,
  MfaEnrolment,
  Session,
  OrgSettings,
} from '@/types/api';

/** Signing in, accepting an invite and resetting a password all end with a session. */
function useSessionMutation<TInput>(path: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TInput) =>
      apiFetch<{ member: Member }>(path, { method: 'POST', body: input }),
    onSuccess: ({ member }) => {
      // A member who just signed in owes no enrolment — the API would have
      // answered with a challenge instead of a session if they did.
      queryClient.setQueryData(queryKeys.me, { member, mustEnrolMfa: false });
      queryClient.invalidateQueries({ queryKey: queryKeys.meta });
    },
  });
}

/**
 * The password step. Unlike the others it may *not* end in a session: an
 * account with an authenticator gets a challenge back, and `LoginPage` asks
 * for a code. Nothing is written to the cache until a session actually exists.
 */
export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) =>
      apiFetch<LoginResult>('/auth/login', { method: 'POST', body: input }),
    onSuccess: (result) => {
      if ('mfaRequired' in result) return;
      queryClient.setQueryData(queryKeys.me, { member: result.member, mustEnrolMfa: false });
      queryClient.invalidateQueries({ queryKey: queryKeys.meta });
    },
  });
}

/** The code step: a challenge token plus an authenticator or recovery code. */
export const useMfaVerify = () => useSessionMutation<MfaChallengeInput>('/auth/mfa/verify');

/** Begins enrolment — a fresh secret, not yet confirmed. */
export function useMfaEnroll() {
  return useMutation({
    mutationFn: () => apiFetch<MfaEnrolment>('/me/mfa/enroll', { method: 'POST' }),
  });
}

/**
 * Finishes it. The recovery codes come back once and are never recoverable,
 * so the screen that receives them is the only place they will ever exist.
 */
export function useMfaConfirm() {
  return useMutation({
    mutationFn: (input: MfaConfirmInput) =>
      apiFetch<{ recoveryCodes: string[] }>('/me/mfa/confirm', { method: 'POST', body: input }),
    // Deliberately does NOT invalidate `me`. The gate in routes.tsx renders on
    // `mustEnrolMfa`, so refreshing it here would unmount the enrolment page
    // the instant the code was accepted — taking the recovery codes with it,
    // which are the one thing this whole flow exists to hand over. The
    // "Continue" button does a full navigation, and that is what re-asks.
  });
}

/** Admin-only: send somebody back through setup. */
export function useResetMemberMfa() {
  return useAdminMutation((input: { id: string }) =>
    apiFetch(`/members/${input.id}/mfa/reset`, { method: 'POST' }),
  );
}
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
    // Merge, don't replace: the cache entry is the whole session, and prefs
    // say nothing about whether an enrolment is owed.
    onSuccess: ({ member }) =>
      queryClient.setQueryData(queryKeys.me, (current: Session | null | undefined) =>
        current ? { ...current, member } : current,
      ),
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

// The workflow: the statuses this workspace has and the moves between them.
// Every one of these writes changes what a pill says on every screen, so they
// refresh the workflow itself and the inventory that renders through it — and
// the admin surfaces too, because each one writes an audit event.
function useWorkflowMutation<TInput, TResult>(request: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workflow });
      invalidateInventory(queryClient);
      invalidateAdmin(queryClient);
    },
  });
}

const status = (id: string) => `/workflow/statuses/${encodeURIComponent(id)}`;

export const useCreateStatus = () =>
  useWorkflowMutation((input: StatusCreateInput) =>
    apiFetch<{ status: WorkflowStatus }>('/workflow/statuses', { method: 'POST', body: input }),
  );

/**
 * A patch carries only what changed — the row's toggles send one field, the
 * form sends its two — and an absent key means "leave it alone" all the way
 * down to the service.
 */
export const useUpdateStatus = () =>
  useWorkflowMutation((input: { id: string } & StatusPatchInput) =>
    apiFetch<{ status: WorkflowStatus }>(status(input.id), {
      method: 'PATCH',
      body: {
        label: input.label,
        color: input.color,
        assignableFrom: input.assignableFrom,
        checkinTarget: input.checkinTarget,
      },
    }),
  );

/**
 * `migrateTo` is where the assets in this status go. Absent is a real answer —
 * "nothing carries it" — and the API refuses the delete rather than orphaning
 * rows if that turns out to be wrong.
 */
export const useDeleteStatus = () =>
  useWorkflowMutation((input: { id: string; migrateTo?: string }) =>
    apiFetch(
      input.migrateTo === undefined
        ? status(input.id)
        : `${status(input.id)}?migrateTo=${encodeURIComponent(input.migrateTo)}`,
      { method: 'DELETE' },
    ),
  );

/** The arrows send the whole order, so the result is always coherent. */
export const useReorderStatuses = () =>
  useWorkflowMutation((ids: string[]) =>
    apiFetch<{ statuses: WorkflowStatus[] }>('/workflow/statuses/order', {
      method: 'PUT',
      body: { ids },
    }),
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

/**
 * The dry run. It writes nothing, so it is a mutation only in the sense that it
 * is a POST — nothing is invalidated because nothing changed.
 */
export function useValidateImport() {
  return useMutation({
    mutationFn: (input: ImportValidateInput) =>
      apiFetch<{ report: ImportReport }>('/import/validate', { method: 'POST', body: input }),
  });
}

/** A bulk load touches every inventory surface at once. */
export function useCommitImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportCommitInput) =>
      apiFetch<ImportResult>('/import/commit', { method: 'POST', body: input }),
    onSuccess: () => {
      invalidateInventory(queryClient);
      invalidateAdmin(queryClient);
    },
  });
}

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
