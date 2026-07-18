import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('employees')
@Index('ix_employees_name', ['lastName', 'firstName'])
export class Employee {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  firstName: string;

  @Column({ type: 'varchar', length: 100 })
  lastName: string;

  /** Optional; unique only where present (partial unique index). */
  @Index('uq_employees_email', { unique: true, where: '"email" IS NOT NULL' })
  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  /** External HR identifier; CSV import match key; unique where present. */
  @Index('uq_employees_employee_number', { unique: true, where: '"employee_number" IS NOT NULL' })
  @Column({ type: 'varchar', length: 64, nullable: true })
  employeeNumber: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  department: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  title: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /** Offboarded people stay for assignment history. */
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
