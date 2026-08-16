import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { employeeCreateInput, employeePatchInput } from '@inventory/shared';
import type { AppDeps } from '@/types/app.js';
import { requireAction, requireAuth } from '@/plugins/rbac.js';
import {
  createEmployee,
  deleteEmployee,
  getEmployeeDetail,
  listEmployees,
  updateEmployee,
} from '@/services/employees.js';

const idParam = z.object({ id: z.string().min(1) });

/** Employees hold assets; they have no app access (that is a member). */
export function registerEmployeeRoutes(app: FastifyInstance, deps: AppDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get('/api/v1/employees', { preHandler: requireAuth }, async () => ({
    employees: listEmployees(deps.db),
  }));

  typed.get(
    '/api/v1/employees/:id',
    { schema: { params: idParam }, preHandler: requireAuth },
    async (request) => getEmployeeDetail(deps.db, request.params.id),
  );

  typed.post(
    '/api/v1/employees',
    { schema: { body: employeeCreateInput }, preHandler: requireAction('employees.create') },
    async (request) => ({ employee: createEmployee(deps, request.member!, request.body) }),
  );

  typed.patch(
    '/api/v1/employees/:id',
    {
      schema: { params: idParam, body: employeePatchInput },
      preHandler: requireAction('employees.edit'),
    },
    async (request) => ({
      employee: updateEmployee(deps, request.member!, request.params.id, request.body),
    }),
  );

  typed.delete(
    '/api/v1/employees/:id',
    { schema: { params: idParam }, preHandler: requireAction('employees.delete') },
    async (request, reply) => {
      deleteEmployee(deps, request.member!, request.params.id);
      return reply.status(204).send();
    },
  );
}
