import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { permissionsPutSchema, roleCreateSchema, roleOrderSchema, rolePatchSchema } from '@inventory/shared'; // prettier-ignore
import type { AppDeps } from '@/types/app.js';
import { requireAction, requireAuth } from '@/plugins/rbac.js';
import {
  createRole,
  deleteRole,
  listRoles,
  reorderRoles,
  replacePermissions,
  updateRole,
} from '@/services/roles.js';

const idParam = z.object({ id: z.string().min(1) });

/** Where the members of a deleted role go. Absent means "nobody holds it". */
const deleteQuery = z.object({ migrateTo: z.string().min(1).optional() });

/**
 * The workspace's roles and what each may do. Everybody reads them — a role
 * pill is unrenderable without the label and colour, and the Members page draws
 * one per row — but only somebody granted `roles.manage` may change who may do
 * what. Every rule lives in the roles service; these routes are the thin layer
 * that names the guard and hands over the body.
 */
export function registerRoleRoutes(app: FastifyInstance, deps: AppDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get('/api/v1/roles', { preHandler: requireAuth }, async () => ({
    roles: listRoles(deps.db),
  }));

  typed.post(
    '/api/v1/roles',
    { schema: { body: roleCreateSchema }, preHandler: requireAction('roles.manage') },
    async (request, reply) =>
      reply.status(201).send({ role: createRole(deps, request.member!, request.body) }),
  );

  typed.patch(
    '/api/v1/roles/:id',
    {
      schema: { params: idParam, body: rolePatchSchema },
      preHandler: requireAction('roles.manage'),
    },
    async (request) => ({
      role: updateRole(deps, request.member!, request.params.id, request.body),
    }),
  );

  /**
   * The matrix's Save. A PUT because it replaces the whole grant set rather
   * than adding to it — resubmitting the same matrix is the same permissions.
   */
  typed.put(
    '/api/v1/roles/permissions',
    { schema: { body: permissionsPutSchema }, preHandler: requireAction('roles.manage') },
    async (request) => replacePermissions(deps, request.member!, request.body),
  );

  /**
   * Cannot clash with the `:id` routes — the methods differ — but it is spelled
   * out here because `order` would otherwise read like a role id to anyone
   * scanning the file.
   */
  typed.post(
    '/api/v1/roles/order',
    { schema: { body: roleOrderSchema }, preHandler: requireAction('roles.manage') },
    async (request, reply) => {
      reorderRoles(deps, request.member!, request.body.order);
      return reply.status(204).send();
    },
  );

  typed.delete(
    '/api/v1/roles/:id',
    {
      schema: { params: idParam, querystring: deleteQuery },
      preHandler: requireAction('roles.manage'),
    },
    async (request, reply) => {
      deleteRole(deps, request.member!, request.params.id, request.query.migrateTo);
      return reply.status(204).send();
    },
  );
}
