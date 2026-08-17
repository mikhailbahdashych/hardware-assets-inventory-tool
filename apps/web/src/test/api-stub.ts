import { vi } from 'vitest';

export type StubResponse = { status?: number; body?: unknown };
export type StubHandler = StubResponse | ((body: unknown, search: string) => StubResponse);
/**
 * Keyed by "METHOD /path", e.g. "POST /auth/login". A key may carry a query
 * string ("GET /audit?type=assets") to answer only that exact request; the
 * bare path is the fallback, so most routes need no query at all.
 */
export type StubRoutes = Record<string, StubHandler>;

/** One recorded request, as the assertions read it back. */
export interface StubCall {
  method: string;
  path: string;
  /** The query string including "?", or "" — filters live in the URL. */
  search: string;
  body: unknown;
}

export interface ApiStub {
  calls: StubCall[];
  /** The first call to a path, ignoring its query string. */
  called: (key: string) => StubCall | undefined;
  /** Every call to a path, in order — for assertions about refetching. */
  calledAll: (key: string) => StubCall[];
}

/** Stubs global fetch with a small route table so tests exercise the real API client. */
export function stubApi(routes: StubRoutes): ApiStub {
  const calls: ApiStub['calls'] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (rawUrl: string, init: RequestInit = {}) => {
      // fetch's own default, mirrored here.
      const method = (init.method ?? 'GET').toUpperCase();
      const url = new URL(rawUrl, 'http://localhost');
      const path = url.pathname.replace('/api/v1', '');
      const search = url.search;
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, path, search, body });

      const handler = routes[`${method} ${path}${search}`] ?? routes[`${method} ${path}`];
      if (!handler) {
        return new Response(
          JSON.stringify({ error: { code: 'not_found', message: 'Not found.' } }),
          {
            status: 404,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      const { status = 200, body: responseBody } =
        typeof handler === 'function' ? handler(body, search) : handler;
      return new Response(responseBody === undefined ? null : JSON.stringify(responseBody), {
        status,
        headers: responseBody === undefined ? {} : { 'content-type': 'application/json' },
      });
    }),
  );

  const matching = (key: string) => {
    const [method, path] = key.split(' ');
    return calls.filter((call) => call.method === method && call.path === path);
  };

  return {
    calls,
    called: (key) => matching(key)[0],
    calledAll: matching,
  };
}

export const ADMIN_MEMBER = {
  id: 'member-1',
  email: 'tomasz@acme.io',
  displayName: 'Tomasz Kowalski',
  role: 'admin',
  status: 'active',
  employeeId: null,
  lastActiveAt: null,
  theme: 'light',
  density: 'comfortable',
  widgets: {},
  mfaEnrolled: false,
};

export const READY_META = {
  needsSetup: false,
  version: '0.1.0',
  orgName: 'Acme Corp',
  defaultCurrency: 'EUR',
  smtpConfigured: true,
};

/** The same instance with no SMTP — the state every email affordance must handle. */
export const NO_SMTP_META = { ...READY_META, smtpConfigured: false };

export const CUSTOM_FIELDS = [
  { id: 'cf-1', key: 'mdm_enrolled', label: 'MDM enrolled', type: 'boolean', sortOrder: 0 },
  { id: 'cf-2', key: 'hostname', label: 'Hostname', type: 'text', sortOrder: 1 },
];

