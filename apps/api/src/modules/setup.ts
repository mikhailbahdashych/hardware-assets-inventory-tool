import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { setupInput } from '@inventory/shared';
import type { AppDeps } from '../app.js';
import { members, orgSettings } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { nowIso } from '../lib/dates.js';
import { hashPassword } from '../lib/password.js';
import { serializeMember } from '../lib/serialize.js';
import { writeAudit } from '../services/audit.js';
import { createSession, setSessionCookie } from '../services/sessions.js';

/** First-run setup: creates the organization and its first admin, signs them in. */
export function registerSetupRoutes(app: FastifyInstance, deps: AppDeps): void {
  app
    .withTypeProvider<ZodTypeProvider>()
    .post('/api/v1/setup', { schema: { body: setupInput } }, async (request, reply) => {
      const existing = deps.db.select().from(orgSettings).get();
      if (existing) {
        throw new AppError(409, 'already_initialized', 'This instance is already set up.');
      }

      const now = deps.now();
      const passwordHash = await hashPassword(request.body.password);
      const memberId = newId();

      const member = deps.db.transaction((tx) => {
        tx.insert(orgSettings)
          .values({
            id: 1,
            orgName: request.body.orgName,
            createdAt: nowIso(now),
            updatedAt: nowIso(now),
          })
          .run();
        tx.insert(members)
          .values({
            id: memberId,
            email: request.body.email,
            displayName: request.body.name,
            passwordHash,
            role: 'admin',
            status: 'active',
            createdAt: nowIso(now),
            updatedAt: nowIso(now),
          })
          .run();
        writeAudit(
          tx,
          {
            type: 'system',
            action: 'system.setup_completed',
            actorMemberId: memberId,
            actorName: request.body.name,
            memberId,
            params: { orgName: request.body.orgName },
          },
          now,
        );
        return tx.select().from(members).all()[0];
      });

      const session = createSession(deps.db, memberId, now);
      setSessionCookie(reply, session.raw, session.expiresAt, deps.config);
      return { member: serializeMember(member) };
    });
}
