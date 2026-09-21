import { useQuery } from '@tanstack/react-query';
import type {
  AuditType,
  NotificationsPayload,
  RolesPayload,
  WorkflowPayload,
} from '@inventory/shared';
import { ApiError, apiFetch } from './client';
import type {
  Session,
  AssetDetail,
  AssetListParams,
  AssetsPayload,
  AuditPage,
  CustomFieldDef,
  DashboardPayload,
  EmployeeDetail,
  EmployeesPayload,
  InviteDetails,
  ListParams,
  MembersPayload,
  Meta,
  OrgMeta,
  SearchPayload,
  SettingsPayload,
} from '@/types/api';

/**
 * The query-key catalog. Every cached read is listed here so invalidation
 * after a mutation is a lookup rather than a guess (see api/invalidate.ts).
 *
 * **A parameterized key carries every parameter**, and always under the same
 * first element: the three list pages cache one entry per page and per search,
 * and `invalidateInventory`/`invalidateAdmin` still reach all of them because
 * `['assets']` is a prefix of `['assets', {…}]`.
 */
export const queryKeys = {
  meta: ['meta'] as const,
  me: ['me'] as const,
  invite: (token: string) => ['invite', token] as const,
  assets: (params: AssetListParams) => ['assets', params] as const,
  asset: (id: string) => ['asset', id] as const,
  nextAssetTag: ['assets', 'next-tag'] as const,
  employees: (params: ListParams) => ['employees', params] as const,
  employee: (id: string) => ['employee', id] as const,
  search: (q: string) => ['search', q] as const,
  customFields: ['custom-fields'] as const,
  workflow: ['workflow'] as const,
  roles: ['roles'] as const,
  members: (params: ListParams) => ['members', params] as const,
  notifications: (limit: number, offset: number) => ['notifications', limit, offset] as const,
  settings: ['settings'] as const,
  dashboard: ['dashboard'] as const,
  audit: (filter: AuditFilter) => ['audit', filter] as const,
};

/**
 * One page of a whole-list screen, and the API's own default limit — the size
 * those pages start at until somebody picks another from the pager's selector,
 * which `usePageSize` then remembers.
 */
export const LIST_PAGE = 50;

/**
 * A modal's searchable candidate list. Smaller than a page because it is a
 * list you pick from, not one you read, and it is searched as you type.
 */
export const PICKER_PAGE = 20;

/**
 * What a dropdown of employees asks for. A `Dropdown` has no search box, so it
 * cannot narrow a list it was never given — this is the endpoint's own ceiling,
 * and a workspace with more people than this picks the person on the Employees
 * page and links the account from there. Give the control a search field before
 * raising it.
 */
export const DROPDOWN_LIMIT = 200;

/** What the activity log is currently showing: the filter and the page of it. */
export interface AuditFilter {
  type?: AuditType;
  limit: number;
  offset: number;
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

/** Resolves to the signed-in session, or null when nobody is signed in. */
export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: async () => {
      try {
        return await apiFetch<Session>('/auth/me');
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

/**
 * One page of the inventory. Searching, filtering and counting all happen on
 * the server — there is no ceiling on how big an inventory gets, so the whole
 * list is never in the browser and nothing here filters an array.
 *
 * `placeholderData` keeps the previous page on screen while the next one loads,
 * so typing in the search box does not blank the table between keystrokes.
 */
export function useAssets(params: AssetListParams) {
  return useQuery({
    queryKey: queryKeys.assets(params),
    queryFn: () => apiFetch<AssetsPayload>(`/assets?${listParams(params)}`),
    placeholderData: (previous) => previous,
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

/** One page of the employee list — searched on the server, like the assets. */
export function useEmployees(params: ListParams) {
  return useQuery({
    queryKey: queryKeys.employees(params),
    queryFn: () => apiFetch<EmployeesPayload>(`/employees?${listParams(params)}`),
    placeholderData: (previous) => previous,
  });
}

/**
 * What the command palette runs on. One endpoint rather than the two whole-list
 * caches it used to read: those lists are pages now, and a palette that only
 * searched the page you happened to be on would be a worse palette.
 */
export function useSearch(q: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.search(q),
    queryFn: () => apiFetch<SearchPayload>(`/search?q=${encodeURIComponent(q)}`),
    enabled,
    placeholderData: (previous) => previous,
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

/**
 * The workspace's statuses and the moves between them — read by every screen
 * that draws a status pill, because the label and the colour are data now.
 * Cached like the custom-field definitions: rarely edited, needed everywhere.
 * Any workflow write invalidates it (see api/invalidate.ts).
 */
export function useWorkflow() {
  return useQuery({
    queryKey: queryKeys.workflow,
    queryFn: () => apiFetch<WorkflowPayload>('/workflow'),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * The workspace's roles, what each one may do, and how many people hold it.
 * Open to every member for the same reason the workflow is: a role pill has a
 * label and a colour only because a row says so, and the Members page draws one
 * per person. The Roles page edits the same payload it renders.
 */
export function useRoles() {
  return useQuery({
    queryKey: queryKeys.roles,
    queryFn: () => apiFetch<RolesPayload>('/roles'),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * All five widgets in one request. They read the same few tables, and toggling
 * a widget off should not change how many round trips the page makes.
 */
export function useDashboard() {
  return useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: () => apiFetch<DashboardPayload>('/dashboard'),
  });
}

/** The API's own default page size, and the one the inbox starts at. */
export const INBOX_PAGE = 50;

/**
 * The signed-in member's own inbox — every member has one, so the bell asks
 * unconditionally and shares the first page with the Notifications page.
 * `useMarkNotificationsRead` is the write half, and it invalidates the whole
 * `['notifications']` prefix, so every page it cached refetches.
 */
export function useNotifications(limit: number = INBOX_PAGE, offset = 0) {
  return useQuery({
    queryKey: queryKeys.notifications(limit, offset),
    queryFn: () => apiFetch<NotificationsPayload>(`/notifications?limit=${limit}&offset=${offset}`),
  });
}

/** Everyone can read the member list; only admins can change anything on it. */
export function useMembers(params: ListParams) {
  return useQuery({
    queryKey: queryKeys.members(params),
    queryFn: () => apiFetch<MembersPayload>(`/members?${listParams(params)}`),
    placeholderData: (previous) => previous,
  });
}

/**
 * The query string the three list endpoints share. A blank `q` is left out
 * entirely rather than sent empty, so the key for "no search" is one key.
 */
export function listParams(params: AssetListParams): string {
  const search = new URLSearchParams({
    limit: String(params.limit),
    offset: String(params.offset),
  });
  if (params.q) search.set('q', params.q);
  if (params.status) search.set('status', params.status);
  if (params.assignable) search.set('assignable', 'true');
  return search.toString();
}

/**
 * Admin-only, like every screen that reads it. The whole payload, not just the
 * row: the storage usage beside it is what the Settings page's quota line
 * reads, and a hook that dropped it would need a second request to get it back.
 */
export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => apiFetch<SettingsPayload>('/settings'),
  });
}

/**
 * One page of the activity log — a numbered page, fetched by `offset`, with the
 * filter and the offset both in the key so every page caches on its own.
 *
 * The log grows at the head, so a row that arrives while you read page two can
 * push another one onto it from page one. That is the accepted trade-off:
 * numbered pages you can navigate are worth more here than a snapshot that
 * never shifts, and nothing on this screen is read as a sequence.
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
  const params = new URLSearchParams({
    limit: String(filter.limit),
    offset: String(filter.offset),
  });
  if (filter.type) params.set('type', filter.type);
  return params.toString();
}
