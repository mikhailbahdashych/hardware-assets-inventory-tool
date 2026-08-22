import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { mfaConfirmInput, prefsPatchInput } from '@inventory/shared';
import type { AppDeps } from '@/types/app.js';
import { members } from '@/db/schema.js';
import { nowIso } from '@/lib/dates.js';
import { serializeMember } from '@/lib/serialize.js';
import { requireAuth, requireSession } from '@/plugins/rbac.js';
import { writeAudit } from '@/services/audit.js';
import { beginEnrolment, confirmEnrolment } from '@/services/mfa.js';
import { getSettings } from '@/services/settings.js';

/** Personal preferences — every role may change their own. */
export function registerMeRoutes(app: FastifyInstance, deps: AppDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  typed.patch(
    '/api/v1/me/prefs',
    { schema: { body: prefsPatchInput }, preHandler: requireAuth },
    async (request) => {
      const patch: Record<string, string> = {};
      if (request.body.theme) patch.theme = request.body.theme;
      if (request.body.density) patch.density = request.body.density;
      if (request.body.widgets) patch.widgetsJson = JSON.stringify(request.body.widgets);
      patch.updatedAt = nowIso(deps.now());

      await deps.db.update(members).set(patch).where(eq(members.id, request.member!.id)).run();
      const updated = (await deps.db
        .select()
        .from(members)
        .where(eq(members.id, request.member!.id))
        .get())!;
      return { member: serializeMember(updated) };
    },
  );

  /**
   * Start enrolling an authenticator. Reachable while `mfa_enrolment_required`
   * blocks everything else — it is the one thing somebody in that state is
   * allowed to do, and the way out of it.
   */
  typed.post('/api/v1/me/mfa/enroll', { preHandler: requireSession }, async (request) => {
    const settings = await getSettings(deps.db);
    return await beginEnrolment(deps.db, request.member!, settings.orgName, deps.now());
  });

  /**
   * Finish it, against a live code. Returns the recovery codes once — they are
   * stored hashed, so this response is the only time they exist in the clear.
   */
  typed.post(
    '/api/v1/me/mfa/confirm',
    { schema: { body: mfaConfirmInput }, preHandler: requireSession },
    async (request) => {
      const now = deps.now();
      const member = request.member!;
      const recoveryCodes = await confirmEnrolment(deps.db, member, request.body.code, now);
      await writeAudit(
        deps.db,
        {
          type: 'auth',
          action: 'member.mfa_enrolled',
          actorMemberId: member.id,
          actorName: member.displayName,
          memberId: member.id,
          params: { memberName: member.displayName },
        },
        now,
      );
      return { recoveryCodes };
    },
  );
}
