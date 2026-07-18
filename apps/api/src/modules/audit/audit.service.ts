import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditAction } from '@inventory/shared';
import { AuditLog } from './entities/audit-log.entity';

export interface AuditEntry {
  actorId?: string | null;
  actorEmail?: string | null;
  action: AuditAction;
  entityType?: string | null;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogs: Repository<AuditLog>,
  ) {}

  /** Append one audit row. Failures are logged, never thrown — auditing must not break the operation. */
  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.auditLogs.save(
        this.auditLogs.create({
          actorId: entry.actorId ?? null,
          actorEmail: entry.actorEmail ?? null,
          action: entry.action,
          entityType: entry.entityType ?? null,
          entityId: entry.entityId ?? null,
          before: entry.before ?? null,
          after: entry.after ?? null,
          metadata: entry.metadata ?? null,
        }),
      );
    } catch (err) {
      this.logger.error(`failed to write audit log for ${entry.action}`, err);
    }
  }
}
