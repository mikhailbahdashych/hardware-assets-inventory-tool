import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AuditAction } from '@inventory/shared';
import { User } from '../../users/entities/user.entity';

/** Append-only. No update/delete API will ever exist for this table. */
@Entity('audit_logs')
@Index('ix_audit_logs_entity', ['entityType', 'entityId'])
export class AuditLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actor_id' })
  actor: User | null;

  @Column({ type: 'uuid', nullable: true })
  actorId: string | null;

  /** Denormalized so history survives account changes/deletion. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  actorEmail: string | null;

  @Column({ type: 'varchar', length: 20 })
  action: AuditAction;

  @Column({ type: 'varchar', length: 32, nullable: true })
  entityType: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  entityId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  before: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  after: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Index('ix_audit_logs_created_at')
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
