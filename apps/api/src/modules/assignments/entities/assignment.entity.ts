import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Employee } from '../../employees/entities/employee.entity';
import { Asset } from '../../assets/entities/asset.entity';

/**
 * Append-only checkout/checkin ledger. returnedAt IS NULL = current holder.
 * The partial unique index is the race-condition backstop: at most one open
 * assignment per asset, enforced by the database itself.
 */
@Entity('assignments')
@Index('uq_assignments_open_asset', ['assetId'], { unique: true, where: '"returned_at" IS NULL' })
@Index('ix_assignments_employee', ['employeeId', 'returnedAt'])
export class Assignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Asset, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'asset_id' })
  asset: Asset;

  @Column({ type: 'uuid' })
  assetId: string;

  @ManyToOne(() => Employee, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  @Column({ type: 'uuid' })
  employeeId: string;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  assignedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  returnedAt: Date | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_by_id' })
  assignedBy: User | null;

  @Column({ type: 'uuid', nullable: true })
  assignedById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'checked_in_by_id' })
  checkedInBy: User | null;

  @Column({ type: 'uuid', nullable: true })
  checkedInById: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  checkoutNote: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  checkinNote: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
