import 'server-only';

import { prisma } from '@/lib/db';
import type { RequestContext } from '@/lib/session';

export type AuditAction =
  | 'auth.otp_requested'
  | 'auth.otp_failed'
  | 'auth.login'
  | 'auth.logout'
  | 'auth.session_revoked'
  | 'auth.rate_limited'
  | 'exam.attempt_started'
  | 'exam.attempt_submitted'
  | 'exam.attempt_auto_submitted'
  | 'exam.access_denied'
  | 'admin.quiz_created'
  | 'admin.quiz_updated'
  | 'admin.quiz_published'
  | 'admin.quiz_deleted'
  | 'admin.question_created'
  | 'admin.question_updated'
  | 'admin.question_deleted'
  | 'admin.questions_imported'
  | 'admin.student_created'
  | 'admin.student_updated'
  | 'admin.students_imported'
  | 'admin.device_reset'
  | 'admin.integrity_reviewed'
  | 'admin.assignment_updated'
  | 'admin.media_uploaded'
  /** Manual marking changes a student's score after the fact, so it is logged. */
  | 'admin.answer_graded';

interface AuditInput {
  action: AuditAction;
  userId?: string | null;
  entityType?: string;
  entityId?: string;
  context?: Pick<RequestContext, 'ipHash' | 'userAgent'>;
  metadata?: Record<string, unknown>;
}

/**
 * Audit writes must never break the request they describe, so failures are
 * logged and swallowed rather than propagated.
 */
export async function audit(input: AuditInput) {
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        userId: input.userId ?? null,
        entityType: input.entityType,
        entityId: input.entityId,
        ipHash: input.context?.ipHash,
        userAgent: input.context?.userAgent?.slice(0, 400),
        metadata: (input.metadata ?? {}) as object,
      },
    });
  } catch (error) {
    console.error('[audit] failed to write audit log', input.action, error);
  }
}
