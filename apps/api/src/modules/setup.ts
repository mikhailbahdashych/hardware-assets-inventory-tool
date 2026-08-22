import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ADMIN_ROLE, setupInput } from '@inventory/shared';
import type { AppDeps } from '@/types/app.js';
import { members, orgSettings } from '@/db/schema.js';
import { AppError } from '@/lib/errors.js';
import { newId } from '@/lib/ids.js';
import { nowIso } from '@/lib/dates.js';
import { hashPassword } from '@/lib/password.js';
import { serializeMember } from '@/lib/serialize.js';
import { writeAudit } from '@/services/audit.js';
import { createSession, setSessionCookie } from '@/services/sessions.js';

/** First-run setup: creates the organization and its first admin, signs them in. */
export function registerSetupRoutes(app: FastifyInstance, deps: AppDeps): void {
  app
    .withTypeProvider<ZodTypeProvider>()
    .post('/api/v1/setup', { schema: { body: setupInput } }, async (request, reply) => {
      const [existing] = await deps.db.select().from(orgSettings);
      if (existing) {
        throw new AppError(409, 'already_initialized', 'This instance is already set up.');
      }

      const now = deps.now();
      const passwordHash = await hashPassword(request.body.password);
      const memberId = newId();

      const member = await deps.db.transaction(async (tx) => {
        await tx.insert(orgSettings).values({
          id: 1,
          orgName: request.body.orgName,
          // The column is nullable because NULL is the Settings page's
          // "Forever"; a new workspace starts on the design's 12 months.
          logRetentionMonths: 12,
          createdAt: nowIso(now),
          updatedAt: nowIso(now),
        });
        await tx.insert(members).values({
          id: memberId,
          email: request.body.email,
          displayName: request.body.name,
          passwordHash,
          // The system role, which the boot seed has already laid down.
          role: ADMIN_ROLE,
          status: 'active',
          createdAt: nowIso(now),
          updatedAt: nowIso(now),
        });
        await writeAudit(
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
        // By id, not "the first row": this is only correct while the table has
        // exactly one member, which is true today and is not a property to
        // depend on. A miss means the insert above did not happen.
        const [created] = await tx.select().from(members).where(eq(members.id, memberId));
        if (!created) {
          throw new AppError(500, 'setup_failed', 'The first admin could not be created.');
        }
        return created;
      });

      const session = await createSession(deps.db, memberId, now);
      setSessionCookie(reply, session.raw, session.expiresAt, deps.config);
      return { member: serializeMember(member) };
    });
}