export const MAYA = {
  id: 'emp-1',
  firstName: 'Maya',
  lastName: 'Lindqvist',
  displayName: 'Maya Lindqvist',
  email: 'maya.lindqvist@acme.io',
  jobTitle: 'Product Designer',
  department: 'Design',
  location: 'Stockholm',
  employeeCode: 'EMP-0042',
  startDate: '2023-01-09',
  status: 'active',
  activeAssetCount: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

export const HOLDING = {
  id: 'assignment-1',
  employeeId: 'emp-1',
  holderName: 'Maya Lindqvist',
  checkedOutAt: '2024-03-14',
  expectedReturnDate: null,
  returnedAt: null,
  outcome: null,
  checkoutNotes: null,
  checkinCondition: null,
  checkinNotes: null,
};

export const PAST_HOLDING = {
  ...HOLDING,
  id: 'assignment-0',
  holderName: 'Elena Vasquez',
  checkedOutAt: '2023-04-14',
  returnedAt: '2024-01-28',
  outcome: 'offboarded',
};

export const LAPTOP = {
  id: 'asset-1',
  assetTag: 'AST-0142',
  name: 'MacBook Pro 14"',
  category: 'laptops',
  status: 'assigned',
  model: 'A2779',
  serialNumber: 'C02XK1AZQ6L7',
  purchaseDate: '2024-03-12',
  purchasePriceCents: 234000,
  currency: null,
  supplier: 'Insight EMEA',
  warrantyUntil: '2027-03-12',
  notes: null,
  currentHolder: {
    employeeId: 'emp-1',
    name: 'Maya Lindqvist',
    checkedOutAt: '2024-03-14',
    expectedReturnDate: null,
  },
  createdAt: '2026-01-02T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

export const MONITOR = {
  ...LAPTOP,
  id: 'asset-2',
  assetTag: 'AST-0143',
  name: 'Dell U2723QE',
  category: 'monitors',
  status: 'in_repair',
  serialNumber: 'CN0X1Y2Z',
  currentHolder: null,
};

/** The asset detail payload for LAPTOP, with a history worth rendering. */
export const LAPTOP_DETAIL = {
  asset: LAPTOP,
  customFields: [
    { ...CUSTOM_FIELDS[0], value: 'true' },
    { ...CUSTOM_FIELDS[1], value: 'maya-mbp' },
  ],
  history: [HOLDING, PAST_HOLDING],
  attachments: [
    {
      id: 'file-1',
      assetId: 'asset-1',
      filename: 'invoice-ast-0142.pdf',
      sizeBytes: 188416,
      mime: 'application/pdf',
      uploadedByName: 'Tomasz Kowalski',
      createdAt: '2026-01-02T00:00:00.000Z',
    },
  ],
  auditTrail: [
    {
      id: 'audit-1',
      at: '2024-03-14T09:12:00.000Z',
      action: 'asset.assigned',
      actorName: 'Tomasz Kowalski',
      params: { assetName: 'MacBook Pro 14"', holderName: 'Maya Lindqvist' },
    },
  ],
};

/** The employee detail payload for MAYA. */
export const MAYA_DETAIL = {
  employee: MAYA,
  holdings: [
    {
      ...HOLDING,
      assetId: 'asset-1',
      assetName: 'MacBook Pro 14"',
      assetTag: 'AST-0142',
      category: 'laptops',
      serialNumber: 'C02XK1AZQ6L7',
    },
  ],
  history: [
    {
      ...PAST_HOLDING,
      assetId: 'asset-9',
      assetName: 'MacBook Air M2',
      assetTag: 'AST-0089',
      category: 'laptops',
      serialNumber: 'FVFXQ2ABC',
    },
  ],
};

/** The signed-in admin as the Members page reads them (no preferences). */
export const ADMIN_SUMMARY = {
  id: 'member-1',
  email: 'tomasz@acme.io',
  displayName: 'Tomasz Kowalski',
  role: 'admin',
  status: 'active',
  employeeId: null,
  linkedEmployee: null,
  lastActiveAt: '2026-08-17T08:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
};

export const INVITED_SUMMARY = {
  id: 'member-2',
  email: 'grace@acme.io',
  displayName: 'grace',
  role: 'manager',
  status: 'invited',
  employeeId: null,
  linkedEmployee: null,
  lastActiveAt: null,
  createdAt: '2026-02-01T00:00:00.000Z',
};

export const LINKED_SUMMARY = {
  id: 'member-3',
  email: 'maya.lindqvist@acme.io',
  displayName: 'Maya Lindqvist',
  role: 'viewer',
  status: 'active',
  employeeId: 'emp-1',
  linkedEmployee: { id: 'emp-1', displayName: 'Maya Lindqvist' },
  lastActiveAt: '2026-08-10T08:00:00.000Z',
  createdAt: '2026-03-01T00:00:00.000Z',
};

export const SETTINGS = {
  id: 1,
  orgName: 'Acme Corp',
  defaultCurrency: 'EUR',
  assetTagPrefix: 'AST',
  warrantyLeadDays: 60,
  logRetentionMonths: 12,
  emailWarrantyAlerts: true,
  emailReturnReminders: true,
  emailInvites: true,
  emailWeeklyDigest: false,
  mfaRequired: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

export const AUDIT_PAGE = {
  items: [
    {
      id: 'audit-3',
      at: '2026-08-16T09:41:00.000Z',
      type: 'assets',
      action: 'asset.assigned',
      actorName: 'Tomasz Kowalski',
      assetId: 'asset-1',
      employeeId: 'emp-1',
      memberId: null,
      params: { assetName: 'MacBook Pro 14"', holderName: 'Maya Lindqvist' },
    },
    {
      id: 'audit-2',
      at: '2026-08-16T08:12:00.000Z',
      type: 'auth',
      action: 'member.invited',
      actorName: 'Tomasz Kowalski',
      assetId: null,
      employeeId: null,
      memberId: 'member-2',
      params: { email: 'grace@acme.io', role: 'manager' },
    },
    {
      id: 'audit-1',
      at: '2026-08-15T17:03:00.000Z',
      type: 'people',
      action: 'employee.offboarding_started',
      actorName: 'Priya Sharma',
      assetId: null,
      employeeId: 'emp-2',
      memberId: null,
      params: { employeeName: "Liam O'Connor", scheduledReturns: 2 },
    },
  ],
  typeCounts: { all: 3, assets: 1, people: 1, auth: 1, system: 0 },
  total: 3,
};

export const DASHBOARD = {
  assetCount: 13,
  statusCounts: {
    available: 4,
    assigned: 6,
    in_repair: 1,
    ordered: 1,
    retired: 1,
    lost_stolen: 0,
  },
  categoryCounts: [
    { category: 'laptops', count: 6 },
    { category: 'desktops', count: 1 },
    { category: 'monitors', count: 3 },
    { category: 'phones', count: 2 },
    { category: 'peripherals', count: 1 },
  ],
  recentActivity: AUDIT_PAGE.items,
  warrantyExpirations: [
    {
      assetId: 'asset-1',
      name: 'MacBook Pro 14"',
      assetTag: 'AST-0142',
      warrantyUntil: '2026-09-12',
      daysLeft: 26,
    },
    {
      assetId: 'asset-2',
      name: 'Dell U2723QE',
      assetTag: 'AST-0143',
      warrantyUntil: '2026-10-17',
      daysLeft: 61,
    },
  ],
  pendingReturns: [
    {
      assetId: 'asset-1',
      assetName: 'MacBook Pro 14"',
      assetTag: 'AST-0142',
      employeeId: 'emp-1',
      holderName: 'Maya Lindqvist',
      expectedReturnDate: '2026-08-24',
    },
  ],
};

/** Signed-in admin with an empty-but-reachable inventory. */
export const INVENTORY_ROUTES: StubRoutes = {
  'GET /meta': { body: READY_META },
  'GET /auth/me': { body: { member: ADMIN_MEMBER } },
  'GET /assets': { body: { assets: [LAPTOP, MONITOR] } },
  'GET /employees': { body: { employees: [MAYA] } },
  'GET /custom-fields': { body: { customFields: CUSTOM_FIELDS } },
  'GET /assets/next-tag': { body: { assetTag: 'AST-0144' } },
};

/**
 * The signed-in admin looking at a dashboard with something in every widget.
 * Includes the two detail routes, because the dashboard and the palette both
 * click through to a record.
 */
export const DASHBOARD_ROUTES: StubRoutes = {
  ...INVENTORY_ROUTES,
  'GET /dashboard': { body: DASHBOARD },
  'GET /assets/asset-1': { body: LAPTOP_DETAIL },
  'GET /employees/emp-1': { body: MAYA_DETAIL },
};

/** The signed-in admin plus everything the Members and Admin pages read. */
export const ADMIN_ROUTES: StubRoutes = {
  'GET /meta': { body: READY_META },
  'GET /auth/me': { body: { member: ADMIN_MEMBER } },
  'GET /employees': { body: { employees: [MAYA] } },
  'GET /members': { body: { members: [ADMIN_SUMMARY, INVITED_SUMMARY, LINKED_SUMMARY] } },
  'GET /settings': { body: { settings: SETTINGS } },
  'GET /audit': { body: AUDIT_PAGE },
};
