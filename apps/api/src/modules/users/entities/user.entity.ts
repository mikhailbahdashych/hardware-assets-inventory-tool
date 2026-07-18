import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserRole } from '@inventory/shared';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('uq_users_email', { unique: true })
  @Column({ type: 'varchar', length: 255 })
  email: string;

  /** argon2id hash; NULL reserved for future OIDC-provisioned accounts. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  passwordHash: string | null;

  /** 'local' today; OIDC extension point. */
  @Column({ type: 'varchar', length: 20, default: 'local' })
  provider: string;

  @Column({ type: 'varchar', length: 120 })
  displayName: string;

  @Column({ type: 'varchar', length: 16 })
  role: UserRole;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'boolean', default: false })
  mustChangePassword: boolean;

  @Column({ type: 'boolean', default: false })
  mfaEnabled: boolean;

  @Column({ type: 'boolean', default: false })
  mfaEnforced: boolean;

  /** AES-256-GCM-encrypted TOTP secret (never stored in plaintext). */
  @Column({ type: 'text', nullable: true })
  mfaSecret: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  mfaVerifiedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
