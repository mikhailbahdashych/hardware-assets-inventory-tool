import { vi } from 'vitest';

export type StubResponse = { status?: number; body?: unknown };
export type StubHandler = StubResponse | ((body: unknown) => StubResponse);
/** Keyed by "METHOD /path", e.g. "POST /auth/login". */
export type StubRoutes = Record<string, StubHandler>;

export type ApiStub = {
  calls: { method: string; path: string; body: unknown }[];
  called: (key: string) => { method: string; path: string; body: unknown } | undefined;
};

/** Stubs global fetch with a small route table so tests exercise the real API client. */
export function stubApi(routes: StubRoutes): ApiStub {
  const calls: ApiStub['calls'] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = (init.method ?? 'GET').toUpperCase();
      const path = url.replace('/api/v1', '');
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, path, body });

      const handler = routes[`${method} ${path}`];
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
        typeof handler === 'function' ? handler(body) : handler;
      return new Response(responseBody === undefined ? null : JSON.stringify(responseBody), {
        status,
        headers: responseBody === undefined ? {} : { 'content-type': 'application/json' },
      });
    }),
  );

  return {
    calls,
    called: (key) => {
      const [method, path] = key.split(' ');
      return calls.find((call) => call.method === method && call.path === path);
    },
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
};

export const READY_META = {
  needsSetup: false,
  version: '0.1.0',
  orgName: 'Acme Corp',
  defaultCurrency: 'EUR',
};

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

/** Signed-in admin with an empty-but-reachable inventory. */
export const INVENTORY_ROUTES: StubRoutes = {
  'GET /meta': { body: READY_META },
  'GET /auth/me': { body: { member: ADMIN_MEMBER } },
  'GET /assets': { body: { assets: [LAPTOP, MONITOR] } },
  'GET /employees': { body: { employees: [MAYA] } },
  'GET /custom-fields': { body: { customFields: CUSTOM_FIELDS } },
  'GET /assets/next-tag': { body: { assetTag: 'AST-0144' } },
};
